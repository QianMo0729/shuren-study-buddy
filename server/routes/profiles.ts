import { Router } from 'express';
import type { ContactReveal, ProfileCard, RecommendationResponse } from '../../shared/types.ts';
import { HttpError, requireUser } from '../auth.ts';
import { q } from '../db.ts';
import { canExchangeContacts, isExcluded } from '../connections.ts';
import { effectiveSchedule, hasPrivacyConsent } from '../../shared/profileRules.ts';
import { buildRanked } from '../matching.ts';
import {
  assertOwnFile, ensureProfile, getProfileRow, missingFields, parseData, publishedRows, sanitizeProfile,
  toCard, toMyProfile, toPublic,
} from '../profiles.ts';
import { advancedMatch, keywordMatch, normalizeQuery, tokenize } from '../search.ts';

export const profileRouter = Router();
profileRouter.use(requireUser);

// ---------- 我的资料 ----------

profileRouter.get('/me', (req, res) => {
  const row = ensureProfile(req.user!.id);
  res.json({ profile: toMyProfile(row), missing: missingFields(parseData(row)) });
});

profileRouter.put('/me', (req, res) => {
  const uid = req.user!.id;
  const row = ensureProfile(uid);
  const data = sanitizeProfile(req.body?.profile);
  data.studentId = req.user!.email.split('@')[0];
  for (const f of data.photos) assertOwnFile(uid, f, 'photo');
  assertOwnFile(uid, data.timetable, 'timetable');
  q.run(
    "UPDATE profiles SET data = ?, saved_at = datetime('now'), reviewed_at = CASE WHEN published = 1 THEN NULL ELSE reviewed_at END WHERE user_id = ?",
    JSON.stringify(data),
    uid,
  );
  if (missingFields(data).length) q.run('UPDATE profiles SET published = 0 WHERE user_id = ?', uid);
  const next = getProfileRow(uid) ?? row;
  res.json({ profile: toMyProfile(next), missing: missingFields(data) });
});

profileRouter.post('/me/nickname', (_req, _res) => {
  throw new HttpError(410, '昵称由系统固定分配，不能修改');
});

profileRouter.post('/me/publish', (req, res) => {
  const row = ensureProfile(req.user!.id);
  const missing = missingFields(parseData(row));
  if (missing.length) throw new HttpError(400, `还有必填项未完成：${missing.map((m) => m.label).join('、')}`, { missing });
  q.run(
    `UPDATE profiles SET published = 1, taken_down = 0, reviewed_at = NULL,
       published_at = CASE WHEN published = 1 AND taken_down = 0 THEN published_at ELSE datetime('now') END
     WHERE user_id = ?`,
    req.user!.id,
  );
  res.json({ ok: true });
});

profileRouter.post('/me/unpublish', (req, res) => {
  q.run('UPDATE profiles SET published = 0 WHERE user_id = ?', req.user!.id);
  res.json({ ok: true });
});

// ---------- 搭子广场 ----------

// 兼容旧接口：与匹配页“列表”相同的排序（只按双向契合度），取前 20 位
profileRouter.get('/recommendations', (req, res) => {
  const ranked = buildRanked(req.user!.id, 20);
  res.json({
    items: ranked.items,
    total: ranked.total,
    eligibleCount: ranked.eligibleCount,
    state: ranked.state,
    missing: ranked.missing,
  } satisfies RecommendationResponse);
});

function viewer(userId: number) {
  const row = getProfileRow(userId);
  const d = row ? parseData(row) : null;
  return { id: userId, schedule: d ? effectiveSchedule(d) : [], gender: d?.gender ?? '' };
}

type Scored = ProfileCard & { _w: number };

function sortCards(items: Scored[], sort: string) {
  return items.sort((a, b) => {
    if (a.isMe !== b.isMe) return a.isMe ? -1 : 1; // 自己的主页永远在第一个
    if (a.match && b.match && a.match.score !== b.match.score) return b.match.score - a.match.score;
    if (a._w !== b._w) return b._w - a._w;
    if (sort === 'overlap' && a.overlapHours !== b.overlapHours) return b.overlapHours - a.overlapHours;
    return (b.publishedAt ?? '').localeCompare(a.publishedAt ?? '');
  });
}

const strip = (items: Scored[]) => items.map(({ _w, ...rest }) => rest);

