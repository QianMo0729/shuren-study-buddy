import { Router } from 'express';
import type { ContactReveal, ProfileCard, ProfileDraft, QuestionnaireSection, RecommendationResponse } from '../../shared/types.ts';
import { HttpError, requireUser } from '../auth.ts';
import { iso, q, tx } from '../db.ts';
import { canExchangeContacts, isExcluded } from '../connections.ts';
import { effectiveSchedule, hasPrivacyConsent } from '../../shared/profileRules.ts';
import { invalidSelectedSemesterCourses, invalidSelectedSubjects } from '../../shared/courseCatalog.ts';
import { SEMESTER_COURSE_LIMIT, SUBJECT_LIMIT } from '../../shared/options.ts';
import { preserveDraftGoalDate } from '../../shared/goalDate.ts';
import { buildRanked } from '../matching.ts';
import {
  assertOwnFile, ensureProfile, getProfileRow, missingFields, parseData, profileSnapshot, publishedRows, sanitizeContacts, sanitizeProfile,
  toCard, toMyProfile, toPublic,
} from '../profiles.ts';
import { advancedMatch, keywordMatch, normalizeQuery, tokenize } from '../search.ts';
import { registerReportTarget } from '../social.ts';
import { applyAutoModeration, publicProfileText, reviewState } from '../autoModeration.ts';

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
  const data = sanitizeProfile(req.body?.profile, [
    ...parseData(row).subjects,
    ...(profileDraft(uid, req.user!.email)?.form.subjects ?? []),
  ]);
  data.studentId = req.user!.email.split('@')[0];
  for (const f of data.photos) assertOwnFile(uid, f, 'photo');
  assertOwnFile(uid, data.timetable, 'timetable');
  tx(() => {
    q.run("UPDATE profiles SET data = ?, saved_at = datetime('now') WHERE user_id = ?", JSON.stringify(data), uid);
    if (missingFields(data).length) q.run('UPDATE profiles SET published = 0, auto_held = 0, risk_reasons = \'[]\', taken_down = CASE WHEN auto_held = 1 THEN 0 ELSE taken_down END WHERE user_id = ?', uid);
    else if (row.published) applyAutoModeration('profiles', uid, publicProfileText(data));
  });
  const next = getProfileRow(uid) ?? row;
  res.json({ profile: toMyProfile(next), missing: missingFields(data) });
});

const draftSections: QuestionnaireSection[] = ['identity', 'demographics', 'goals', 'study', 'personality', 'expectations', 'privacy', 'review'];

function profileDraft(userId: number, email: string): ProfileDraft | null {
  const row = q.get<{ data: string; section: QuestionnaireSection; updated_at: string }>(
    'SELECT data, section, updated_at FROM profile_drafts WHERE user_id = ?', userId,
  );
  if (!row) return null;
  const raw = JSON.parse(row.data);
  const form = sanitizeProfile(raw, raw.subjects, { draft: true });
  form.goalDeadline = preserveDraftGoalDate(raw.goalDeadline, form.goalDeadline);
  form.studentId = email.split('@')[0];
  return { form, section: row.section, updatedAt: iso(row.updated_at)! };
}

profileRouter.get('/me/draft', (req, res) => {
  res.json({ draft: profileDraft(req.user!.id, req.user!.email) });
});

profileRouter.put('/me/draft', (req, res) => {
  const uid = req.user!.id;
  const section = req.body?.section;
  if (!draftSections.includes(section)) throw new HttpError(400, '问卷部分无效，请刷新后重试');
  if (!req.body?.profile || typeof req.body.profile !== 'object' || Array.isArray(req.body.profile)) {
    throw new HttpError(400, '问卷草稿格式不正确');
  }
  const row = getProfileRow(uid);
  const data = sanitizeProfile(req.body.profile, [
    ...(row ? parseData(row).subjects : []),
    ...(profileDraft(uid, req.user!.email)?.form.subjects ?? []),
  ], { draft: true });
  data.goalDeadline = preserveDraftGoalDate(req.body.profile.goalDeadline, data.goalDeadline);
  data.studentId = req.user!.email.split('@')[0];
  for (const file of data.photos) assertOwnFile(uid, file, 'photo');
  assertOwnFile(uid, data.timetable, 'timetable');
  ensureProfile(uid);
  q.run(
    `INSERT INTO profile_drafts (user_id, data, section) VALUES (?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET data = excluded.data, section = excluded.section, updated_at = datetime('now')`,
    uid, JSON.stringify(data), section,
  );
  res.json({ draft: profileDraft(uid, req.user!.email)! });
});

