import { Router } from 'express';
import type { ContactRequest, ContactReveal } from '../../shared/types.ts';
import { HttpError, rateLimit, requireUser } from '../auth.ts';
import { canExchangeContacts, hasContactMethod, isContactEligible, isExcluded } from '../connections.ts';
import { iso, q, tx } from '../db.ts';
import { sendContactRequestMail } from '../mail.ts';
import { activeMatchBetween, addSystemMessage, closeMatch, matchBetween } from '../matches.ts';
import { notify } from '../notify.ts';
import { getProfileRow, parseData } from '../profiles.ts';

// 交换联系方式：只能在互相感兴趣（存在进行中的配对）后，于私聊中发起；双方确认后才互相展示。
export const connectionsRouter = Router();
connectionsRouter.use(requireUser);
connectionsRouter.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });

/** 被拒绝后，原申请人需等待的天数 */
const REREQUEST_DAYS = 7;
const NEED_MATCH = '请先互相感兴趣，在私聊中申请交换联系方式';
const NEED_CONTACTS = '请先在「编辑问卷与资料」里填写至少一种联系方式（微信、QQ、手机或其他），或开启交换校园邮箱';

interface RequestRow {
  id: number;
  requester_id: number;
  recipient_id: number;
  status: ContactRequest['status'];
  message: string;
  created_at: string;
  updated_at: string;
}

function idOf(value: unknown): number {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id < 1) throw new HttpError(404, '没有找到这位同学');
  return id;
}

function assertAvailable(a: number, b: number) {
  if (a === b) throw new HttpError(400, '不能向自己申请联系');
  if (isExcluded(a, b) || !isContactEligible(b)) throw new HttpError(404, '该主页暂不可用');
  if (!isContactEligible(a)) throw new HttpError(403, '请先完善并发布个人资料，确认隐私同意后申请联系');
}

function requireActiveMatch(a: number, b: number) {
  const match = activeMatchBetween(a, b);
  if (!match) throw new HttpError(403, NEED_MATCH);
  return match;
}

/** 交换必须双方都有东西可给，避免“同意后什么也看不到” */
function requireOwnContacts(userId: number) {
  if (!hasContactMethod(userId)) throw new HttpError(400, NEED_CONTACTS, { needContacts: true });
}

function pairRequest(a: number, b: number) {
  return q.get<RequestRow>('SELECT * FROM contact_requests WHERE (requester_id = ? AND recipient_id = ?) OR (requester_id = ? AND recipient_id = ?)', a, b, b, a);
}

function serialize(row: RequestRow, viewerId: number): ContactRequest {
  const otherId = row.requester_id === viewerId ? row.recipient_id : row.requester_id;
  const other = q.get<{ nickname: string }>('SELECT nickname FROM profiles WHERE user_id = ?', otherId);
  return {
    id: row.id, requesterId: row.requester_id, recipientId: row.recipient_id, status: row.status,
    message: row.message, createdAt: iso(row.created_at)!, updatedAt: iso(row.updated_at)!,
    direction: row.requester_id === viewerId ? 'outgoing' : 'incoming',
    other: { id: otherId, nickname: other?.nickname ?? '同学' },
  };
}

const beijingDate = (d: Date) => d.toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai', month: 'long', day: 'numeric' });

connectionsRouter.get('/', (req, res) => {
  const uid = req.user!.id;
  const eligible = isContactEligible(uid);
  const rows = q.all<RequestRow>('SELECT * FROM contact_requests WHERE requester_id = ? OR recipient_id = ? ORDER BY updated_at DESC, id DESC', uid, uid);
  const items = eligible ? rows.filter((row) => {
    const other = row.requester_id === uid ? row.recipient_id : row.requester_id;
    return !isExcluded(uid, other) && isContactEligible(other);
  }).map((row) => serialize(row, uid)) : [];
  const exclusions = q.all<{ id: number; nickname: string }>(
    `SELECT e.target_id AS id, p.nickname FROM exclusions e JOIN profiles p ON p.user_id = e.target_id
     JOIN users u ON u.id = e.target_id WHERE e.user_id = ? AND u.activated = 1 ORDER BY e.created_at DESC`, uid,
  );
  res.json({ items, exclusions });
});