profileRouter.get('/', (req, res) => {
  const me = viewer(req.user!.id);
  const tokens = tokenize(String(req.query.q ?? ''));
  const sort = String(req.query.sort ?? 'latest');
  const out: Scored[] = [];
  for (const row of publishedRows()) {
    if (isExcluded(me.id, row.user_id)) continue;
    const d = parseData(row);
    const card = toCard(row, d, me) as Scored;
    card._w = 0;
    if (tokens.length) {
      if (card.isMe) continue;
      const m = keywordMatch(row.nickname, d, tokens);
      if (!m) continue;
      card._w = m.weight;
      card.match = m.info;
    }
    out.push(card);
  }
  const total = q.get<{ n: number }>('SELECT COUNT(*) n FROM profiles WHERE published = 1 AND taken_down = 0')!.n;
  res.json({ items: strip(sortCards(out, sort)), total });
});

profileRouter.post('/search', (req, res) => {
  const me = viewer(req.user!.id);
  const query = normalizeQuery(req.body);
  const tokens = tokenize(String(req.body?.keyword ?? ''));
  const out: Scored[] = [];
  for (const row of publishedRows()) {
    if (isExcluded(me.id, row.user_id)) continue;
    if (row.user_id === me.id) continue;
    const d = parseData(row);
    const m = advancedMatch(query, row.nickname, d, me);
    if (!m) continue;
    const card = toCard(row, d, me) as Scored;
    card._w = 0;
    if (tokens.length) {
      const k = keywordMatch(row.nickname, d, tokens);
      if (!k) continue;
      card._w = k.weight;
      m.snippet = k.info.snippet;
    }
    card.match = m;
    out.push(card);
  }
  res.json({ items: strip(sortCards(out, 'overlap')), total: out.length });
});

profileRouter.get('/favorites', (req, res) => {
  const me = viewer(req.user!.id);
  const rows = q.all<any>(
    `SELECT p.* FROM favorites f JOIN profiles p ON p.user_id = f.target_id
     WHERE f.user_id = ? AND p.published = 1 AND p.taken_down = 0 ORDER BY f.created_at DESC`,
    me.id,
  );
  res.json({ items: rows.filter((r) => !isExcluded(me.id, r.user_id)).map((r) => toCard(r, parseData(r), me)) });
});

// ---------- 他人主页 ----------

function visibleRow(id: number, viewerId: number, isAdmin: boolean) {
  const row = getProfileRow(id);
  if (!row) throw new HttpError(404, '没有找到这位同学');
  if (id !== viewerId && !isAdmin && isExcluded(id, viewerId)) throw new HttpError(404, '该主页暂未公开或已下线');
  const visible = row.published && !row.taken_down && hasPrivacyConsent(parseData(row));
  if (!visible && id !== viewerId && !isAdmin) throw new HttpError(404, '该主页暂未公开或已下线');
  return row;
}

profileRouter.get('/:id', (req, res) => {
  const id = Number(req.params.id);
  const me = viewer(req.user!.id);
  const row = visibleRow(id, me.id, req.user!.role === 'admin');
  if (id !== me.id) q.run('UPDATE profiles SET views = views + 1 WHERE user_id = ?', id);
  res.json({ profile: toPublic(row, parseData(row), me.id, me.schedule) });
});

profileRouter.post('/:id/contact', (req, res) => {
  const id = Number(req.params.id);
  const uid = req.user!.id;
  const row = visibleRow(id, uid, req.user!.role === 'admin');
  if (id !== uid && !canExchangeContacts(uid, id)) throw new HttpError(403, '双方确认联系申请后才可交换联系方式');
  const c = parseData(row).contacts;
  const reveal: ContactReveal = {
    email: c.showEmail ? row.email ?? null : null,
    wechat: c.wechat,
    qq: c.qq,
    phone: c.phone,
    other: c.other,
  };
  if (id !== uid) q.run('INSERT OR IGNORE INTO contact_views (viewer_id, target_id) VALUES (?, ?)', uid, id);
  res.json({ contacts: reveal });
});

profileRouter.post('/:id/favorite', (req, res) => {
  const id = Number(req.params.id);
  const uid = req.user!.id;
  if (id === uid) throw new HttpError(400, '不能收藏自己哦');
  visibleRow(id, uid, false);
  const removed = q.run('DELETE FROM favorites WHERE user_id = ? AND target_id = ?', uid, id).changes > 0;
  if (!removed) q.run('INSERT INTO favorites (user_id, target_id) VALUES (?, ?)', uid, id);
  res.json({ isFavorite: !removed });
});
