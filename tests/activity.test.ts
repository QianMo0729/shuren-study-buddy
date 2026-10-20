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
import { DEFAULT_ACTIVITY_CONFIG, addDays, beijingDay, mondayOf } from '../shared/activity.ts';
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

test('buddy binding, same-event scoring, leaderboard, audits, bonus and chat safety', { timeout: 180_000 }, async (t) => {
  const app = await startServer();
  const { api, db } = app;
  t.after(async () => { db.close(); await app.stop(); });
  let studentNumber = 12620000;
  const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

  function createUser(patch: Partial<ProfileInput> = {}, role = 'user') {
    const studentId = String(++studentNumber);
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
    const invited = await api('/activity/invites', a.cookie, 'POST', { userId: b.id, shurenMember: 'yes' });
    assert.equal(invited.status, 200, invited.text);
    const inviteId = (await status(b)).invites.find((i) => i.direction === 'incoming')!.id;
    const accepted = await api(`/activity/invites/${inviteId}/accept`, b.cookie, 'POST', { shurenMember: 'no' });
    assert.equal(accepted.status, 200, accepted.text);
    return accepted.body as BuddyStatus & { matchId: number };
  }

  let checkinSeq = 0;
  /** 写一条打卡：date 为北京日期，time 为北京时间 HH:mm:ss */
  function checkin(m: Member, date: string, time: string, caption = '一起复习线性代数', extra: { device?: string } = {}) {
    const utc = new Date(Date.parse(`${date}T${time}+08:00`));
    const stamped = utc.toISOString().slice(0, 19).replace('T', ' ');
    return Number(db.prepare(
      `INSERT INTO checkins (user_id, image, caption, place_label, stamped_at, local_date, stamp_text, visibility, created_at, device_hash)
       VALUES (?, ?, ?, '图书馆', ?, ?, ?, 'all', ?, ?)`,
    ).run(m.id, `${String(++checkinSeq).padStart(24, '0')}.jpg`, caption, stamped, date, `${date} ${time} 北京时间`, stamped, extra.device ?? null).lastInsertRowid);
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
    assert.equal((await api('/admin/activity-config', admin.cookie, 'PUT', { config: { ...config, seasonStart: addDays(seasonStart, 1) } })).status, 400, 'season starts on a Monday');
    assert.equal((await api('/admin/activity-config', admin.cookie, 'PUT', { config: { ...config, ladder: [0, 1, 3] } })).status, 400, 'ladder covers 0..cap');
    assert.equal((await api('/admin/activity-config', admin.cookie, 'PUT', { config: { ...config, ladder: [0, 3, 1, 4, 6, 8] } })).status, 400, 'ladder never decreases');
    await saveConfig();
    assert.equal((await api('/activity/config')).body.config.weeklyCap, 5);
  });

  await t.test('binding needs both sides, the Shuren answer, and is strictly one-to-one', async () => {
    const a = createUser();
    const b = createUser();
    const c = createUser();
    const noAnswer = await api('/activity/invites', a.cookie, 'POST', { userId: b.id });
    assert.equal(noAnswer.status, 400);
    assert.equal(noAnswer.body.needShuren, true);
    assert.equal((await api('/activity/invites', a.cookie, 'POST', { userId: a.id, shurenMember: 'yes' })).status, 400);
    assert.equal((await api('/activity/invites', a.cookie, 'POST', { userId: b.id, shurenMember: 'yes' })).status, 200);
    assert.equal((await api('/activity/invites', a.cookie, 'POST', { userId: c.id })).status, 200, 'the answer is remembered');
    const reverse = await api('/activity/invites', b.cookie, 'POST', { userId: a.id, shurenMember: 'no' });
    assert.equal(reverse.status, 409, 'an invite already waits the other way');
    assert.ok(reverse.body.incomingInviteId);
    const bView = await api(`/profiles/${a.id}`, b.cookie);
    assert.equal(bView.body.profile.buddy.state, 'incoming');
    const accepted = await api(`/activity/invites/${reverse.body.incomingInviteId}/accept`, b.cookie, 'POST', {});
    assert.equal(accepted.status, 200, accepted.text);
    const mine: BuddyStatus = accepted.body;
    assert.equal(mine.pair?.partner.id, a.id);
    assert.equal(mine.pair?.startsOn, addDays(thisMonday, 7), 'scoring starts on the next full week');
    assert.equal(mine.shurenMember, 'no');
    // 接受后：私聊打开，系统消息写明开始计分的日期，双方其他待处理邀请作废
    const matchId = accepted.body.matchId;
    const messages = db.prepare("SELECT body FROM messages WHERE match_id = ? AND kind = 'system'").all(matchId) as { body: string }[];
    assert.ok(messages.some((m) => m.body.includes('已绑定为学习搭子')));
    assert.equal((db.prepare('SELECT status FROM buddy_invites WHERE from_id = ? AND to_id = ?').get(a.id, c.id) as { status: string }).status, 'cancelled');
    assert.equal((await api('/activity/invites', c.cookie, 'POST', { userId: a.id, shurenMember: 'yes' })).status, 409, 'cannot invite someone who is bound');
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

  await t.test('same-event check-ins: same day, within the window, once a day, capped weekly, ladder points', async () => {
    for (const [a, b] of [p1, p2, p3]) await bind(a, b);
    db.prepare('UPDATE buddy_pairs SET starts_on = ?, created_at = ? WHERE id IN (?, ?, ?)').run(seasonStart, `${addDays(seasonStart, -3)} 00:00:00`, pairIdOf(p1[0]), pairIdOf(p2[0]), pairIdOf(p3[0]));
    // p1：第 1 周 7 天都打卡（上限 5 次 → 8 分）；同一天的第二次相同事件不重复计
    for (let d = 0; d < 7; d++) {
      checkin(p1[0], week(0, d), '20:00:00');
      checkin(p1[1], week(0, d), '20:25:00');
    }
    checkin(p1[0], week(0, 0), '21:00:00');
    checkin(p1[1], week(0, 0), '21:05:00');
    // p2：第 1 周 4 次 → 6 分；另有几种不计分的情况
    for (let d = 0; d < 4; d++) {
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
    // p3：第 2 周 4 次 → 6 分，与 p2 同分；p2 更早达到 → p2 排在前面
    for (let d = 0; d < 4; d++) {
      checkin(p3[0], week(1, d), '15:00:00');
      checkin(p3[1], week(1, d), '15:00:30');
    }
    await saveConfig();
    const b = await board(p1[0]);
    assert.equal(b.through, addDays(thisMonday, -1), 'only completed weeks count');
    assert.deepEqual(b.items.map((i) => [i.rank, i.mine]), [[1, true], [2, false], [3, false]]);
    assert.ok(!('total' in b.items[0]) && !JSON.stringify(b).includes('"points"'), 'no points are exposed to students');
    const staffBoard = (await api('/admin/board', moderator.cookie)).body;
    const totals = new Map(staffBoard.items.map((i: any) => [i.pairId, i.total]));
    assert.equal(totals.get(pairIdOf(p1[0])), 8);
    assert.equal(totals.get(pairIdOf(p2[0])), 6);
    assert.equal(totals.get(pairIdOf(p3[0])), 6);
    assert.equal(staffBoard.items[0].members[0].studentId, '', 'moderators do not see student numbers');
    assert.ok((await api('/admin/board', admin.cookie)).body.items[0].members[0].studentId, 'admins see student numbers to verify the college');
    const st = await status(p1[1]);
    assert.deepEqual(st.rank, { rank: 1, tied: false, total: 3 });
    assert.equal(st.week?.cap, 5);
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
    items = (await board(p2[0])).items;
    assert.deepEqual(items.map((i) => [i.rank, i.tied]), [[1, false], [2, true], [2, true]]);
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
    // 第 1 周的第一天这对还有一次 21:00 的相同事件 → 本周仍然 5 次
    let total = (await api('/admin/board', admin.cookie)).body.items.find((i: any) => i.pairId === pairIdOf(p1[0])).total;
    assert.equal(total, 8);
    const second = db.prepare('SELECT id FROM checkins WHERE user_id = ? AND local_date = ? AND caption <> \'\' ORDER BY id').all(p1[0].id, week(0, 0)) as { id: number }[];
    await api(`/admin/checkins/${second[1].id}/invalidate`, moderator.cookie, 'POST', { reason: '画面看不清，无法判断' });
    total = (await api('/admin/board', admin.cookie)).body.items.find((i: any) => i.pairId === pairIdOf(p1[0])).total;
    assert.equal(total, 8, 'six other days still reach the weekly cap');
    const appeal = await api('/activity/appeals', p1[0].cookie, 'POST', { checkinId: target.id, body: '照片里有课本，只是光线暗' });
    assert.equal(appeal.status, 200, appeal.text);
    assert.equal((await api('/activity/appeals', p1[0].cookie, 'POST', { checkinId: target.id, body: '再来一次' })).status, 409, 'one appeal per check-in');
    const appeals = (await api('/admin/appeals', moderator.cookie)).body.items;
    const row = appeals.find((a: any) => a.checkin.id === target.id);
    assert.equal(row.canDecide, false);
    assert.equal((await api(`/admin/appeals/${row.id}`, moderator.cookie, 'POST', { decision: 'overturned' })).status, 403);
    assert.equal((await api(`/admin/appeals/${row.id}`, admin.cookie, 'POST', { decision: 'overturned', note: '能看到课本' })).status, 200);
    assert.equal((await api(`/checkins/${target.id}`, p1[0].cookie)).body.checkin.invalid, null);
  });

  await t.test('three invalid check-ins disqualify the pair; confirmed cheating disqualifies both people', async () => {
    const ids = (db.prepare('SELECT id FROM checkins WHERE user_id = ? AND invalid = 0 ORDER BY id LIMIT 2').all(p2[1].id) as { id: number }[]).map((r) => r.id);
    for (const id of ids) await api(`/admin/checkins/${id}/invalidate`, admin.cookie, 'POST', { reason: '翻拍或不是现场拍摄' });
    const third = db.prepare('SELECT id FROM checkins WHERE user_id = ? AND invalid = 0 ORDER BY id LIMIT 1').get(p2[0].id) as { id: number };
    await api(`/admin/checkins/${third.id}/invalidate`, admin.cookie, 'POST', { reason: '翻拍或不是现场拍摄' });
    const st = await status(p2[0]);
    assert.match(st.pair!.ineligible!, /无效打卡累计 3 次/);
    assert.ok(!(await board(p2[0])).items.some((i) => i.mine), 'ineligible pairs leave the leaderboard');
    assert.equal((await api(`/admin/pairs/${pairIdOf(p3[0])}/disqualify`, moderator.cookie, 'POST', { reason: '一人操作两个账号' })).status, 200);
    assert.match((await status(p3[1])).pair!.ineligible!, /作弊/);
    assert.equal((await api(`/admin/pairs/${pairIdOf(p3[0])}/disqualify`, moderator.cookie, 'DELETE')).status, 200);
    assert.equal((await status(p3[1])).pair!.ineligible, null);
  });

  await t.test('weekly samples pick random and flagged check-ins once per week', async () => {
    const shared = 'device-hash-shared';
    const ids = [checkin(p1[0], week(2, 3), '12:00:00', '一起复习线性代数', { device: shared }), checkin(p1[1], week(2, 3), '12:00:01', '一起复习线性代数', { device: shared })];
    await saveConfig({ auditRate: 50 });
    db.prepare("DELETE FROM settings WHERE key LIKE 'audit_sample_%'").run();
    const list = (await api('/admin/audits', moderator.cookie)).body.items;
    const flagged = list.filter((item: any) => ids.includes(item.checkinId));
    assert.equal(flagged.length, 2);
    assert.ok(flagged[0].flags.some((f: string) => f.includes('同一台设备')));
    assert.ok(flagged[0].flags.some((f: string) => f.includes('几乎同时')));
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
    assert.ok(!(await board(b)).items.some((i) => i.mine), 'the ended pair leaves the leaderboard');
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
});
