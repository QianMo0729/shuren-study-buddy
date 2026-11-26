import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import bcrypt from 'bcryptjs';
import { DEFAULT_ACTIVITY_CONFIG, addDays, beijingDay, bindingStartsOn, isShurenStudentId, mondayOf, shortDate, validateActivityConfig, weekdayLabel } from '../shared/activity.ts';
import { emptyProfile } from '../shared/profileRules.ts';
import type { BuddyStatus, LeaderboardResponse, ProfileInput } from '../shared/types.ts';

async function startServer() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'study-buddy-activity-'));
  const listener = net.createServer();
  listener.listen(0, '127.0.0.1');
  await once(listener, 'listening');
  const port = (listener.address() as net.AddressInfo).port;
  await new Promise<void>((resolve, reject) => listener.close((error) => error ? reject(error) : resolve()));
  const url = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
    cwd: path.resolve(import.meta.dirname, '..'),
    env: { ...process.env, NODE_ENV: 'test', HOST: '127.0.0.1', PORT: String(port), DATA_DIR: dir,
      APP_URL: url, ADMIN_EMAILS: '', DEV_SHOW_CODES: 'false', RESEND_API_KEY: '',
      SMTP_HOST: '', SMTP_USER: '', SMTP_PASS: '', MAIL_FROM: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (chunk) => { output += String(chunk); });
  child.stderr.on('data', (chunk) => { output += String(chunk); });
  const api = async (endpoint: string, cookie = '', method = 'GET', body?: unknown, headers: Record<string, string> = {}) => {
    const response = await fetch(`${url}/api${endpoint}`, {
      method,
      headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json', Origin: url }), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(10_000),
    });
    const text = await response.text();
    return { status: response.status, text, body: (() => { try { return JSON.parse(text); } catch { return text; } })() as any };
  };
  const stop = async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const ended = once(child, 'exit');
      child.kill('SIGTERM');
      const timer = setTimeout(() => child.kill('SIGKILL'), 2_000);
      try { await ended; } finally { clearTimeout(timer); }
    }
    await fs.rm(dir, { recursive: true, force: true });
  };
  try {
    let ready = false;
    for (let i = 0; i < 200; i++) {
      if (child.exitCode !== null) throw new Error(`API exited: ${output}`);
      try { ready = (await api('/auth/me')).status === 200; } catch { /* Wait for binding. */ }
      if (ready) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.ok(ready, `API did not start: ${output}`);
    return { api, db: new DatabaseSync(path.join(dir, 'app.db')), stop };
  } catch (error) { await stop(); throw error; }
}