connectionsRouter.get('/:userId', (req, res) => {
  const uid = req.user!.id;
  const other = idOf(req.params.userId);
  assertAvailable(uid, other);
  let contacts: ContactReveal | null = null;
  if (canExchangeContacts(uid, other)) {
    const row = getProfileRow(other)!;
    const c = parseData(row).contacts;
    contacts = { email: c.showEmail ? row.email! : null, wechat: c.wechat, qq: c.qq, phone: c.phone, other: c.other };
    q.run('INSERT OR IGNORE INTO contact_views (viewer_id, target_id) VALUES (?, ?)', uid, other);
  }
  const row = pairRequest(uid, other);
  res.json({ request: row ? serialize(row, uid) : null, contacts });
});

connectionsRouter.post('/:userId', async (req, res) => {
  const uid = req.user!.id;
  const other = idOf(req.params.userId);
  assertAvailable(uid, other);
  const match = requireActiveMatch(uid, other);
  rateLimit(`contact:${uid}`, 15, 24 * 60 * 60_000);
  const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
  if (message.length > 300) throw new HttpError(400, '申请留言最多 300 字');
  const existing = pairRequest(uid, other);
  // 已有待处理或已同意的申请：幂等返回（对方先申请时，由前端引导去同意）
  if (existing && existing.status !== 'rejected') return res.json({ request: serialize(existing, uid), emailStatus: 'not_sent' });
  requireOwnContacts(uid);
  if (existing && existing.requester_id === uid) {
    // 被拒绝后需等待 7 天才能再次申请；拒绝的一方随时可以反过来发起申请
    const retryAt = new Date(new Date(iso(existing.updated_at)!).getTime() + REREQUEST_DAYS * 24 * 60 * 60_000);
    if (retryAt.getTime() > Date.now()) {
      throw new HttpError(409, `对方暂时没有同意，${beijingDate(retryAt)}后可以再次申请`, { retryAt: retryAt.toISOString() });
    }
  }
  const requester = getProfileRow(uid)!;
  const recipient = getProfileRow(other)!;
  const row = tx(() => {
    let id: number;
    if (existing) {
      // 唯一索引按两人组合建立：复用原行改回待处理，方向改为本次申请人
      q.run(`UPDATE contact_requests SET requester_id = ?, recipient_id = ?, status = 'pending', message = ?,
             created_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`, uid, other, message, existing.id);
      id = existing.id;
    } else {
      id = Number(q.run('INSERT INTO contact_requests (requester_id, recipient_id, message) VALUES (?, ?, ?)', uid, other, message).lastInsertRowid);
    }
    addSystemMessage(match.id, `${requester.nickname} 申请交换联系方式。`);
    notify(other, '收到交换联系方式的申请', `${requester.nickname} 希望与你交换联系方式，可以在私聊中同意或拒绝。`, `/messages/${match.id}`);
    return q.get<RequestRow>('SELECT * FROM contact_requests WHERE id = ?', id)!;
  });
  const emailStatus = await sendContactRequestMail(recipient.email!, requester.nickname, match.id);
  // Persist the inbox request even if the notification provider is unavailable.
  res.json({ request: serialize(row, uid), emailStatus });
});

