// 私聊的业务层：会话摘要、消息分页与序列化、已读、私聊消息的举报登记。
// 数据表在 server/matches.ts，接口在 server/routes/chat.ts。
import { hasPrivacyConsent } from '../shared/profileRules.ts';
import type { ChatMessage, ChatSummary, ContactState, PrivateNote } from '../shared/types.ts';
import { isExcluded } from './connections.ts';
import { iso, q } from './db.ts';
import { type MatchRow, matchForUser, otherOf } from './matches.ts';
import { getProfileRow, parseData } from './profiles.ts';
import { registerReportTarget } from './social.ts';
import { noteForOwner, notesForOwner } from './notes.ts';

/** 单条消息最多 1000 字 */
export const MESSAGE_MAX = 1000;
/** 每次最多返回的消息条数 */
export const PAGE_SIZE = 50;
/** 会话列表最多返回的条数（按最近活动排序） */
const LIST_LIMIT = 200;
/** 会话列表里最后一条消息的预览长度 */
const PREVIEW_CHARS = 80;

interface MessageRow {
  id: number;
  match_id: number;
  sender_id: number | null;
  kind: 'text' | 'system';
  body: string;
  created_at: string;
}

interface SummaryRow extends MatchRow {
  lm_sender: number | null;
  lm_kind: 'text' | 'system' | null;
  lm_body: string | null;
  lm_created: string | null;
  unread: number;
}

// 最后一条消息 + 未读数（对方发来的文字消息且 id > 我的 last_read_id）。参数依次：viewerId, viewerId
const SUMMARY_SELECT = `
  SELECT x.*, lm.sender_id AS lm_sender, lm.kind AS lm_kind, lm.body AS lm_body, lm.created_at AS lm_created,
    (SELECT COUNT(*) FROM messages u
      WHERE u.match_id = x.id AND u.kind = 'text' AND u.sender_id IS NOT NULL AND u.sender_id <> ?
        AND u.id > COALESCE((SELECT r.last_read_id FROM message_reads r WHERE r.match_id = x.id AND r.user_id = ?), 0)) AS unread
  FROM matches x
  LEFT JOIN messages lm ON lm.id = (SELECT MAX(id) FROM messages WHERE match_id = x.id)`;

const NOT_EXCLUDED = `NOT EXISTS (SELECT 1 FROM exclusions e
  WHERE (e.user_id = x.user_a AND e.target_id = x.user_b) OR (e.user_id = x.user_b AND e.target_id = x.user_a))`;

/** 由 contact_requests 推导当前用户视角下的交换状态 */
export function contactStateOf(viewerId: number, otherId: number): ContactState {
  const row = q.get<{ requester_id: number; status: string }>(
    'SELECT requester_id, status FROM contact_requests WHERE (requester_id = ? AND recipient_id = ?) OR (requester_id = ? AND recipient_id = ?)',
    viewerId, otherId, otherId, viewerId,
  );
  if (!row) return 'none';
  if (row.status === 'pending') return row.requester_id === viewerId ? 'pending_outgoing' : 'pending_incoming';
  return row.status === 'accepted' ? 'accepted' : 'rejected';
}

/** 对方的昵称与封面。封面规则同卡片：主页公开可见、隐私同意完整、照片设为公开时才返回 */
function otherOfSummary(otherId: number): ChatSummary['other'] {
  const row = getProfileRow(otherId);
  if (!row) return { id: otherId, nickname: '同学', cover: null };
  const d = parseData(row);
  const visible = !!row.published && !row.taken_down && hasPrivacyConsent(d) && d.photoVisibility === 'public';
  return { id: otherId, nickname: row.nickname, cover: visible ? d.photos[0] ?? null : null };
}

const preview = (body: string) => {
  const chars = [...body.replace(/\s+/gu, ' ').trim()];
  return chars.length > PREVIEW_CHARS ? `${chars.slice(0, PREVIEW_CHARS).join('')}…` : chars.join('');
};

function toSummary(row: SummaryRow, viewerId: number, privateNote: PrivateNote | null): ChatSummary {
  const otherId = otherOf(row, viewerId);
  return {
    matchId: row.id,
    other: { ...otherOfSummary(otherId), privateNote },
    status: row.status,
    lastMessage: row.lm_kind && row.lm_created && row.lm_body !== null
      ? { body: preview(row.lm_body), senderId: row.lm_sender, createdAt: iso(row.lm_created)!, kind: row.lm_kind }
      : null,
    unread: row.unread,
    createdAt: iso(row.created_at)!,
    contactState: contactStateOf(viewerId, otherId),
  };
}

/** 我参与的全部配对（含已解除），互相排除的不返回；按最近消息（无则配对时间）倒序 */
export function listChats(viewerId: number): ChatSummary[] {
  const rows = q.all<SummaryRow>(
    `${SUMMARY_SELECT}
     WHERE (x.user_a = ? OR x.user_b = ?) AND ${NOT_EXCLUDED}
     ORDER BY COALESCE(x.last_message_at, x.created_at) DESC, x.id DESC
     LIMIT ${LIST_LIMIT}`,
    viewerId, viewerId, viewerId, viewerId,
  );
  const notes = notesForOwner(viewerId);
  return rows.map((row) => toSummary(row, viewerId, notes.get(otherOf(row, viewerId)) ?? null));
}