test('buddy binding, same-event scoring, own-only ranking, audits, bonus and chat safety', { timeout: 180_000 }, async (t) => {
  const app = await startServer();
  const { api, db } = app;
  t.after(async () => { db.close(); await app.stop(); });
  // 默认的学号落在树仁书院的号段内（前六位 1xx126–1xx130）；shuren = false 时用号段以外的学号
  let studentNumber = 12512600;
  let outsideNumber = 12620000;
  const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

  function createUser(patch: Partial<ProfileInput> = {}, role = 'user', shuren = true) {
    const studentId = String(shuren ? ++studentNumber : ++outsideNumber);
    const email = `${studentId}@mail.sustech.edu.cn`;
    const id = Number(db.prepare('INSERT INTO users (email, activated, password_hash, role) VALUES (?, 1, ?, ?)').run(email, 'fixture-hash', role).lastInsertRowid);
    const data: ProfileInput = {
      ...emptyProfile(), realName: `姓名${id}`, studentId, gender: 'male', grade: 'y1',
      planTags: ['期末复习备考'], places: ['library'], schedule: [0, 1, 2], studyType: 'quiet',
      privacyConsent: { policy: true, contactExchange: true, silentExclusion: true, withdrawal: true }, ...patch,
    };
    const code = `${LETTERS[id % 24]}${LETTERS[(id >> 3) % 24]}${LETTERS[(id >> 6) % 24]}${String(id % 100).padStart(2, '0')}`;
    const nickname = `白鹭${code}`;
    db.prepare("INSERT INTO profiles (user_id, nickname, data, published, saved_at) VALUES (?, ?, ?, 1, datetime('now'))").run(id, nickname, JSON.stringify(data));
    const token = crypto.randomBytes(32).toString('base64url');
    db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
      .run(crypto.createHash('sha256').update(token).digest('hex'), id, new Date(Date.now() + 3_600_000).toISOString());
    return { id, email, cookie: `dz_sid=${token}`, nickname, code };
  }
  type Member = ReturnType<typeof createUser>;

  const admin = createUser({}, 'admin');
  const moderator = createUser({}, 'moderator');
  const status = async (m: Member): Promise<BuddyStatus> => (await api('/activity/me', m.cookie)).body;
  const board = async (m: Member): Promise<LeaderboardResponse> => (await api('/activity/leaderboard', m.cookie)).body;

  /** 直接建立绑定：从 startsOn 起计分 */
  async function bind(a: Member, b: Member) {
    const invited = await api('/activity/invites', a.cookie, 'POST', { userId: b.id });
    assert.equal(invited.status, 200, invited.text);
    const inviteId = (await status(b)).invites.find((i) => i.direction === 'incoming')!.id;
    const accepted = await api(`/activity/invites/${inviteId}/accept`, b.cookie, 'POST', {});
    assert.equal(accepted.status, 200, accepted.text);
    return accepted.body as BuddyStatus & { matchId: number };
  }

  let checkinSeq = 0;
  /** 默认的打卡定位：两人都在同一处、误差 10 米 */
  const LIBRARY = { lat: 22.6025, lng: 113.994, accuracy: 10 };
  type Geo = { lat: number; lng: number; accuracy: number };
  /** 写一条打卡：date 为北京日期，time 为北京时间 HH:mm:ss */
  function checkin(m: Member, date: string, time: string, caption = '一起复习线性代数', extra: { device?: string; photoHash?: string; geo?: Geo | null } = {}) {
    const utc = new Date(Date.parse(`${date}T${time}+08:00`));
    const stamped = utc.toISOString().slice(0, 19).replace('T', ' ');
    const geo = extra.geo === undefined ? LIBRARY : extra.geo;
    return Number(db.prepare(
      `INSERT INTO checkins (user_id, image, caption, place_label, stamped_at, local_date, stamp_text, visibility, created_at, device_hash, photo_hash, geo_lat, geo_lng, geo_accuracy)
       VALUES (?, ?, ?, '图书馆', ?, ?, ?, 'all', ?, ?, ?, ?, ?, ?)`,
    ).run(
      m.id, `${String(++checkinSeq).padStart(24, '0')}.jpg`, caption, stamped, date, `${date} ${time} 北京时间`, stamped, extra.device ?? null, extra.photoHash ?? null,
      geo?.lat ?? null, geo?.lng ?? null, geo?.accuracy ?? null,
    ).lastInsertRowid);
  }

  // 赛季：从三周前的周一开始，已经有三个完整的周
  const today = beijingDay();
  const thisMonday = mondayOf(today);
  const seasonStart = addDays(thisMonday, -21);
  const week = (n: number, day = 0) => addDays(seasonStart, n * 7 + day);
  const config = { ...DEFAULT_ACTIVITY_CONFIG, seasonStart, seasonEnd: addDays(thisMonday, 34) };
  /** 管理员保存一次设置：同时让榜单缓存失效 */
  const saveConfig = async (patch: Partial<typeof config> = {}) => {
    const r = await api('/admin/activity-config', admin.cookie, 'PUT', { config: { ...config, ...patch } });
    assert.equal(r.status, 200, r.text);
  };

  await t.test('activity settings are validated and only admins can change them', async () => {
    assert.equal((await api('/activity/config')).status, 200, 'rules are public');
    assert.equal((await api('/admin/activity-config', moderator.cookie, 'PUT', { config })).status, 403);
    assert.equal((await api('/admin/activity-config', admin.cookie, 'PUT', { config: { ...config, seasonStart: '2026-13-40' } })).status, 400, 'the season start must be a real date');
    assert.equal((await api('/admin/activity-config', admin.cookie, 'PUT', { config: { ...config, seasonEnd: addDays(config.seasonEnd, 1) } })).status, 400, 'the season still ends on a Sunday');
    assert.ok('config' in validateActivityConfig({ ...config, seasonStart: addDays(seasonStart, 3) }), 'the season may start mid-week');
    assert.ok('config' in validateActivityConfig(DEFAULT_ACTIVITY_CONFIG), 'the default settings are valid');
    assert.equal(`${DEFAULT_ACTIVITY_CONFIG.seasonStart} ${weekdayLabel(DEFAULT_ACTIVITY_CONFIG.seasonStart)}`, '2026-11-26 周四', 'scoring starts on Thursday 26 November');
    assert.equal((await api('/admin/activity-config', admin.cookie, 'PUT', { config: { ...config, ladder: [0, 1, 3] } })).status, 400, 'ladder covers 0..cap');
    assert.equal((await api('/admin/activity-config', admin.cookie, 'PUT', { config: { ...config, ladder: [0, 3, 1, 4, 6, 7, 8, 10] } })).status, 400, 'ladder never decreases');
    assert.equal(config.distanceMeters, 300, 'two check-ins at most 300 m apart by default');
    assert.equal((await api('/admin/activity-config', admin.cookie, 'PUT', { config: { ...config, distanceMeters: -1 } })).status, 400);
    assert.equal((await api('/admin/activity-config', admin.cookie, 'PUT', { config: { ...config, accuracyMeters: 5 } })).status, 400);
    await saveConfig();
    const saved = (await api('/activity/config')).body.config;
    assert.equal(saved.weeklyCap, 7, 'plan 2.0: up to 7 same-event days a week');
    assert.deepEqual(saved.ladder, [0, 1, 3, 4, 6, 7, 8, 10]);
  });

  await t.test('binding needs both sides and is strictly one-to-one', async () => {
    const a = createUser();
    const b = createUser();
    const c = createUser();
    assert.equal((await api('/activity/invites', a.cookie, 'POST', { userId: a.id })).status, 400);
    assert.equal((await api('/activity/invites', a.cookie, 'POST', { userId: b.id })).status, 200, 'nobody is asked about their college any more');
    assert.equal((await api('/activity/invites', a.cookie, 'POST', { userId: c.id })).status, 200);
    const reverse = await api('/activity/invites', b.cookie, 'POST', { userId: a.id });
    assert.equal(reverse.status, 409, 'an invite already waits the other way');
    assert.ok(reverse.body.incomingInviteId);
    const bView = await api(`/profiles/${a.id}`, b.cookie);
    assert.equal(bView.body.profile.buddy.state, 'incoming');
    const accepted = await api(`/activity/invites/${reverse.body.incomingInviteId}/accept`, b.cookie, 'POST', {});
    assert.equal(accepted.status, 200, accepted.text);
    const mine: BuddyStatus = accepted.body;
    assert.equal(mine.pair?.partner.id, a.id);
    assert.equal(mine.pair?.startsOn, addDays(thisMonday, 7), 'scoring starts on the next full week');
    assert.equal(mine.shurenMember, 'yes');
    // 接受后：私聊打开，系统消息写明开始计分的日期，双方其他待处理邀请作废
    const matchId = accepted.body.matchId;
    const messages = db.prepare("SELECT body FROM messages WHERE match_id = ? AND kind = 'system'").all(matchId) as { body: string }[];
    assert.ok(messages.some((m) => m.body.includes('已绑定为学习搭子')));
    assert.equal((db.prepare('SELECT status FROM buddy_invites WHERE from_id = ? AND to_id = ?').get(a.id, c.id) as { status: string }).status, 'cancelled');
    assert.equal((await api('/activity/invites', c.cookie, 'POST', { userId: a.id })).status, 409, 'cannot invite someone who is bound');
    assert.equal((await api(`/profiles/${a.id}`, c.cookie)).body.profile.buddy.otherHasBuddy, true);
    const card = (await api(`/profiles/lookup?id=${a.code}`, c.cookie)).body.items[0];
    assert.equal(card.hasBuddy, true);
    // 已绑定的同学不再出现在别人的每日推荐里
    const deck = await api('/match/deck', c.cookie);
    assert.ok(!deck.body.items.some((item: { id: number }) => item.id === a.id || item.id === b.id));
  });

  await t.test('ID lookup finds a profile by its nickname code, never by student number', async () => {
    const seeker = createUser();
    const target = createUser();
    const byCode = await api(`/profiles/lookup?id=${target.code.toLowerCase()}`, seeker.cookie);
    assert.equal(byCode.status, 200);
    assert.deepEqual(byCode.body.items.map((i: { id: number }) => i.id), [target.id]);
    const byNickname = await api(`/profiles/lookup?id=${encodeURIComponent(` 白鹭 ${target.code} `)}`, seeker.cookie);
    assert.deepEqual(byNickname.body.items.map((i: { id: number }) => i.id), [target.id]);
    assert.deepEqual((await api(`/profiles/lookup?id=${encodeURIComponent(`榕树${target.code}`)}`, seeker.cookie)).body.items, []);
    assert.equal((await api(`/profiles/lookup?id=${target.email.split('@')[0]}`, seeker.cookie)).status, 400);
    db.prepare('INSERT INTO exclusions (user_id, target_id) VALUES (?, ?)').run(target.id, seeker.id);
    assert.deepEqual((await api(`/profiles/lookup?id=${target.code}`, seeker.cookie)).body.items, [], 'exclusions hide profiles from lookup');
  });

  // 记分用的三对搭子：绑定后把开始计分日改到赛季第一天，再写入过去三周的打卡
  const p1 = [createUser(), createUser()] as const;
  const p2 = [createUser(), createUser()] as const;
  const p3 = [createUser(), createUser()] as const;
  const pairIdOf = (m: Member) => (db.prepare("SELECT id FROM buddy_pairs WHERE status = 'active' AND (user_a = ? OR user_b = ?)").get(m.id, m.id) as { id: number }).id;

  await t.test('same-event check-ins: first matching pair per day, same day, within the window, capped weekly, ladder points', async () => {
    for (const [a, b] of [p1, p2, p3]) await bind(a, b);
    db.prepare('UPDATE buddy_pairs SET starts_on = ?, created_at = ? WHERE id IN (?, ?, ?)').run(seasonStart, `${addDays(seasonStart, -3)} 00:00:00`, pairIdOf(p1[0]), pairIdOf(p2[0]), pairIdOf(p3[0]));
    // p1：第 1 周 7 天都打卡（满勤 7 次 → 10 分）；当天之后的打卡不再计分
    for (let d = 0; d < 7; d++) {
      checkin(p1[0], week(0, d), '20:00:00');
      checkin(p1[1], week(0, d), '20:25:00');
    }
    checkin(p1[0], week(0, 0), '21:00:00');
    checkin(p1[1], week(0, 0), '21:05:00');
    // p2：第 1 周三天直接配成、一天补拍配成 → 6 分；另有几种不计分的情况
    for (let d = 0; d < 3; d++) {
      checkin(p2[0], week(0, d), '09:00:00');
      checkin(p2[1], week(0, d), '09:10:00');
    }
    checkin(p2[0], week(0, 4), '09:00:00');
    checkin(p2[1], week(0, 4), '09:31:00'); // 超过 30 分钟
    checkin(p2[0], week(0, 5), '23:50:00');
    checkin(p2[1], week(0, 6), '00:10:00'); // 跨天
    checkin(p2[0], week(1, 0), '10:00:00', '复习');
    checkin(p2[1], week(1, 0), '10:01:00'); // 说明不到 5 个字
    checkin(p2[0], week(1, 1), '10:00:00');
    // 两人最初相差 3 小时；A 补拍后与 B 已有记录相差 5 分钟，计入过去那周。
    checkin(p2[0], week(0, 3), '08:00:00');
    checkin(p2[1], week(0, 3), '11:00:00');
    checkin(p2[0], week(0, 3), '11:05:00');
    // p3：第 2 周 4 次 → 6 分，与 p2 同分；p2 更早达到 → p2 排在前面
    for (let d = 0; d < 4; d++) {
      checkin(p3[0], week(1, d), '15:00:00');
      checkin(p3[1], week(1, d), '15:00:30');
    }
    await saveConfig();
    const b = await board(p1[0]);
    assert.equal(b.through, addDays(thisMonday, -1), 'only completed weeks count');
    assert.deepEqual(b.mine, { rank: 1, tied: false, total: 10 });
    assert.equal(b.pairs, 3);
    assert.ok(!('items' in b), 'students only see their own rank and points');
    for (const other of [p2[0], p3[0]]) assert.ok(!JSON.stringify(b).includes(other.nickname), 'other pairs are never listed');
    assert.equal((await board(createUser())).mine, null, 'a student without a buddy has no rank');
    const staffBoard = (await api('/admin/board', moderator.cookie)).body;
    const totals = new Map(staffBoard.items.map((i: any) => [i.pairId, i.total]));
    assert.equal(totals.get(pairIdOf(p1[0])), 10);
    assert.equal(totals.get(pairIdOf(p2[0])), 6);
    assert.equal(totals.get(pairIdOf(p3[0])), 6);
    assert.equal(staffBoard.items[0].members[0].studentId, '', 'moderators do not see student numbers');
    assert.ok((await api('/admin/board', admin.cookie)).body.items[0].members[0].studentId, 'admins see student numbers to verify the college');
    const st = await status(p1[1]);
    assert.deepEqual(st.rank, { rank: 1, tied: false, total: 3 });
    assert.deepEqual(st.score, { total: 10, through: addDays(thisMonday, -1) });
    assert.equal(st.week?.cap, 7);
  });

  await t.test('my status shows this week, today\'s scoring check-ins and nothing an auditor would use', async () => {
    const a = createUser({ schedule: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62] });
    const b = createUser({ schedule: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62] });
    await bind(a, b);
    db.prepare('UPDATE buddy_pairs SET starts_on = ? WHERE id = ?').run(thisMonday, pairIdOf(a));
    let st = await status(a);
    assert.equal(st.today?.date, today);
    assert.equal(st.today?.mine, null);
    assert.equal(st.today?.partner, null);
    assert.equal(st.today?.pairOutcome, null);
    assert.ok(st.today!.free.length > 0, 'periods when both are free today');
    checkin(a, today, '00:00:01', '一起背单词', { device: 'device-a', photoHash: '0123456789abcdef' });
    assert.equal((await status(a)).today?.pairOutcome, null);
    const partnerFirst = checkin(b, today, '00:10:00', '一起背单词', { device: 'device-b', photoHash: '0123456789abcdef' });
    checkin(a, today, '00:20:00', '第二次只发社区');
    st = await status(a);
    assert.equal(st.today?.mine?.counts, true);
    assert.equal(Date.parse(st.today!.mine!.at), Date.parse(`${today}T00:00:01+08:00`), 'later photos preserve the first successful pair');
    assert.ok(st.today?.partner);
    assert.equal(st.week?.count, 1);
    assert.equal(st.today?.pairOutcome, 'matched');
    assert.equal(st.week?.points, 1);
    assert.deepEqual(st.week?.events, [{ date: today, mine: '00:00', theirs: '00:10', place: '图书馆', distance: 0 }]);
    assert.equal(st.today?.mine?.issue, null);
    assert.equal(st.today?.partner?.place, '图书馆', 'where the buddy checked in, as stamped on the photo');
    const text = JSON.stringify(st);
    assert.ok(!text.includes('device') && !text.includes('0123456789abcdef'), 'device ids and photo fingerprints stay on the server');
    assert.ok(!text.includes(String(LIBRARY.lng)) && !/lat|lng|geo/.test(text), 'coordinates stay on the server');
    assert.equal((await api(`/checkins/${partnerFirst}`, b.cookie, 'DELETE')).status, 200);
    const afterDelete = await status(a);
    assert.deepEqual(afterDelete.today?.partner, { at: st.today!.partner!.at, counts: false, place: '', issue: 'deleted' });
    assert.equal(afterDelete.today?.pairOutcome, null);
    assert.equal(afterDelete.week?.count, 0);
    assert.equal((await status(b)).today?.mine?.issue, 'deleted');
    db.prepare('DELETE FROM checkins WHERE user_id IN (?, ?)').run(a.id, b.id);
    assert.equal((await api('/activity/unbind', a.cookie, 'POST', {})).status, 200);
  });

  await t.test('deleted and ineligible check-ins give way to the first retained matching pair, including for past weekly scores', async () => {
    const [a, b] = [createUser(), createUser()];
    await bind(a, b);
    db.prepare('UPDATE buddy_pairs SET starts_on = ? WHERE id = ?').run(seasonStart, pairIdOf(a));

    // 同一人当天 13:43 已删、13:45 无说明、13:46 合格；两人的状态、周记录和分数均认 13:46。
    for (const date of [today, week(2, 1)]) {
      const original = checkin(a, date, '13:43:00');
      checkin(b, date, '13:44:00');
      assert.equal((await api(`/checkins/${original}`, a.cookie, 'DELETE')).status, 200);
      const short = checkin(a, date, '13:45:00', '');
      if (date === today) {
        const failed = (await status(a)).today!;
        assert.equal(failed.checkinPolicy, 'first_matched_pair');
        assert.deepEqual(failed.mine, { checkinId: short, at: new Date(`${date}T13:45:00+08:00`).toISOString(), counts: false, issue: 'caption' });
        assert.equal(failed.pairOutcome, null);
        assert.ok(!('issue' in (await status(b)).today!.partner!), 'the buddy only knows there is no eligible attempt yet');
      }
      const eligible = checkin(a, date, '13:46:00');
      if (date === today) {
        const mine = await status(a);
        const theirs = await status(b);
        assert.equal(mine.today?.mine?.checkinId, eligible);
        assert.equal(mine.today?.mine?.isReplacement, true);
        assert.equal(mine.today?.pairOutcome, 'matched');
        assert.equal(theirs.today?.partner?.isReplacement, true);
        assert.ok(!('checkinId' in theirs.today!.partner!));
        assert.deepEqual(mine.week?.events, [{ date, mine: '13:46', theirs: '13:44', place: '图书馆', distance: 0, mineReplacement: true }]);
        assert.equal(theirs.week?.events[0]?.theirsReplacement, true);
        assert.equal(mine.week?.points, 1);
      }
    }
    assert.equal((await status(a)).score?.total, 1, 'past events are recomputed using the same selection');

    // 原组合删除后先看到超距；同秒补拍能直接递补，之后的成功组合不会再替换它。
    const firstEligible = (await status(a)).today!.mine!.checkinId!;
    const farther = checkin(a, today, '13:47:00', '一起复习线性代数', { geo: { ...LIBRARY, lat: 22.615 } });
    assert.equal((await api(`/checkins/${firstEligible}`, a.cookie, 'DELETE')).status, 200);
    const tooFar = await status(a);
    assert.equal(tooFar.today?.mine?.checkinId, farther);
    assert.equal(tooFar.today?.pairOutcome, 'too_far');
    assert.equal(tooFar.week?.count, 0);
    const closer = checkin(a, today, '13:47:00');
    checkin(a, today, '13:47:00');
    const matched = await status(a);
    assert.equal(matched.today?.mine?.checkinId, closer);
    assert.equal(matched.today?.pairOutcome, 'matched');
    assert.equal(matched.week?.count, 1);
    assert.equal(matched.today?.mine?.isReplacement, true);
    assert.equal((await api(`/checkins/${farther}`, a.cookie)).status, 200, 'the failed photo is retained');
    assert.equal((await api('/activity/unbind', a.cookie, 'POST', {})).status, 200);
  });

  await t.test('a time or distance mismatch can be retried from either side until the first successful pair', async () => {
    const [a, b] = [createUser(), createUser()];
    await bind(a, b);
    db.prepare('UPDATE buddy_pairs SET starts_on = ? WHERE id = ?').run(seasonStart, pairIdOf(a));
    const far = { ...LIBRARY, lat: 22.6175 };
    checkin(a, today, '08:00:00');
    checkin(b, today, '09:00:00');
    assert.equal((await status(a)).today?.pairOutcome, 'too_late');

    const farther = checkin(a, today, '09:03:00', '一起复习线性代数', { geo: far });
    checkin(a, today, '09:04:00', '少');
    const pending = await status(a);
    assert.equal(pending.today?.mine?.checkinId, farther, 'most recent individually eligible attempt is shown');
    assert.equal(pending.today?.pairOutcome, 'too_far');
    assert.equal(pending.week?.count, 0);

    const secondB = checkin(b, today, '11:00:00', '一起复习线性代数', { geo: far });
    checkin(b, today, '11:01:00'); // 时间更接近，地点不符合
    assert.equal((await status(b)).today?.pairOutcome, 'too_late');
    const secondA = checkin(a, today, '11:02:00', '一起复习线性代数', { geo: far });
    checkin(a, today, '11:03:00');
    checkin(b, today, '11:04:00');
    const mine = await status(a);
    const theirs = await status(b);
    assert.equal(mine.today?.mine?.checkinId, secondA);
    assert.equal(theirs.today?.mine?.checkinId, secondB, 'an earlier compatible partner photo can still be used');
    assert.equal(mine.today?.pairOutcome, 'matched');
    assert.equal(theirs.today?.pairOutcome, 'matched');
    assert.deepEqual(mine.week?.events, [{ date: today, mine: '11:02', theirs: '11:00', place: '图书馆', distance: 0, mineReplacement: true, theirsReplacement: true }]);
    assert.equal(mine.week?.count, 1);
    assert.equal((await api('/activity/unbind', a.cookie, 'POST', {})).status, 200);
  });

  await t.test('the two check-ins must be close together: far apart, a poor location fix or no location does not count', async () => {
    const [a, b] = [createUser(), createUser()];
    await bind(a, b);
    db.prepare('UPDATE buddy_pairs SET starts_on = ? WHERE id = ?').run(seasonStart, pairIdOf(a));
    // 往北每 0.001 度约 111 米
    const north = (meters: number, accuracy = 20) => ({ lat: LIBRARY.lat + meters / 111_195, lng: LIBRARY.lng, accuracy });
    checkin(a, week(2, 0), '10:00:00');
    checkin(b, week(2, 0), '10:05:00', '一起复习线性代数', { geo: north(250) }); // 相距 250 米：算
    checkin(a, week(2, 1), '10:00:00');
    checkin(b, week(2, 1), '10:05:00', '一起复习线性代数', { geo: north(500) }); // 相距 500 米：不算
    checkin(a, week(2, 2), '10:00:00');
    checkin(b, week(2, 2), '10:05:00', '一起复习线性代数', { geo: north(50, 400) }); // 定位误差 400 米：不算
    checkin(a, week(2, 3), '10:00:00');
    checkin(b, week(2, 3), '10:05:00', '一起复习线性代数', { geo: null }); // 没有定位：不算
    await saveConfig();
    const totalOf = async () => (await api('/admin/board', admin.cookie)).body.items.find((i: any) => i.pairId === pairIdOf(a));
    assert.deepEqual((await totalOf()).weeks.find((w: any) => w.week === week(2)), { week: week(2), count: 1, counted: 1, points: 1 });
    // 管理员把距离设为 0：不再检查距离和定位
    await saveConfig({ distanceMeters: 0 });
    assert.equal((await totalOf()).weeks.find((w: any) => w.week === week(2)).count, 4);
    await saveConfig();

    // 今天第一次打卡定位不准：今天不能计分，页面能说出原因
    checkin(a, today, '00:00:01', '一起复习线性代数', { geo: north(0, 500) });
    const st = await status(a);
    assert.deepEqual({ counts: st.today?.mine?.counts, issue: st.today?.mine?.issue }, { counts: false, issue: 'location' });
    const viewOfPartner = (await status(b)).today?.partner;
    assert.equal(viewOfPartner?.counts, false);
    assert.ok(viewOfPartner && !('issue' in viewOfPartner), 'location failure details stay with the author');
    db.prepare('DELETE FROM checkins WHERE user_id IN (?, ?)').run(a.id, b.id);
    assert.equal((await api('/activity/unbind', a.cookie, 'POST', {})).status, 200);
  });

  await t.test('today explains the same time and distance thresholds used for weekly scoring', async () => {
    const [a, b] = [createUser(), createUser()];
    await bind(a, b);
    const pairId = pairIdOf(a);
    checkin(a, today, '00:00:00');
    // 两台设备各自定位都合格，但相距约 1.7 公里。
    const other = checkin(b, today, '00:30:00', '一起复习线性代数', { geo: { ...LIBRARY, lat: 22.6175 } });
    assert.equal((await status(a)).today?.pairOutcome, null, 'the pair has not started scoring yet');
    db.prepare('UPDATE buddy_pairs SET starts_on = ? WHERE id = ?').run(seasonStart, pairId);

    const expectOutcome = async (expected: 'matched' | 'too_far' | 'too_late' | null) => {
      for (const member of [a, b]) {
        const st = await status(member);
        assert.equal(st.today?.pairOutcome, expected);
        assert.equal(st.week?.events.some((event) => event.date === today), expected === 'matched');
      }
    };
    await expectOutcome('too_far');
    assert.equal((await status(a)).today?.mine?.counts, true);
    assert.equal((await status(b)).today?.mine?.counts, true);

    const movePartner = db.prepare('UPDATE checkins SET geo_lat = ? WHERE id = ?');
    movePartner.run(22.6052, other); // 实际约 300.23 米，展示精度取整后是 300 米
    await expectOutcome('too_far');
    movePartner.run(22.6051, other); // 约 289 米，时间恰好相差 30 分钟
    await expectOutcome('matched');
    db.prepare("UPDATE checkins SET stamped_at = datetime(stamped_at, '+1 second') WHERE id = ?").run(other);
    await expectOutcome('too_late');
    movePartner.run(22.6175, other);
    await expectOutcome('too_late');
    db.prepare("UPDATE checkins SET stamped_at = datetime(stamped_at, '-1 second') WHERE id = ?").run(other);
    await saveConfig({ distanceMeters: 0 });
    await expectOutcome('matched');
    await saveConfig();
    db.prepare('UPDATE checkins SET geo_accuracy = 500 WHERE id = ?').run(other);
    await expectOutcome(null);
    db.prepare('DELETE FROM checkins WHERE user_id IN (?, ?)').run(a.id, b.id);
    assert.equal((await api('/activity/unbind', a.cookie, 'POST', {})).status, 200);
  });

  await t.test('a buddy is named on profiles only when both agree; otherwise others just see that they have one', async () => {
    const [a, b, viewer, excluded] = [createUser(), createUser(), createUser(), createUser()];
    await bind(a, b);
    const profile = async (of: Member, by: Member) => (await api(`/profiles/${of.id}`, by.cookie)).body.profile;
    assert.equal((await profile(a, viewer)).publicBuddy, null, 'hidden by default');
    assert.equal((await profile(a, viewer)).buddy.otherHasBuddy, true);
    let st = (await api('/activity/pair/profile', a.cookie, 'PUT', { show: true })).body as BuddyStatus;
    assert.deepEqual(st.pair?.showOnProfile, { mine: true, partner: false });
    assert.equal((await profile(a, viewer)).publicBuddy, null, 'one side agreeing is not enough');
    assert.equal((await api('/activity/pair/profile', b.cookie, 'PUT', { show: 'yes' })).status, 400);
    st = (await api('/activity/pair/profile', b.cookie, 'PUT', { show: true })).body;
    assert.deepEqual(st.pair?.showOnProfile, { mine: true, partner: true });
    assert.deepEqual((await profile(a, viewer)).publicBuddy, { id: b.id, nickname: b.nickname });
    assert.deepEqual((await profile(b, viewer)).publicBuddy, { id: a.id, nickname: a.nickname });
    // 与搭子互相排除的同学看不到搭子是谁
    db.prepare('INSERT INTO exclusions (user_id, target_id) VALUES (?, ?)').run(b.id, excluded.id);
    assert.equal((await profile(a, excluded)).publicBuddy, null);
    // 任何一方关掉就不再显示；解绑后新的绑定默认不公开
    await api('/activity/pair/profile', a.cookie, 'PUT', { show: false });
    assert.equal((await profile(b, viewer)).publicBuddy, null);
    await api('/activity/pair/profile', a.cookie, 'PUT', { show: true });
    assert.equal((await api('/activity/unbind', a.cookie, 'POST', {})).status, 200);
    assert.equal((await api('/activity/pair/profile', a.cookie, 'PUT', { show: true })).status, 409, 'no buddy, nothing to show');
    await bind(a, b);
    assert.equal((await profile(a, viewer)).publicBuddy, null);
    assert.equal((await api('/activity/unbind', a.cookie, 'POST', {})).status, 200);
  });

  await t.test('ties use the published order and identical records share a rank', async () => {
    // p3 在第 1 周补一次 → 打卡分 1+6=7 > p2 的 6
    checkin(p3[0], week(0, 2), '08:00:00');
    checkin(p3[1], week(0, 2), '08:20:00');
    await saveConfig();
    let items = (await api('/admin/board', admin.cookie)).body.items;
    assert.deepEqual(items.slice(0, 3).map((i: any) => i.pairId), [pairIdOf(p1[0]), pairIdOf(p3[0]), pairIdOf(p2[0])]);
    // 让 p2 与 p3 的记录完全相同 → 并列
    db.prepare('DELETE FROM checkins WHERE user_id IN (?, ?)').run(p2[0].id, p2[1].id);
    for (const [n, d] of [[0, 2], [1, 0], [1, 1], [1, 2], [1, 3]] as const) {
      checkin(p2[0], week(n, d), '15:00:00');
      checkin(p2[1], week(n, d), '15:05:00');
    }
    await saveConfig();
    items = (await api('/admin/board', admin.cookie)).body.items;
    assert.deepEqual(items.slice(0, 3).map((i: any) => [i.rank, i.tied]), [[1, false], [2, true], [2, true]]);
    assert.deepEqual((await board(p2[0])).mine, { rank: 2, tied: true, total: 7 });
  });

  await t.test('invalidated check-ins stop counting; the appeal must be decided by a different reviewer', async () => {
    const target = db.prepare('SELECT id FROM checkins WHERE user_id = ? ORDER BY id LIMIT 1').get(p1[0].id) as { id: number };
    assert.equal((await api(`/admin/checkins/${target.id}/invalidate`, p1[1].cookie, 'POST', { reason: '疑似代打卡' })).status, 403);
    assert.equal((await api(`/admin/checkins/${target.id}/invalidate`, moderator.cookie, 'POST', { reason: '随便写的理由' })).status, 400, 'reasons come from the fixed list');
    assert.equal((await api(`/admin/checkins/${target.id}/invalidate`, moderator.cookie, 'POST', { reason: '其他' })).status, 400, '"other" needs a note');
    const done = await api(`/admin/checkins/${target.id}/invalidate`, moderator.cookie, 'POST', { reason: '画面中没有学习内容' });
    assert.equal(done.status, 200, done.text);
    const mine = (await api(`/checkins/${target.id}`, p1[0].cookie)).body.checkin;
    assert.equal(mine.invalid.reason, '画面中没有学习内容');
    assert.equal(mine.invalid.canAppeal, true);
    assert.equal((await api(`/checkins/${target.id}`, p2[0].cookie)).body.checkin.invalid, null, 'others never see the invalidation');
    // 原组合被判无效时，21:00 和 21:05 的补拍仍然配成。再删掉后者就没有合格组合。
    const totalOf = async () => (await api('/admin/board', admin.cookie)).body.items.find((i: any) => i.pairId === pairIdOf(p1[0])).total;
    assert.equal(await totalOf(), 10, 'another matching pair survives invalidation');
    const later = db.prepare('SELECT id FROM checkins WHERE user_id = ? AND local_date = ? ORDER BY stamped_at DESC LIMIT 1').get(p1[1].id, week(0, 0)) as { id: number };
    assert.equal((await api(`/checkins/${later.id}`, p1[1].cookie, 'DELETE')).status, 200);
    assert.equal(await totalOf(), 8, 'the remaining photos cannot form a pair');
    const appeal = await api('/activity/appeals', p1[0].cookie, 'POST', { checkinId: target.id, body: '照片里有课本，只是光线暗' });
    assert.equal(appeal.status, 200, appeal.text);
    assert.equal((await api('/activity/appeals', p1[0].cookie, 'POST', { checkinId: target.id, body: '再来一次' })).status, 409, 'one appeal per check-in');
    const appeals = (await api('/admin/appeals', moderator.cookie)).body.items;
    const row = appeals.find((a: any) => a.checkin.id === target.id);
    assert.equal(row.canDecide, false);
    assert.equal((await api(`/admin/appeals/${row.id}`, moderator.cookie, 'POST', { decision: 'overturned' })).status, 403);
    assert.equal((await api(`/admin/appeals/${row.id}`, admin.cookie, 'POST', { decision: 'overturned', note: '能看到课本' })).status, 200);
    assert.equal((await api(`/checkins/${target.id}`, p1[0].cookie)).body.checkin.invalid, null);
    assert.equal(await totalOf(), 10, 'an overturned appeal restores the day');
  });

  await t.test('three invalid check-ins disqualify the pair; confirmed cheating disqualifies both people', async () => {
    const ids = (db.prepare('SELECT id FROM checkins WHERE user_id = ? AND invalid = 0 ORDER BY id LIMIT 2').all(p2[1].id) as { id: number }[]).map((r) => r.id);
    for (const id of ids) await api(`/admin/checkins/${id}/invalidate`, admin.cookie, 'POST', { reason: '翻拍或不是现场拍摄' });
    const third = db.prepare('SELECT id FROM checkins WHERE user_id = ? AND invalid = 0 ORDER BY id LIMIT 1').get(p2[0].id) as { id: number };
    await api(`/admin/checkins/${third.id}/invalidate`, admin.cookie, 'POST', { reason: '翻拍或不是现场拍摄' });
    const st = await status(p2[0]);
    assert.match(st.pair!.ineligible!, /无效打卡累计 3 次/);
    assert.equal((await board(p2[0])).mine, null, 'ineligible pairs leave the ranking');
    assert.ok((await status(p2[0])).score, 'they still see their points');
    assert.equal((await api(`/admin/pairs/${pairIdOf(p3[0])}/disqualify`, moderator.cookie, 'POST', { reason: '一人操作两个账号' })).status, 200);
    assert.match((await status(p3[1])).pair!.ineligible!, /作弊/);
    assert.equal((await api(`/admin/pairs/${pairIdOf(p3[0])}/disqualify`, moderator.cookie, 'DELETE')).status, 200);
    assert.equal((await status(p3[1])).pair!.ineligible, null);
  });

  await t.test('weekly samples pick random and flagged check-ins once per week', async () => {
    const shared = 'device-hash-shared';
    const ids = [checkin(p1[0], week(2, 3), '12:00:00', '一起复习线性代数', { device: shared }), checkin(p1[1], week(2, 3), '12:00:01', '一起复习线性代数', { device: shared })];
    // A 随后还有时间更近但相距过远的照片，审核对照必须显示真正配对的打卡。
    const unrelated = checkin(p1[0], week(2, 3), '12:00:01', '后来的一张照片', { geo: { ...LIBRARY, lat: 22.615 } });
    // 两张照片的指纹只差 1 位：像是同一部手机在同一个位置拍的；差很多的不标记
    const similar = [checkin(p3[0], week(2, 4), '09:00:00', '一起复习线性代数', { photoHash: 'ffffffff00000000' }), checkin(p3[1], week(2, 4), '09:20:00', '一起复习线性代数', { photoHash: 'ffffffff00000001' })];
    const different = [checkin(p3[0], week(2, 5), '09:00:00', '一起复习线性代数', { photoHash: 'ffffffff00000000' }), checkin(p3[1], week(2, 5), '09:20:00', '一起复习线性代数', { photoHash: '00000000ffffffff' })];
    await saveConfig({ auditRate: 50 });
    db.prepare("DELETE FROM settings WHERE key LIKE 'audit_sample_%'").run();
    const list = (await api('/admin/audits', moderator.cookie)).body.items;
    const flagged = list.filter((item: any) => ids.includes(item.checkinId));
    assert.equal(flagged.length, 2);
    assert.equal(flagged.find((item: any) => item.checkinId === ids[1]).partnerCheckin.id, ids[0]);
    assert.ok(!list.some((item: any) => item.checkinId === unrelated));
    assert.ok(flagged[0].flags.some((f: string) => f.includes('同一台设备')));
    assert.ok(flagged[0].flags.some((f: string) => f.includes('几乎同时')));
    // 审核人员看到两人相距多远和定位误差，看不到经纬度
    assert.equal(flagged[0].distance, 0);
    assert.equal(flagged[0].checkin.accuracy, LIBRARY.accuracy);
    assert.ok(!JSON.stringify(list).includes(String(LIBRARY.lng)));
    const photoFlags = list.filter((item: any) => similar.includes(item.checkinId));
    assert.equal(photoFlags.length, 2);
    assert.ok(photoFlags.every((item: any) => item.flags.some((f: string) => f.includes('照片几乎一样'))));
    assert.ok(!list.some((item: any) => different.includes(item.checkinId) && item.source === 'flag'), 'different photos are not flagged');
    assert.ok(list.some((item: any) => item.source === 'random'));
    const again = (await api('/admin/audits', moderator.cookie)).body.items;
    assert.equal(again.length, list.length, 'a week is only sampled once');
    assert.equal((await api(`/admin/audits/${ids[0]}/pass`, moderator.cookie, 'POST', {})).status, 200);
    const prize = await api('/admin/board/prize-review', moderator.cookie, 'POST', {});
    assert.equal(prize.status, 200);
    assert.ok(prize.body.pairs >= 1);
  });

  await t.test('bonus claims follow the content rules and the weekly and season limits', async () => {
    const [a, b] = p1;
    const short = await api('/forum/posts', a.cookie, 'POST', { title: '错题总结', body: '太短了', images: [], bonus: true });
    assert.equal(short.status, 400);
    assert.equal((db.prepare('SELECT COUNT(*) n FROM forum_posts WHERE user_id = ?').get(a.id) as { n: number }).n, 0, 'a refused claim does not publish the post');
    const body = '我们两人一起整理了线性代数第三章的错题。'.repeat(20);
    const first = await api('/forum/posts', a.cookie, 'POST', { title: '线代错题总结', body, images: [], bonus: true });
    assert.equal(first.status, 200, first.text);
    assert.equal(first.body.post.share, true);
    assert.equal(first.body.post.bonus.status, 'pending');
    const again = await api('/forum/posts', b.cookie, 'POST', { title: '再来一篇', body, images: [], bonus: true });
    assert.equal(again.status, 409, 'one claim per pair per week');
    const loner = createUser();
    assert.equal((await api('/forum/posts', loner.cookie, 'POST', { title: '分享', body, images: [], bonus: true })).status, 400, 'only bound students can claim');
    const shares = await api('/forum/posts?share=1', loner.cookie);
    assert.deepEqual(shares.body.items.map((p: any) => p.id), [first.body.post.id]);
    assert.equal(shares.body.items[0].bonus, undefined, 'only the author and staff see the review state');
    const claim = (await api('/admin/bonus', moderator.cookie)).body.items.find((c: any) => c.post.id === first.body.post.id);
    assert.equal((await api(`/admin/bonus/${claim.id}`, moderator.cookie, 'POST', { decision: 'reject' })).status, 400, 'a rejection needs a reason');
    assert.equal((await api(`/admin/bonus/${claim.id}`, moderator.cookie, 'POST', { decision: 'approve' })).status, 200);
    assert.equal((await api(`/forum/posts/${first.body.post.id}`, a.cookie, 'PUT', { title: '改一下', body, images: [] })).status, 409, 'an approved share is locked');
    // 本周提交的 Bonus 计入本周，本周结束后才进入排名
    const row = (await api('/admin/board', admin.cookie)).body.items.find((i: any) => i.pairId === pairIdOf(a));
    assert.equal(row.bonusPoints, 0);
  });

  await t.test('unbinding clears the pair score for both; a new binding starts from zero next week', async () => {
    const [a, b] = p1;
    const before = await status(b);
    assert.ok(before.pair);
    assert.equal((await api('/activity/unbind', a.cookie, 'POST', {})).status, 200);
    assert.equal((await status(b)).pair, null);
    assert.ok(db.prepare("SELECT 1 FROM notifications WHERE user_id = ? AND title = '搭子绑定已解除'").get(b.id));
    assert.equal((await board(b)).mine, null, 'the ended pair leaves the ranking');
    const rebound = await bind(b, a);
    assert.equal(rebound.pair?.startsOn, addDays(thisMonday, 7));
    const row = (await api('/admin/board', admin.cookie)).body.items.find((i: any) => i.pairId === rebound.pair!.id);
    assert.equal(row.total, 0, 'the old record is not restored');
    // 关闭私聊（解除配对）同时解除绑定
    assert.equal((await api(`/chat/${rebound.matchId}/close`, a.cookie, 'POST', {})).status, 200);
    assert.equal((await status(b)).pair, null);
  });

  await t.test('chat: political terms are blocked, other sensitive terms need confirmation and are flagged for the receiver', async () => {
    const a = createUser();
    const b = createUser();
    const { matchId } = await bind(a, b);
    const send = (body: string, confirm?: boolean) => api(`/chat/${matchId}/messages`, a.cookie, 'POST', { body, confirm });
    const blocked = await send('你听说过法 轮 功吗');
    assert.equal(blocked.status, 400);
    assert.equal(blocked.body.blocked, true);
    const warn = await send('晚上要不要约炮');
    assert.equal(warn.status, 409);
    assert.deepEqual(warn.body.sensitive, ['porn']);
    assert.equal(warn.body.needConfirm, true);
    const ok = await send('晚上要不要约炮', true);
    assert.equal(ok.status, 200);
    assert.deepEqual(ok.body.message.flags, ['porn']);
    assert.equal((await send('考研政治和思政课一起复习吗')).status, 200, 'ordinary study words are not caught');
    const forB = (await api(`/chat/${matchId}`, b.cookie)).body.messages;
    assert.deepEqual(forB.find((m: any) => m.id === ok.body.message.id).flags, ['porn']);
    // 审核员可以编辑词库
    const words = (await api('/admin/chat-words', moderator.cookie)).body.words;
    assert.equal((await api('/admin/chat-words', moderator.cookie, 'PUT', { words: { ...words, violence: [...words.violence, '给你点颜色看看'] } })).status, 200);
    assert.equal((await send('给你 点颜色看看')).status, 409);
    const sys = db.prepare("SELECT body FROM messages WHERE match_id = ? AND kind = 'system' ORDER BY id").all(matchId) as { body: string }[];
    assert.ok(sys.some((m) => m.body.startsWith('请文明交流')), 'new chats start with a civility note');
  });

  await t.test('moderators handle content but cannot see the user list or grant roles; admins can', async () => {
    assert.equal((await api('/admin/overview', moderator.cookie)).status, 200);
    assert.equal((await api('/admin/users', moderator.cookie)).status, 403);
    assert.equal((await api('/admin/staff', moderator.cookie)).status, 403);
    const someone = createUser();
    assert.equal((await api('/admin/overview', someone.cookie)).status, 403);
    assert.equal((await api('/admin/staff', admin.cookie, 'POST', { email: someone.email, role: 'moderator' })).status, 200);
    assert.equal((await api('/admin/overview', someone.cookie)).status, 200);
    assert.equal((await api('/auth/me', someone.cookie)).body.user.role, 'moderator');
    assert.equal((await api('/admin/staff', admin.cookie, 'POST', { email: admin.email, role: 'user' })).status, 400, 'admins cannot demote themselves');
    const staff = (await api('/admin/staff', admin.cookie)).body.items;
    assert.ok(staff.some((s: any) => s.id === moderator.id && s.actions7d > 0), 'recent work is counted per reviewer');
  });

  await t.test('the student number decides who is a Shuren student: only 1xx126nn–1xx130nn count, whatever the year', async () => {
    for (const id of ['12512600', '12512699', '12512801', '12513000', '12513099', '12612601', '12613099', '12412745', '12312901', '13012600']) assert.equal(isShurenStudentId(id), true, id);
    for (const id of ['12512599', '12513100', '12612599', '12613100', '12620001', '12522601', '12532801', '22512601', '02512601', '1251260', '125126001', '', 'admin']) assert.equal(isShurenStudentId(id), false, id);

    const inside = createUser();
    const outside = createUser({}, 'user', false);
    const outside2 = createUser({}, 'user', false);
    const outside3 = createUser({}, 'user', false);
    // 旧版里本人填写的答案和导入的名单都不再起作用
    db.prepare("INSERT OR REPLACE INTO activity_members (user_id, shuren) VALUES (?, 'yes')").run(outside.id);
    db.prepare('INSERT OR REPLACE INTO college_roster (student_id) VALUES (?)').run(outside.email.split('@')[0]);
    db.prepare("INSERT OR REPLACE INTO activity_members (user_id, shuren) VALUES (?, 'no')").run(inside.id);
    assert.equal((await status(inside)).shurenMember, 'yes');
    assert.equal((await status(outside)).shurenMember, 'no');
    assert.equal((await api('/activity/college', outside.cookie, 'PUT', { shurenMember: 'yes' })).status, 404, 'the answer can no longer be set by hand');
    assert.equal((await api('/admin/college-roster', admin.cookie)).status, 404, 'the roster import is gone');

    // 两人都在号段以外：照常绑定，但不参与排名
    await bind(outside2, outside3);
    assert.match((await status(outside2)).pair!.ineligible!, /至少一方是树仁书院学生/);
    assert.equal((await board(outside2)).mine, null);
    // 一方在号段内就可以参与排名
    await bind(outside, inside);
    assert.equal((await status(outside)).pair!.ineligible, null);
    const members = (await api('/admin/board', admin.cookie)).body.items.find((i: any) => i.members.some((m: any) => m.id === inside.id)).members;
    assert.deepEqual(members.map((m: any) => m.shuren).sort(), ['no', 'yes']);
  });

  await t.test('logins record only a hash of the browser device id, so two accounts on one device can be flagged', async () => {
    const password = 'DeviceFixture2026';
    const hash = await bcrypt.hash(password, 4);
    const one = createUser();
    const two = createUser();
    db.prepare('UPDATE users SET password_hash = ? WHERE id IN (?, ?)').run(hash, one.id, two.id);
    const device = 'abcdefghijklmnop1234';
    for (const m of [one, two]) {
      const r = await api('/auth/login', '', 'POST', { email: m.email, password }, { 'X-Device-Id': device });
      assert.equal(r.status, 200, r.text);
    }
    await api('/auth/login', '', 'POST', { email: one.email, password }, { 'X-Device-Id': 'bad id!' });
    const rows = db.prepare('SELECT device_hash, user_id FROM device_seen WHERE user_id IN (?, ?)').all(one.id, two.id) as { device_hash: string; user_id: number }[];
    assert.equal(rows.length, 2, 'malformed ids are ignored');
    assert.equal(rows[0].device_hash, rows[1].device_hash);
    assert.match(rows[0].device_hash, /^[0-9a-f]{64}$/);
    assert.ok(!JSON.stringify(rows).includes(device), 'the raw id is never stored');
  });

  // 放在最后：这一组会改赛季设置
  await t.test('a season that starts mid-week scores only from its first day; the first week is short and still keyed by its Monday', async () => {
    const a = createUser();
    const b = createUser();
    await bind(a, b);
    // 赛季改期之前绑定的组合：记录里的开始计分日还是三周前的周一
    db.prepare('UPDATE buddy_pairs SET starts_on = ?, created_at = ? WHERE id = ?').run(seasonStart, `${addDays(seasonStart, -3)} 00:00:00`, pairIdOf(a));
    // 第 1 周 7 天都打卡；赛季改为从周四开始后，只有周四到周日这 4 次计分
    for (let d = 0; d < 7; d++) {
      checkin(a, week(0, d), '20:00:00');
      checkin(b, week(0, d), '20:05:00');
    }
    const thursday = week(0, 3);
    await saveConfig({ seasonStart: thursday });
    assert.equal((await api('/activity/config')).body.season.start, thursday);
    let st = await status(a);
    assert.equal(st.pair?.startsOn, thursday, 'a pair bound earlier follows the postponed season');
    assert.equal(st.pair?.started, true);
    assert.equal(st.score?.total, 6, 'four same-event check-ins from Thursday to Sunday are worth 6 points');
    const mine = (await api('/admin/board', admin.cookie)).body.items.find((i: any) => i.pairId === pairIdOf(a));
    assert.equal(mine.startsOn, thursday);
    assert.deepEqual(mine.weeks[0], { week: week(0), count: 4, counted: 4, points: 6 }, 'the short first week keeps its Monday as the key');
    assert.equal(mine.total, 6);
    // 同一批打卡，赛季从周一开始时是满勤 10 分
    await saveConfig();
    assert.equal((await status(a)).score?.total, 10);

    // 本周进度也只算赛季第一天之后的打卡：把赛季第一天设成今天，本周更早的打卡不算
    db.prepare('DELETE FROM checkins WHERE user_id IN (?, ?)').run(a.id, b.id);
    for (let day = thisMonday; day <= today; day = addDays(day, 1)) {
      checkin(a, day, '08:00:00');
      checkin(b, day, '08:05:00');
    }
    await saveConfig({ seasonStart: today });
    st = await status(a);
    assert.equal(st.pair?.startsOn, today);
    assert.equal(st.week?.count, 1, 'only today counts in the week the season starts');
    assert.deepEqual(st.week?.events.map((e) => e.date), [today]);
    assert.equal(st.score?.total, 0, 'nothing is added to the total before the first week ends');
    // 抽检按周一编号：赛季从周中开始时，抽检记录的周仍然是周一
    await saveConfig({ seasonStart: thursday });
    db.exec("DELETE FROM settings WHERE key LIKE 'audit_sample_%'");
    assert.equal((await api('/admin/audits', moderator.cookie)).status, 200);
    const sampled = (db.prepare("SELECT key FROM settings WHERE key LIKE 'audit_sample_%' ORDER BY key").all() as { key: string }[]).map((row) => row.key.slice('audit_sample_'.length));
    assert.ok(sampled.length > 0 && sampled.every((key) => mondayOf(key) === key), `audit weeks are Mondays: ${sampled.join(',')}`);
    assert.equal(sampled[0], week(0));
    await saveConfig();
  });

  // 也会改赛季设置，放在最后
  await t.test('a pair bound in the days before a mid-week season start scores from its first day, not from the next Monday', async () => {
    // 规则的日期换算：赛季从周四 11 月 26 日开始
    const rule = (bound: string) => bindingStartsOn(bound, '2026-11-26');
    assert.equal(rule('2026-11-19'), '2026-11-26');
    assert.equal(rule('2026-11-22'), '2026-11-26');
    assert.equal(rule('2026-11-23'), '2026-11-26', 'bound on the Monday of the opening week: the 26th, not the 30th');
    assert.equal(rule('2026-11-25'), '2026-11-26');
    assert.equal(rule('2026-11-26'), '2026-11-30', 'bound on the first day of the season: the next Monday');
    assert.equal(rule('2026-11-29'), '2026-11-30');
    assert.equal(rule('2026-11-30'), '2026-12-07');
    // 赛季从周一开始时和以前一样
    assert.equal(bindingStartsOn('2026-11-22', '2026-11-23'), '2026-11-23');
    assert.equal(bindingStartsOn('2026-11-23', '2026-11-23'), '2026-11-30');

    // 赛季明天开始：今天绑定的从明天起计分，私聊里的系统消息和通知也写明天
    const tomorrow = addDays(today, 1);
    await saveConfig({ seasonStart: tomorrow });
    const [a, b] = [createUser(), createUser()];
    const bound = await bind(a, b);
    assert.equal(bound.pair?.startsOn, tomorrow);
    assert.equal(bound.pair?.started, false);
    assert.equal((db.prepare('SELECT starts_on FROM buddy_pairs WHERE id = ?').get(pairIdOf(a)) as { starts_on: string }).starts_on, tomorrow);
    const said = `${shortDate(tomorrow)}（${weekdayLabel(tomorrow)}）起计分`;
    const system = db.prepare("SELECT body FROM messages WHERE match_id = ? AND kind = 'system' AND body LIKE '%已绑定为学习搭子%'").get(bound.matchId) as { body: string };
    assert.ok(system.body.includes(said), system.body);
    const note = db.prepare("SELECT body FROM notifications WHERE user_id = ? AND title = '搭子邀请已接受'").get(a.id) as { body: string };
    assert.ok(note.body.includes(`${shortDate(tomorrow)} 起开始计分`), note.body);
    assert.equal((await api('/activity/unbind', a.cookie, 'POST', {})).status, 200);
    const unbound = db.prepare("SELECT body FROM notifications WHERE user_id = ? AND title = '搭子绑定已解除'").get(b.id) as { body: string };
    assert.ok(unbound.body.includes(`赛季开始前绑定的从 ${shortDate(tomorrow)}（${weekdayLabel(tomorrow)}）开始计分，之后绑定的从下一个周一开始`), unbound.body);

    // 旧代码在开赛那一周的周一到周三绑定时，记录里存的是下一个周一。这样的组合不用改数据，按绑定日期就按规则算：
    // 上周四开赛、上周二绑定、记录里写着本周一 —— 上周四到周日的打卡都计分，抽检也看得到它们
    const lastThursday = addDays(thisMonday, -4);
    const [c, d] = [createUser(), createUser()];
    await bind(c, d);
    db.prepare('UPDATE buddy_pairs SET starts_on = ?, created_at = ? WHERE id = ?').run(thisMonday, `${addDays(thisMonday, -6)} 04:00:00`, pairIdOf(c));
    const ids: number[] = [];
    // 两人几乎同时拍：每次都会被标记为可疑，全部进入抽检名单，不靠随机
    for (let day = lastThursday; day < thisMonday; day = addDays(day, 1)) ids.push(checkin(c, day, '20:00:00'), checkin(d, day, '20:00:01'));
    await saveConfig({ seasonStart: lastThursday });
    let st = await status(c);
    assert.equal(st.pair?.startsOn, lastThursday, 'bound before the season: scoring starts on its first day whatever the stored record says');
    assert.equal(st.pair?.started, true);
    assert.equal(st.score?.total, 6, 'Thursday to Sunday: four same-event check-ins, 6 points');
    const row = (await api('/admin/board', admin.cookie)).body.items.find((i: any) => i.pairId === pairIdOf(c));
    assert.equal(row.startsOn, lastThursday);
    assert.deepEqual(row.weeks[0], { week: addDays(thisMonday, -7), count: 4, counted: 4, points: 6 });
    db.exec("DELETE FROM settings WHERE key LIKE 'audit_sample_%'");
    assert.equal((await api('/admin/audits', moderator.cookie)).status, 200);
    const audited = db.prepare(`SELECT checkin_id FROM checkin_audits WHERE checkin_id IN (${ids.map(() => '?').join(',')})`).all(...ids);
    assert.equal(audited.length, ids.length, 'the weekly audit sees their scoring check-ins');

    // 本周进度和 Bonus 也按实际开始计分日：赛季今天开始、昨天绑定、记录里写着下周一
    db.prepare('UPDATE buddy_pairs SET starts_on = ?, created_at = ? WHERE id = ?').run(addDays(thisMonday, 7), `${addDays(today, -1)} 04:00:00`, pairIdOf(c));
    db.prepare('DELETE FROM checkins WHERE user_id IN (?, ?)').run(c.id, d.id);
    checkin(c, today, '00:00:01');
    checkin(d, today, '00:10:00');
    await saveConfig({ seasonStart: today });
    st = await status(c);
    assert.equal(st.pair?.startsOn, today);
    assert.equal(st.week?.count, 1, 'this week\'s progress counts from the first day of the season');
    const share = await api('/forum/posts', c.cookie, 'POST', { title: '线代错题总结', body: '我们两人一起整理了线性代数第三章的错题。'.repeat(20), images: [], bonus: true });
    assert.equal(share.status, 200, share.text);
    assert.equal((await api('/activity/unbind', c.cookie, 'POST', {})).status, 200);
    await saveConfig();
  });
});
