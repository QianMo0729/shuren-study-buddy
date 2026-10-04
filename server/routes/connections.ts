import { Router } from 'express';
import type { ContactRequest, ContactReveal } from '../../shared/types.ts';
import { HttpError, rateLimit, requireUser } from '../auth.ts';
import { canExchangeContacts, isContactEligible, isExcluded } from '../connections.ts';
import { iso, q, tx } from '../db.ts';
import { sendContactRequestMail } from '../mail.ts';
import { notify } from '../notify.ts';
import { getProfileRow, parseData } from '../profiles.ts';

export const connectionsRouter = Router();
connectionsRouter.use(requireUser);
connectionsRouter.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });

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
  rateLimit(`contact:${uid}`, 15, 24 * 60 * 60_000);
  const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
  if (message.length > 300) throw new HttpError(400, '申请留言最多 300 字');
  const existing = pairRequest(uid, other);
  if (existing) return res.json({ request: serialize(existing, uid), emailStatus: 'not_sent' });
  const requester = getProfileRow(uid)!;
  const recipient = getProfileRow(other)!;
  const row = tx(() => {
    const id = Number(q.run('INSERT INTO contact_requests (requester_id, recipient_id, message) VALUES (?, ?, ?)', uid, other, message).lastInsertRowid);
    notify(other, '收到联系申请', `${requester.nickname} 希望与你交换联系方式，请查看资料后决定是否接受。`, '/me?tab=connections');
    return q.get<RequestRow>('SELECT * FROM contact_requests WHERE id = ?', id)!;
  });
  const emailStatus = await sendContactRequestMail(recipient.email!, requester.nickname);
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
  if (row.status !== 'pending') throw new HttpError(409, '该申请已经处理');
  const status = action === 'accept' ? 'accepted' : 'rejected';
  const updated = tx(() => {
    q.run("UPDATE contact_requests SET status = ?, updated_at = datetime('now') WHERE id = ? AND status = 'pending'", status, id);
    const nickname = getProfileRow(uid)!.nickname;
    notify(row.requester_id, status === 'accepted' ? '联系申请已接受' : '联系申请未通过',
      status === 'accepted' ? `${nickname} 已接受你的申请，现在可以互相查看联系方式。` : `${nickname} 暂未接受你的联系申请。`, '/me?tab=connections');
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
  const target = q.get('SELECT 1 FROM profiles p JOIN users u ON u.id = p.user_id WHERE p.user_id = ? AND u.activated = 1 AND p.published = 1 AND p.taken_down = 0', other);
  if (!target) throw new HttpError(404, '该主页暂不可用');
  tx(() => {
    q.run('INSERT OR IGNORE INTO exclusions (user_id, target_id) VALUES (?, ?)', uid, other);
    q.run('DELETE FROM contact_requests WHERE (requester_id = ? AND recipient_id = ?) OR (requester_id = ? AND recipient_id = ?)', uid, other, other, uid);
    q.run('DELETE FROM favorites WHERE (user_id = ? AND target_id = ?) OR (user_id = ? AND target_id = ?)', uid, other, other, uid);
    q.run('DELETE FROM contact_views WHERE (viewer_id = ? AND target_id = ?) OR (viewer_id = ? AND target_id = ?)', uid, other, other, uid);
  });
  res.json({ ok: true });
});

connectionsRouter.delete('/:userId/exclude', (req, res) => {
  q.run('DELETE FROM exclusions WHERE user_id = ? AND target_id = ?', req.user!.id, idOf(req.params.userId));
  res.json({ ok: true });
});