/** 当前用户是该配对的一方、且双方未互相排除时返回配对；否则调用方一律按“不存在”处理 */
export function visibleMatch(matchId: number, viewerId: number): MatchRow | undefined {
  const m = matchForUser(matchId, viewerId);
  if (!m || isExcluded(m.user_a, m.user_b)) return undefined;
  return m;
}

export function chatSummary(matchId: number, viewerId: number): ChatSummary | null {
  if (!visibleMatch(matchId, viewerId)) return null;
  const row = q.get<SummaryRow>(`${SUMMARY_SELECT} WHERE x.id = ?`, viewerId, viewerId, matchId);
  return row ? toSummary(row, viewerId, noteForOwner(viewerId, otherOf(row, viewerId))) : null;
}

export function toChatMessage(row: MessageRow, viewerId: number): ChatMessage {
  return {
    id: row.id,
    matchId: row.match_id,
    senderId: row.sender_id,
    kind: row.kind,
    body: row.body,
    createdAt: iso(row.created_at)!,
    mine: row.sender_id !== null && row.sender_id === viewerId,
  };
}

/**
 * 分页读取消息，结果总是按 id 升序。
 * - after：只取比它新的消息（轮询）；hasMore 表示还有更新的消息没取完，应立即再取一次。
 * - 否则取最新的一页，或 before 之前的一页（向上翻）；hasMore 表示还有更早的消息。
 */
export function messagesPage(matchId: number, viewerId: number, cursor: { after?: number; before?: number }) {
  let rows: MessageRow[];
  if (cursor.after !== undefined) {
    rows = q.all<MessageRow>('SELECT * FROM messages WHERE match_id = ? AND id > ? ORDER BY id ASC LIMIT ?', matchId, cursor.after, PAGE_SIZE + 1);
  } else if (cursor.before !== undefined) {
    rows = q.all<MessageRow>('SELECT * FROM messages WHERE match_id = ? AND id < ? ORDER BY id DESC LIMIT ?', matchId, cursor.before, PAGE_SIZE + 1);
  } else {
    rows = q.all<MessageRow>('SELECT * FROM messages WHERE match_id = ? ORDER BY id DESC LIMIT ?', matchId, PAGE_SIZE + 1);
  }
  const hasMore = rows.length > PAGE_SIZE;
  const page = rows.slice(0, PAGE_SIZE);
  if (cursor.after === undefined) page.reverse();
  return { messages: page.map((row) => toChatMessage(row, viewerId)), hasMore };
}

/**
 * 清理用户输入的消息：统一换行、去掉控制字符与双向文字覆盖符（防止伪装内容）、最多保留两个连续空行。
 * 返回 trim 后的文本；不是字符串时返回 ''。
 */
export function cleanMessageBody(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F‎‏‪-‮⁦-⁩]/g, '')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim();
}

export function insertMessage(matchId: number, senderId: number, body: string): ChatMessage {
  const id = Number(q.run("INSERT INTO messages (match_id, sender_id, kind, body) VALUES (?, ?, 'text', ?)", matchId, senderId, body).lastInsertRowid);
  q.run("UPDATE matches SET last_message_at = datetime('now') WHERE id = ?", matchId);
  return toChatMessage(q.get<MessageRow>('SELECT * FROM messages WHERE id = ?', id)!, senderId);
}

/** last_read_id = max(旧值, min(lastId, 该配对最大消息 id))，只会前进不会后退 */
export function markRead(matchId: number, userId: number, lastId: number) {
  const max = q.get<{ n: number | null }>('SELECT MAX(id) n FROM messages WHERE match_id = ?', matchId)?.n ?? 0;
  const target = Math.max(0, Math.min(lastId, max));
  q.run(
    `INSERT INTO message_reads (match_id, user_id, last_read_id) VALUES (?, ?, ?)
     ON CONFLICT(match_id, user_id) DO UPDATE SET last_read_id = MAX(last_read_id, excluded.last_read_id)`,
    matchId, userId, target,
  );
}

// ---------- 举报私聊消息 ----------

registerReportTarget('message', {
  // 只能举报对方发给自己的文字消息（不能举报自己的消息和系统消息）
  canReport(reporterId, id) {
    const row = q.get<{ sender_id: number | null; kind: string; user_a: number; user_b: number }>(
      'SELECT m.sender_id, m.kind, x.user_a, x.user_b FROM messages m JOIN matches x ON x.id = m.match_id WHERE m.id = ?', id,
    );
    return !!row && row.kind === 'text' && row.sender_id !== null && row.sender_id !== reporterId
      && (row.user_a === reporterId || row.user_b === reporterId);
  },
  label: () => '私聊消息',
  ownerOf: (id) => q.get<{ sender_id: number | null }>('SELECT sender_id FROM messages WHERE id = ?', id)?.sender_id ?? null,
  // 举报时留存原文：之后即使配对被删除（如注销），管理员仍能核实
  snapshot: (id) => q.get<{ body: string }>('SELECT body FROM messages WHERE id = ?', id)?.body ?? '',
});