connectionsRouter.post('/:requestId/respond', (req, res) => {
  const uid = req.user!.id;
  const id = idOf(req.params.requestId);
  const action = req.body?.action;
  if (action !== 'accept' && action !== 'reject') throw new HttpError(400, '请选择接受或拒绝');
  const row = q.get<RequestRow>('SELECT * FROM contact_requests WHERE id = ? AND recipient_id = ?', id, uid);
  if (!row) throw new HttpError(404, '联系申请不存在');
  assertAvailable(uid, row.requester_id);
  const match = requireActiveMatch(uid, row.requester_id);
  if (row.status !== 'pending') throw new HttpError(409, '该申请已经处理');
  if (action === 'accept') {
    requireOwnContacts(uid);
    if (!hasContactMethod(row.requester_id)) {
      throw new HttpError(409, '对方的资料里暂时没有可交换的联系方式，可以在聊天里提醒对方补充后再申请');
    }
  }
  const status = action === 'accept' ? 'accepted' : 'rejected';
  const updated = tx(() => {
    q.run("UPDATE contact_requests SET status = ?, updated_at = datetime('now') WHERE id = ? AND status = 'pending'", status, id);
    const nickname = getProfileRow(uid)!.nickname;
    addSystemMessage(match.id, status === 'accepted'
      ? `${nickname} 同意了交换联系方式，双方现在可以在聊天顶部查看彼此的联系方式。`
      : `${nickname} 暂时不想交换联系方式。`);
    notify(row.requester_id, status === 'accepted' ? '已交换联系方式' : '交换联系方式的申请未通过',
      status === 'accepted' ? `${nickname} 同意了交换联系方式，可以在私聊中查看。` : `${nickname} 暂时不想交换联系方式。`, `/messages/${match.id}`);
    return q.get<RequestRow>('SELECT * FROM contact_requests WHERE id = ?', id)!;
  });
  res.json({ request: serialize(updated, uid) });
});

connectionsRouter.post('/:userId/exclude', (req, res) => {
  const uid = req.user!.id;
  const other = idOf(req.params.userId);
  if (other === uid) throw new HttpError(400, '不能排除自己');
  if (q.get('SELECT 1 FROM exclusions WHERE user_id = ? AND target_id = ?', uid, other)) return res.json({ ok: true });
  if (isExcluded(uid, other)) throw new HttpError(404, '该主页暂不可用');
  // 主页可见的同学，或与我有过配对的同学（即使对方已撤回主页）都可以排除
  const target = q.get('SELECT 1 FROM profiles p JOIN users u ON u.id = p.user_id WHERE p.user_id = ? AND u.activated = 1 AND p.published = 1 AND p.taken_down = 0', other);
  if (!target && !matchBetween(uid, other)) throw new HttpError(404, '该主页暂不可用');
  tx(() => {
    q.run('INSERT OR IGNORE INTO exclusions (user_id, target_id) VALUES (?, ?)', uid, other);
    // 被拒绝的申请保留（7 天再次申请的冷却不能靠“排除再取消排除”绕过），其余申请作废
    q.run(`DELETE FROM contact_requests WHERE status <> 'rejected'
           AND ((requester_id = ? AND recipient_id = ?) OR (requester_id = ? AND recipient_id = ?))`, uid, other, other, uid);
    q.run('DELETE FROM favorites WHERE (user_id = ? AND target_id = ?) OR (user_id = ? AND target_id = ?)', uid, other, other, uid);
    q.run('DELETE FROM contact_views WHERE (viewer_id = ? AND target_id = ?) OR (viewer_id = ? AND target_id = ?)', uid, other, other, uid);
    // 排除即解除配对（静默，不通知对方；排除后双方都看不到这段聊天）
    const active = activeMatchBetween(uid, other);
    if (active) closeMatch(active.id, uid);
    // 排除者对对方的选择记为“不感兴趣”（不参与个性化学习）：取消排除后不会因为对方仍保留的“感兴趣”立刻重新配对，
    // 需要在「我的 · 推荐偏好」中放回推荐后再次选择
    q.run(
      `INSERT INTO match_feedback (user_id, target_id, action, features) VALUES (?, ?, 'dislike', '{}')
       ON CONFLICT(user_id, target_id) DO UPDATE SET action = 'dislike', features = '{}', updated_at = datetime('now')`,
      uid, other,
    );
  });
  res.json({ ok: true });
});

connectionsRouter.delete('/:userId/exclude', (req, res) => {
  q.run('DELETE FROM exclusions WHERE user_id = ? AND target_id = ?', req.user!.id, idOf(req.params.userId));
  res.json({ ok: true });
});
