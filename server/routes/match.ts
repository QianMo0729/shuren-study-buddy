import { Router } from 'express';
import { hasPrivacyConsent, pickProfileInput } from '../../shared/profileRules.ts';
import type { DeckResponse, FeedbackAction, FeedbackItem, FeedbackResult } from '../../shared/types.ts';
import { HttpError, rateLimit, requireUser } from '../auth.ts';
import { isExcluded } from '../connections.ts';
import { iso, q } from '../db.ts';
import { sendMatchMail } from '../mail.ts';
import { feedbackOf, recordFeedback, removeFeedback } from '../matches.ts';
import {
  buildDeck, buildRanked, featuresBetween, feedbackTarget, learnFromFeedback, unlearnFeedback, viewerContext,
} from '../matching.ts';
import { parseFeatures } from '../learning.ts';
import { notify } from '../notify.ts';
import { ensureProfile } from '../profiles.ts';

// 匹配推荐：滑卡、按契合度排序的列表、感兴趣 / 不感兴趣 / 稍后再看
export const matchRouter = Router();
matchRouter.use(requireUser);

/** 主页仍对他人公开（四项隐私同意完整）；已撤回同意的同学不出现在列表中 */
function consented(data: string) {
  try { return hasPrivacyConsent(pickProfileInput(JSON.parse(data))); } catch { return false; }
}

const ACTIONS: FeedbackAction[] = ['like', 'dislike', 'skip'];
const isAction = (v: unknown): v is FeedbackAction => typeof v === 'string' && (ACTIONS as string[]).includes(v);

function limitOf(raw: unknown, fallback: number, max: number) {
  const n = Math.floor(Number(raw));
  return Number.isFinite(n) && n >= 1 ? Math.min(max, n) : fallback;
}

function targetIdOf(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isSafeInteger(n) || n <= 0) throw new HttpError(404, '没有找到这位同学');
  return n;
}

matchRouter.get('/deck', (req, res) => {
  rateLimit(`match-deck:${req.user!.id}`, 120, 60_000);
  res.json(buildDeck(req.user!.id, limitOf(req.query.limit, 20, 40)) satisfies DeckResponse);
});

matchRouter.get('/ranked', (req, res) => {
  rateLimit(`match-deck:${req.user!.id}`, 120, 60_000);
  res.json(buildRanked(req.user!.id, limitOf(req.query.limit, 50, 100)) satisfies DeckResponse);
});

matchRouter.post('/feedback', (req, res) => {
  const uid = req.user!.id;
  const action = req.body?.action;
  if (!isAction(action)) throw new HttpError(400, '请选择感兴趣、不感兴趣或稍后再看');
  const targetId = targetIdOf(req.body?.targetId);
  if (targetId === uid) throw new HttpError(400, '不能对自己操作哦');
  rateLimit(`match-feedback:${uid}`, 300, 86_400_000);
  const target = feedbackTarget(targetId);
  if (!target || isExcluded(uid, targetId)) throw new HttpError(404, '该主页暂未公开或已下线');
  const viewer = viewerContext(uid);
  if (action === 'like' && viewer.state !== 'ready') {
    throw new HttpError(403, viewer.state === 'incomplete' ? '请先完成问卷并上传主页，再表示感兴趣'
      : viewer.state === 'unpublished' ? '请先上传你的主页，对方才能看到你' : '你的主页目前不参与匹配，请先检查主页状态', { state: viewer.state });
  }

  const features = featuresBetween(viewer.data, target.data);
  const before = feedbackOf(uid, targetId);
  const previous = before ? { features: parseFeatures(before.features), action: before.action } : undefined;
  const result = recordFeedback(uid, targetId, action, features ?? {});
  learnFromFeedback(uid, features, action, previous);

  if (result.newlyMatched && result.matchId) {
    const me = ensureProfile(uid).nickname;
    const link = `/messages/${result.matchId}`;
    notify(uid, '你们互相感兴趣了', `你和 ${target.nickname} 互相感兴趣，现在可以私聊了。`, link);
    notify(targetId, '你们互相感兴趣了', `你和 ${me} 互相感兴趣，现在可以私聊了。`, link);
    // 先表示感兴趣的一方此刻可能不在线，额外发一封邮件；失败不影响本次操作
    void sendMatchMail(target.email, me, result.matchId).catch(() => undefined);
  }
  res.json({ action, matched: result.matched, matchId: result.matchId } satisfies FeedbackResult);
});

matchRouter.delete('/feedback/:targetId', (req, res) => {
  const uid = req.user!.id;
  const targetId = targetIdOf(req.params.targetId);
  rateLimit(`match-feedback:${uid}`, 300, 86_400_000);
  const before = feedbackOf(uid, targetId);
  if (before) {
    removeFeedback(uid, targetId);
    unlearnFeedback(uid, parseFeatures(before.features), before.action);
  }
  res.json({ ok: true });
});

matchRouter.get('/feedback', (req, res) => {
  const uid = req.user!.id;
  const action = req.query.action;
  if (!isAction(action)) throw new HttpError(400, '请选择要查看的反馈类型');
  const rows = q.all<{ target_id: number; nickname: string; action: FeedbackAction; created_at: string; data: string }>(
    `SELECT f.target_id, p.nickname, f.action, f.updated_at AS created_at, p.data
     FROM match_feedback f
     JOIN profiles p ON p.user_id = f.target_id
     JOIN users u ON u.id = f.target_id
     WHERE f.user_id = ? AND f.action = ? AND p.published = 1 AND p.taken_down = 0
       AND u.activated = 1 AND u.password_hash IS NOT NULL AND u.password_hash <> ''
       AND NOT EXISTS (SELECT 1 FROM exclusions e WHERE (e.user_id = f.user_id AND e.target_id = f.target_id) OR (e.user_id = f.target_id AND e.target_id = f.user_id))
     ORDER BY f.updated_at DESC, f.target_id DESC LIMIT 200`,
    uid, action,
  );
  const items: FeedbackItem[] = rows
    .filter((row) => consented(row.data))
    .map((row) => ({ targetId: row.target_id, nickname: row.nickname, action: row.action, createdAt: iso(row.created_at)! }));
  res.json({ items });
});