// 只更新微信 / QQ：私聊里申请或同意交换时发现自己还没填，就地补上即可，不必回问卷重新提交。
// 联系方式不公开展示、不参与匹配，只在双方都同意交换后互相可见，所以直接写入已保存的资料；
// 草稿里的联系方式同步更新，之后提交问卷不会把它冲掉。其余答案与时间戳都不动。
profileRouter.put('/me/contacts', (req, res) => {
  const uid = req.user!.id;
  const row = getProfileRow(uid);
  if (!row) throw new HttpError(404, '请先填写问卷');
  const current = parseData(row).contacts;
  const text = (v: unknown, fallback: string) => (typeof v === 'string' ? v : fallback);
  const contacts = sanitizeContacts({ ...current, wechat: text(req.body?.wechat, current.wechat), qq: text(req.body?.qq, current.qq) });
  if (!contacts.wechat && !contacts.qq) throw new HttpError(400, '请填写微信号或 QQ 号');
  tx(() => {
    q.run('UPDATE profiles SET data = ? WHERE user_id = ?', JSON.stringify({ ...parseData(row), contacts }), uid);
    const draft = q.get<{ data: string }>('SELECT data FROM profile_drafts WHERE user_id = ?', uid);
    if (draft) {
      let data: Record<string, unknown> = {};
      try { data = JSON.parse(draft.data); } catch { /* 无法解析的草稿不处理 */ }
      q.run('UPDATE profile_drafts SET data = ? WHERE user_id = ?', JSON.stringify({ ...data, contacts }), uid);
    }
  });
  res.json({ contacts: { wechat: contacts.wechat, qq: contacts.qq } });
});

profileRouter.post('/me/nickname', (_req, _res) => {
  throw new HttpError(410, '昵称由系统固定分配，不能修改');
});

profileRouter.post('/me/publish', (req, res) => {
  const row = ensureProfile(req.user!.id);
  if (row.taken_down && !row.auto_held) throw new HttpError(409, '主页已被管理员撤下，可修改资料后联系管理员复核');
  const data = parseData(row);
  const missing = missingFields(data);
  if (invalidSelectedSubjects(data.subjects).length) {
    missing.push({ key: 'subjects', label: '具体课程 / 考试（请从列表重新选择）' });
  }
  if (data.subjects.length > SUBJECT_LIMIT) missing.push({ key: 'subjects', label: `目标科目（最多 ${SUBJECT_LIMIT} 项）` });
  if (invalidSelectedSemesterCourses(data.semesterCourses).length) {
    missing.push({ key: 'semesterCourses', label: '本学期课表课程（请从课程目录选择）' });
  }
  if (data.semesterCourses.length > SEMESTER_COURSE_LIMIT) missing.push({ key: 'semesterCourses', label: `本学期课表课程（最多 ${SEMESTER_COURSE_LIMIT} 门）` });
  if (missing.length) throw new HttpError(400, `还有必填项未完成：${missing.map((m) => m.label).join('、')}`, { missing });
  tx(() => {
    q.run(
      `UPDATE profiles SET published = 1,
         published_at = CASE WHEN published = 1 AND taken_down = 0 THEN published_at ELSE datetime('now') END
       WHERE user_id = ?`,
      req.user!.id,
    );
    applyAutoModeration('profiles', req.user!.id, publicProfileText(data));
    q.run('DELETE FROM profile_drafts WHERE user_id = ?', req.user!.id);
  });
  res.json({ ok: true, ...reviewState(getProfileRow(req.user!.id)!) });
});

profileRouter.post('/me/unpublish', (req, res) => {
  q.run("UPDATE profiles SET published = 0, auto_held = 0, risk_reasons = '[]', taken_down = CASE WHEN auto_held = 1 THEN 0 ELSE taken_down END WHERE user_id = ?", req.user!.id);
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

// 举报主页：只能举报此刻自己看得到的他人主页，判断条件与上面的 visibleRow 相同
registerReportTarget('profile', {
  canReport: (reporterId, id) => {
    if (id === reporterId) return false;
    try { return !!visibleRow(id, reporterId, false); } catch { return false; }
  },
  label: (id) => getProfileRow(id)?.nickname ?? '（已删除）',
  ownerOf: (id) => (getProfileRow(id) ? id : null),
  snapshot: (id) => {
    const row = getProfileRow(id);
    return row ? profileSnapshot(row, parseData(row)) : '';
  },
});

profileRouter.get('/:id', (req, res) => {
  const id = Number(req.params.id);
  const me = viewer(req.user!.id);
  const row = visibleRow(id, me.id, req.user!.role === 'admin');
  if (id !== me.id) q.run('UPDATE profiles SET views = views + 1 WHERE user_id = ?', id);
  res.json({ profile: toPublic(row, parseData(row), me.id, me.schedule, req.user!.role === 'admin') });
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
