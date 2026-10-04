import { Router, type Request } from 'express';
import { HttpError, rateLimit, requireUser } from '../auth.ts';
import { MESSAGE_MAX, chatSummary, cleanMessageBody, insertMessage, listChats, markRead, messagesPage, visibleMatch } from '../chat.ts';
import { tx } from '../db.ts';
import { closeMatch } from '../matches.ts';

// 私聊：只有互相感兴趣（存在配对）的两人可以聊天。非参与者、互相排除后一律按“不存在”返回 404。
export const chatRouter = Router();
chatRouter.use(requireUser);

function matchIdOf(value: unknown): number {
  const id = Number(value);
  if (!/^\d{1,15}$/.test(String(value)) || !Number.isSafeInteger(id) || id < 1) throw new HttpError(404, '会话不存在');
  return id;
}

/** 可选的非负整数查询参数（消息 id） */
function cursorOf(value: unknown): number | undefined {
  if (value === undefined || value === '') return undefined;
  const n = Number(value);
  if (typeof value !== 'string' || !/^\d{1,15}$/.test(value) || !Number.isSafeInteger(n)) throw new HttpError(400, '参数不正确');
  return n;
}

function matchFor(req: Request) {
  const match = visibleMatch(matchIdOf(req.params.matchId), req.user!.id);
  if (!match) throw new HttpError(404, '会话不存在或已不可见');
  return match;
}

chatRouter.get('/', (req, res) => {
  res.json({ items: listChats(req.user!.id) });
});

chatRouter.get('/:matchId', (req, res) => {
  const uid = req.user!.id;
  const match = matchFor(req);
  const after = cursorOf(req.query.after);
  const before = after === undefined ? cursorOf(req.query.before) : undefined;
  const page = messagesPage(match.id, uid, { after, before });
  res.json({ summary: chatSummary(match.id, uid), ...page });
});

chatRouter.post('/:matchId/messages', (req, res) => {
  const uid = req.user!.id;
  const match = matchFor(req);
  if (match.status !== 'active') throw new HttpError(403, '配对已解除，不能再发送消息');
  const raw = req.body?.body;
  // 先挡住超长输入，避免对很大的字符串做清理
  if (typeof raw === 'string' && raw.length > MESSAGE_MAX * 4) throw new HttpError(400, `消息最多 ${MESSAGE_MAX} 字`);
  const body = cleanMessageBody(raw);
  if (!body) throw new HttpError(400, '消息不能为空');
  if (body.length > MESSAGE_MAX) throw new HttpError(400, `消息最多 ${MESSAGE_MAX} 字`);
  rateLimit(`chat-minute:${uid}`, 20, 60_000);
  rateLimit(`chat-day:${uid}`, 500, 24 * 60 * 60_000);
  // 不发站内通知：对方看到私聊未读角标即可
  const message = tx(() => insertMessage(match.id, uid, body));
  res.json({ message });
});

chatRouter.post('/:matchId/read', (req, res) => {
  const uid = req.user!.id;
  const match = matchFor(req);
  const lastId = Number(req.body?.lastId);
  if (!Number.isSafeInteger(lastId) || lastId < 0) throw new HttpError(400, '参数不正确');
  markRead(match.id, uid, lastId);
  res.json({ ok: true });
});

chatRouter.post('/:matchId/close', (req, res) => {
  const uid = req.user!.id;
  const match = matchFor(req);
  // 静默解除：不通知对方，聊天里会出现「配对已解除」的系统消息；已解除时幂等
  if (match.status === 'active') tx(() => closeMatch(match.id, uid));
  res.json({ ok: true });
});
