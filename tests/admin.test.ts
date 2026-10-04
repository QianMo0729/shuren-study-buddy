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
import { emptyProfile } from '../shared/profileRules.ts';
import type { ProfileInput } from '../shared/types.ts';

async function startServer() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'study-buddy-admin-'));
  const listener = net.createServer();
  listener.listen(0, '127.0.0.1');
  await once(listener, 'listening');
  const port = (listener.address() as net.AddressInfo).port;
  await new Promise<void>((resolve, reject) => listener.close((error) => error ? reject(error) : resolve()));
  const url = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
    cwd: path.resolve(import.meta.dirname, '..'),
    env: { ...process.env, NODE_ENV: 'test', HOST: '127.0.0.1', PORT: String(port), DATA_DIR: dir,
      APP_URL: url, ADMIN_EMAILS: '', DEV_SHOW_CODES: 'true', RESEND_API_KEY: '',
      SMTP_HOST: '', SMTP_USER: '', SMTP_PASS: '', MAIL_FROM: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (chunk) => { output += String(chunk); });
  child.stderr.on('data', (chunk) => { output += String(chunk); });
  const api = async (endpoint: string, cookie = '', method = 'GET', body?: unknown) => {
    const response = await fetch(`${url}/api${endpoint}`, { method, headers: {
      ...(cookie ? { Cookie: cookie } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json', Origin: url }),
    }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(10_000) });
    const text = await response.text();
    return { status: response.status, text, body: (() => { try { return JSON.parse(text); } catch { return text; } })() };
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
    const db = new DatabaseSync(path.join(dir, 'app.db'));
    return { api, db, stop };
  } catch (error) { await stop(); throw error; }
}

const consent = { policy: true, contactExchange: true, silentExclusion: true, withdrawal: true };

test('admin moderation covers community posts, comments, check-ins and the new report types', { timeout: 120_000 }, async (t) => {
  const app = await startServer();
  const { api, db } = app;
  t.after(async () => { db.close(); await app.stop(); });

  let seq = 0;
  function createUser(opts: { role?: 'admin' | 'user'; profile?: Partial<ProfileInput> } = {}) {
    seq++;
    const studentId = `1263${String(seq).padStart(4, '0')}`;
    const email = `${studentId}@mail.sustech.edu.cn`;
    const id = Number(db.prepare("INSERT INTO users (email, activated, password_hash, role) VALUES (?, 1, 'x', ?)").run(email, opts.role ?? 'user').lastInsertRowid);
    const data: ProfileInput = {
      ...emptyProfile(), realName: `私密姓名${id}`, studentId, privacyConsent: consent, planTags: ['期末复习备考'],
      places: ['library'], schedule: [0, 1], studyType: 'quiet', ...opts.profile,
    };
    const nickname = `审核同学${id}`;
    db.prepare('INSERT INTO profiles (user_id, nickname, data, published, published_at) VALUES (?, ?, ?, 1, datetime(\'now\'))').run(id, nickname, JSON.stringify(data));
    const token = crypto.randomBytes(32).toString('base64url');
    db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(
      crypto.createHash('sha256').update(token).digest('hex'), id, new Date(Date.now() + 3_600_000).toISOString());
    return { id, email, nickname, cookie: `dz_sid=${token}` };
  }

  // 社区内容直接写库，不依赖社区模块的接口
  const image = (c: string) => `${c.repeat(24)}.jpg`;
  function insertPost(userId: number, title: string, body: string, images: string[] = []) {
    for (const name of images) db.prepare("INSERT OR IGNORE INTO uploads (name, user_id, kind) VALUES (?, ?, 'forum')").run(name, userId);
    return Number(db.prepare('INSERT INTO forum_posts (user_id, title, body, images) VALUES (?, ?, ?, ?)').run(userId, title, body, JSON.stringify(images)).lastInsertRowid);
  }
  function insertComment(userId: number, targetType: 'post' | 'checkin', targetIdValue: number, body: string) {
    return Number(db.prepare('INSERT INTO forum_comments (target_type, target_id, user_id, body) VALUES (?, ?, ?, ?)').run(targetType, targetIdValue, userId, body).lastInsertRowid);
  }
  function insertCheckin(userId: number, caption: string, name: string) {
    db.prepare("INSERT OR IGNORE INTO uploads (name, user_id, kind) VALUES (?, ?, 'checkin')").run(name, userId);
    return Number(db.prepare(
      `INSERT INTO checkins (user_id, image, caption, place_label, stamped_at, local_date, stamp_text, visibility)
       VALUES (?, ?, ?, '南科大·琳恩图书馆', datetime('now'), '2026-10-04', '2026-10-04 09:30:00 北京时间', 'all')`,
    ).run(userId, name, caption).lastInsertRowid);
  }
  const row = (table: string, id: number) => db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id) as Record<string, any>;
  const notifications = async (user: { cookie: string }) => (await api('/notifications', user.cookie)).body.items as { title: string; body: string; link: string | null }[];
  const content = async (type: string, filter = 'all', q = '') =>
    (await api(`/admin/content?type=${type}&filter=${filter}&q=${encodeURIComponent(q)}`, admin.cookie));
  const ids = (r: { body: any }) => (r.body.items as { id: number }[]).map((i) => i.id);

  const admin = createUser({ role: 'admin' });
  const author = createUser();
  const commenter = createUser();
  const viewer = createUser();

  const postId = insertPost(author.id, '期末周的图书馆', '最近在复习线性代数，一起刷题吗？', [image('a'), image('b')]);
  const quietPost = insertPost(viewer.id, '', '今天的晚霞很好看');
  const deletedPost = insertPost(author.id, '已删除的帖子', '不应出现在审核列表');
  db.prepare('UPDATE forum_posts SET deleted = 1 WHERE id = ?').run(deletedPost);
  const checkinId = insertCheckin(author.id, '今天背了 80 个单词', image('c'));
  const commentId = insertComment(commenter.id, 'post', postId, '我也在复习，加我一个');
  const checkinComment = insertComment(viewer.id, 'checkin', checkinId, '坚持就是胜利');

  await t.test('non-admins cannot reach any admin endpoint', async () => {
    assert.equal((await api('/admin/overview')).status, 401);
    const calls: [string, string, unknown?][] = [
      ['/admin/overview', 'GET'], ['/admin/content?type=forum_post', 'GET'], ['/admin/reports', 'GET'], ['/admin/logs', 'GET'],
      ['/admin/users', 'GET'], ['/admin/profiles', 'GET'], ['/admin/posts', 'GET'],
      ['/admin/takedown', 'POST', { type: 'forum_post', id: postId, reason: '测试' }],
      ['/admin/restore', 'POST', { type: 'forum_post', id: postId }],
      ['/admin/approve', 'POST', { type: 'checkin', ids: [checkinId] }],
      ['/admin/reports/1/resolve', 'POST', {}],
    ];
    for (const [endpoint, method, body] of calls) {
      assert.equal((await api(endpoint, author.cookie, method, body)).status, 403, `${method} ${endpoint}`);
    }
    assert.equal(row('forum_posts', postId).taken_down, 0);
    assert.equal(row('checkins', checkinId).reviewed_at, null);
  });

  await t.test('overview counts pending community content', async () => {
    const r = await api('/admin/overview', admin.cookie);
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.pendingContent, { forum_post: 2, comment: 2, checkin: 1 });
    assert.equal(r.body.stats.pendingCommunity, 5);
    assert.equal(r.body.stats.forumPosts, 2);
    assert.equal(typeof r.body.stats.checkinsToday, 'number');
  });

  await t.test('lists each kind of community content with author, preview and link', async () => {
    assert.equal((await content('profile')).status, 400);
    assert.equal((await content('message')).status, 400);

    const posts = await content('forum_post', 'pending');
    assert.equal(posts.status, 200);
    assert.deepEqual(ids(posts).sort(), [postId, quietPost].sort());
    const p = posts.body.items.find((i: any) => i.id === postId);
    assert.equal(p.type, 'forum_post');
    assert.equal(p.authorId, author.id);
    assert.equal(p.nickname, author.nickname);
    assert.equal(p.email, author.email);
    assert.equal(p.title, '期末周的图书馆');
    assert.match(p.body, /线性代数/);
    assert.equal(p.image, image('a'));
    assert.deepEqual(p.images, [image('a'), image('b')]);
    assert.equal(p.link, `/community/posts/${postId}`);
    assert.equal(p.takenDown, false);
    assert.equal(p.reviewedAt, null);
    assert.equal(p.reports, 0);
    assert.ok(!ids(await content('forum_post', 'all')).includes(deletedPost), 'deleted posts are not listed');

    const comments = await content('comment', 'pending');
    const c = comments.body.items.find((i: any) => i.id === commentId);
    assert.equal(c.body, '我也在复习，加我一个');
    assert.equal(c.link, `/community/posts/${postId}`, 'a comment links to the content it belongs to');
    assert.match(c.title, /期末周的图书馆/);
    assert.equal(c.image, null);
    const cc = comments.body.items.find((i: any) => i.id === checkinComment);
    assert.equal(cc.link, `/community/checkins/${checkinId}`);

    const checkins = await content('checkin', 'pending');
    const k = checkins.body.items.find((i: any) => i.id === checkinId);
    assert.equal(k.body, '今天背了 80 个单词');
    assert.equal(k.image, image('c'));
    assert.match(k.title, /琳恩图书馆/);
    assert.match(k.title, /北京时间/);
    assert.equal(k.link, `/community/checkins/${checkinId}`);

    // 关键词：昵称、邮箱、正文
    assert.deepEqual(ids(await content('forum_post', 'all', '线性代数')), [postId]);
    assert.deepEqual(ids(await content('forum_post', 'all', viewer.nickname)), [quietPost]);
    assert.deepEqual(ids(await content('comment', 'all', commenter.email.toUpperCase())), [commentId]);
    assert.deepEqual(ids(await content('checkin', 'all', '琳恩')), [checkinId]);
    assert.deepEqual(ids(await content('checkin', 'all', "' OR 1=1 --")), [], 'keywords are parameters, not SQL');
  });

  await t.test('approve marks community content as reviewed in batches', async () => {
    assert.equal((await api('/admin/approve', admin.cookie, 'POST', { type: 'nope', ids: [postId] })).status, 400);
    const r = await api('/admin/approve', admin.cookie, 'POST', { type: 'forum_post', ids: [quietPost, quietPost, 'x', -1] });
    assert.equal(r.status, 200);
    assert.equal(r.body.count, 1);
    assert.ok(row('forum_posts', quietPost).reviewed_at);
    assert.equal(row('forum_posts', postId).reviewed_at, null, 'only the listed ids are approved');
    assert.deepEqual(ids(await content('forum_post', 'pending')), [postId]);
    assert.ok(ids(await content('forum_post', 'all')).includes(quietPost));

    assert.equal((await api('/admin/approve', admin.cookie, 'POST', { type: 'comment', ids: [checkinComment] })).body.count, 1);
    assert.equal((await api('/admin/approve', admin.cookie, 'POST', { type: 'checkin', ids: [checkinId] })).body.count, 1);
    assert.ok(row('checkins', checkinId).reviewed_at);
    assert.equal((await api('/admin/approve', admin.cookie, 'POST', { type: 'forum_post', ids: [deletedPost] })).body.count, 0, 'deleted content is skipped');
    const overview = (await api('/admin/overview', admin.cookie)).body;
    assert.deepEqual(overview.pendingContent, { forum_post: 1, comment: 1, checkin: 0 });
    assert.equal(overview.stats.pendingCommunity, 2);
  });

  await t.test('reported filter and report counts follow open reports', async () => {
    db.prepare("INSERT INTO reports (reporter_id, target_type, target_id, reason, detail) VALUES (?, 'forum_post', ?, '其他', '')").run(viewer.id, postId);
    db.prepare("INSERT INTO reports (reporter_id, target_type, target_id, reason, detail) VALUES (?, 'forum_post', ?, '其他', '')").run(commenter.id, postId);
    const reported = await content('forum_post', 'reported');
    assert.deepEqual(ids(reported), [postId]);
    assert.equal(reported.body.items[0].reports, 2);
    assert.deepEqual(ids(await content('comment', 'reported')), []);
  });

  await t.test('taking down a forum post hides it, resolves reports, notifies and mails the author', async () => {
    const before = await api(`/forum/posts/${postId}`, viewer.cookie);
    assert.equal((await api('/admin/takedown', admin.cookie, 'POST', { type: 'forum_post', id: postId, reason: '   ' })).status, 400);
    assert.equal((await api('/admin/takedown', admin.cookie, 'POST', { type: 'forum_post', id: 999_999, reason: '违规' })).status, 404);
    assert.equal((await api('/admin/takedown', admin.cookie, 'POST', { type: 'forum_post', id: deletedPost, reason: '违规' })).status, 404);
    assert.equal((await api('/admin/takedown', admin.cookie, 'POST', { type: 'message', id: 1, reason: '违规' })).status, 400);
    assert.equal((await api('/admin/takedown', admin.cookie, 'POST', { type: 'forum_post', id: 'abc', reason: '违规' })).status, 400);

    const r = await api('/admin/takedown', admin.cookie, 'POST', { type: 'forum_post', id: postId, reason: '包含广告信息' });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.body.emailStatus, 'logged', 'mail goes through sendTakedownMail (logged without SMTP)');
    assert.match(r.body.time, /\d{2}:\d{2}:\d{2}/);
    const stored = row('forum_posts', postId);
    assert.equal(stored.taken_down, 1);
    assert.equal(stored.takedown_reason, '包含广告信息');
    assert.ok(stored.taken_down_at);
    assert.ok(stored.reviewed_at);
    assert.equal((db.prepare("SELECT COUNT(*) n FROM reports WHERE target_type = 'forum_post' AND target_id = ? AND status = 'open'").get(postId) as { n: number }).n, 0);

    const note = (await notifications(author)).find((n) => n.title === '你的社区帖子已被管理员撤下');
    assert.ok(note, 'author is notified');
    assert.match(note.body, /期末周的图书馆/);
    assert.match(note.body, /包含广告信息/);
    assert.equal(note.link, `/community/posts/${postId}`);
    assert.equal((await notifications(viewer)).filter((n) => /撤下/.test(n.title)).length, 0, 'nobody else is notified');

    const log = db.prepare("SELECT * FROM moderation_logs WHERE target_type = 'forum_post' AND target_id = ?").get(postId) as Record<string, any>;
    assert.equal(log.action, 'takedown');
    assert.equal(log.admin_id, admin.id);
    assert.equal(log.target_user_id, author.id);
    assert.equal(log.email_status, 'logged');

    assert.deepEqual(ids(await content('forum_post', 'down')), [postId]);
    assert.ok(!ids(await content('forum_post', 'pending')).includes(postId));
    const listed = (await content('forum_post', 'down')).body.items[0];
    assert.equal(listed.takenDown, true);
    assert.equal(listed.takedownReason, '包含广告信息');

    if (before.status === 200) {
      assert.equal((await api(`/forum/posts/${postId}`, viewer.cookie)).status, 404, 'others can no longer see the post');
      const own = await api(`/forum/posts/${postId}`, author.cookie);
      assert.equal(own.status, 200, 'the author still sees it with the reason');
      assert.equal(own.body.post.takenDown, true);
    } else t.diagnostic(`forum routes unavailable (${before.status}); visibility checked through the database only`);
  });

  await t.test('restore brings the post back and is logged', async () => {
    const r = await api('/admin/restore', admin.cookie, 'POST', { type: 'forum_post', id: postId });
    assert.equal(r.status, 200);
    const stored = row('forum_posts', postId);
    assert.equal(stored.taken_down, 0);
    assert.equal(stored.takedown_reason, null);
    assert.ok((await notifications(author)).some((n) => n.title === '你的社区帖子已恢复展示' && n.link === `/community/posts/${postId}`));
    assert.ok(db.prepare("SELECT 1 FROM moderation_logs WHERE action = 'restore' AND target_type = 'forum_post' AND target_id = ?").get(postId));
    assert.equal((await api('/admin/restore', admin.cookie, 'POST', { type: 'forum_post', id: postId })).status, 409, 'nothing to restore');
    const visible = await api(`/forum/posts/${postId}`, viewer.cookie);
    if (visible.status !== 401) assert.equal(visible.status, 200);
  });

  await t.test('comments can be taken down and restored; the commenter is notified with the parent link', async () => {
    const listBefore = await api(`/forum/post/${postId}/comments`, viewer.cookie);
    const r = await api('/admin/takedown', admin.cookie, 'POST', { type: 'comment', id: commentId, reason: '人身攻击' });
    assert.equal(r.status, 200, r.text);
    assert.equal(row('forum_comments', commentId).taken_down, 1);
    const note = (await notifications(commenter)).find((n) => n.title === '你的评论已被管理员撤下');
    assert.ok(note);
    assert.match(note.body, /加我一个/);
    assert.equal(note.link, `/community/posts/${postId}`);
    assert.deepEqual(ids(await content('comment', 'down')), [commentId]);
    if (listBefore.status === 200 && (listBefore.body.items as { id: number }[]).some((c) => c.id === commentId)) {
      const after = await api(`/forum/post/${postId}/comments`, viewer.cookie);
      assert.ok(!(after.body.items as { id: number }[]).some((c) => c.id === commentId), 'others can no longer see the comment');
    } else t.diagnostic('forum comment routes unavailable; visibility checked through the database only');

    assert.equal((await api('/admin/restore', admin.cookie, 'POST', { type: 'comment', id: commentId })).status, 200);
    assert.equal(row('forum_comments', commentId).taken_down, 0);
    assert.ok((await notifications(commenter)).some((n) => n.title === '你的评论已恢复展示'));
  });

  await t.test('check-ins can be taken down and restored', async () => {
    const before = await api(`/checkins/${checkinId}`, viewer.cookie);
    const r = await api('/admin/takedown', admin.cookie, 'POST', { type: 'checkin', id: checkinId, reason: '与学习无关' });
    assert.equal(r.status, 200, r.text);
    const stored = row('checkins', checkinId);
    assert.equal(stored.taken_down, 1);
    assert.equal(stored.takedown_reason, '与学习无关');
    const note = (await notifications(author)).find((n) => n.title === '你的打卡已被管理员撤下');
    assert.ok(note);
    assert.match(note.body, /80 个单词/);
    assert.equal(note.link, `/community/checkins/${checkinId}`);
    assert.deepEqual(ids(await content('checkin', 'down')), [checkinId]);
    if (before.status === 200) {
      assert.equal((await api(`/checkins/${checkinId}`, viewer.cookie)).status, 404, 'others can no longer see the check-in');
      assert.equal((await api(`/files/${image('c')}`, viewer.cookie)).status, 404, 'nor its photo');
    } else t.diagnostic(`check-in routes unavailable (${before.status}); visibility checked through the database only`);
    assert.equal((await api('/admin/restore', admin.cookie, 'POST', { type: 'checkin', id: checkinId })).status, 200);
    assert.equal(row('checkins', checkinId).taken_down, 0);
  });

  await t.test('no email is sent when the author has deleted the account', async () => {
    const gone = createUser();
    const pid = insertPost(gone.id, '', '注销前发的帖子');
    db.prepare("UPDATE users SET email = ?, activated = 0 WHERE id = ?").run(`deleted-${gone.id}-abc@deleted.invalid`, gone.id);
    const r = await api('/admin/takedown', admin.cookie, 'POST', { type: 'forum_post', id: pid, reason: '违规' });
    assert.equal(r.status, 200);
    assert.equal(r.body.emailStatus, 'skipped');
    assert.equal((db.prepare('SELECT email_status FROM moderation_logs WHERE target_type = ? AND target_id = ?').get('forum_post', pid) as { email_status: string }).email_status, 'skipped');
  });

  await t.test('profile and recruitment post moderation keep working', async () => {
    const r = await api('/admin/takedown', admin.cookie, 'POST', { type: 'profile', id: viewer.id, reason: '照片违规' });
    assert.equal(r.status, 200);
    assert.equal((db.prepare('SELECT taken_down FROM profiles WHERE user_id = ?').get(viewer.id) as { taken_down: number }).taken_down, 1);
    const note = (await notifications(viewer)).find((n) => n.title === '你的个人主页已被管理员撤下');
    assert.equal(note?.link, '/me');
    assert.ok((await api('/admin/profiles?filter=down', admin.cookie)).body.items.some((p: { id: number }) => p.id === viewer.id));
    assert.equal((await api('/admin/restore', admin.cookie, 'POST', { type: 'profile', id: viewer.id })).status, 200);
    assert.equal((db.prepare('SELECT taken_down FROM profiles WHERE user_id = ?').get(viewer.id) as { taken_down: number }).taken_down, 0);

    const recruit = Number(db.prepare("INSERT INTO posts (user_id, title, category, description) VALUES (?, '数分期末互助', 'study', '每周两次')").run(author.id).lastInsertRowid);
    assert.ok((await api('/admin/posts?filter=pending', admin.cookie)).body.items.some((p: { id: number }) => p.id === recruit));
    assert.equal((await api('/admin/approve', admin.cookie, 'POST', { type: 'post', ids: [recruit] })).status, 200);
    assert.ok(!(await api('/admin/posts?filter=pending', admin.cookie)).body.items.some((p: { id: number }) => p.id === recruit));
    const down = await api('/admin/takedown', admin.cookie, 'POST', { type: 'post', id: recruit, reason: '虚假招募' });
    assert.equal(down.status, 200);
    assert.ok((await notifications(author)).some((n) => n.title === '你的帖子已被管理员撤下' && n.link === `/events/${recruit}`));
  });

  await t.test('reports list labels new target types, links and message snapshots', async () => {
    const insertReport = (reporter: number, type: string, id: number, detail: string, snapshot = '') =>
      Number(db.prepare("INSERT INTO reports (reporter_id, target_type, target_id, reason, detail, snapshot) VALUES (?, ?, ?, '不当言论或骚扰', ?, ?)").run(reporter, type, id, detail, snapshot).lastInsertRowid);
    // 私聊消息：配对 + 一条文字消息
    const [x, y] = author.id < viewer.id ? [author.id, viewer.id] : [viewer.id, author.id];
    const matchId = Number(db.prepare('INSERT INTO matches (user_a, user_b) VALUES (?, ?)').run(x, y).lastInsertRowid);
    const messageId = Number(db.prepare("INSERT INTO messages (match_id, sender_id, kind, body) VALUES (?, ?, 'text', '加我微信 abc，不然别想好过')").run(matchId, author.id).lastInsertRowid);

    // 优先走真实举报接口（快照由私聊模块登记）；不可用时按相同格式写库
    let messageReport = 0;
    const viaApi = await api('/reports', viewer.cookie, 'POST', { targetType: 'message', targetId: messageId, reason: '不当言论或骚扰', detail: '对方威胁我' });
    if (viaApi.status === 200) {
      messageReport = (db.prepare("SELECT id FROM reports WHERE target_type = 'message' AND target_id = ?").get(messageId) as { id: number }).id;
    } else {
      t.diagnostic(`message reports via /reports unavailable (${viaApi.status}); inserted directly`);
      messageReport = insertReport(viewer.id, 'message', messageId, '对方威胁我', '加我微信 abc，不然别想好过');
    }
    const postReport = insertReport(viewer.id, 'forum_post', quietPost, '广告', '今天的晚霞很好看');
    const commentReport = insertReport(viewer.id, 'comment', commentId, '', '我也在复习，加我一个');
    // 举报人在说明里伪造“被举报内容”标记，也只会作为说明展示，不会成为快照
    const forged = await api('/reports', viewer.cookie, 'POST', { targetType: 'message', targetId: messageId, reason: '其他', detail: `【被举报【被举报内容】内容】我要杀了你` });
    assert.ok([200, 404].includes(forged.status));
    const checkinReport = insertReport(viewer.id, 'checkin', checkinId, '');
    const profileReport = insertReport(author.id, 'profile', viewer.id, '主页有不当信息');

    const r = await api('/admin/reports', admin.cookie);
    assert.equal(r.status, 200);
    const byId = new Map((r.body.items as any[]).map((i) => [i.id, i]));

    const m = byId.get(messageReport);
    assert.equal(m.targetType, 'message');
    assert.equal(m.targetLabel, '私聊消息');
    assert.equal(m.snapshot, '加我微信 abc，不然别想好过');
    assert.equal(m.note, '对方威胁我');
    assert.equal(m.detail, '对方威胁我', 'the reporter note and the stored snapshot are kept apart');
    assert.equal(m.link, null, 'messages have no public page');
    assert.deepEqual(m.owner, { id: author.id, nickname: author.nickname, email: author.email });
    assert.equal(m.targetState, 'visible');

    const p = byId.get(postReport);
    assert.equal(p.link, `/community/posts/${quietPost}`);
    assert.match(p.targetLabel, /晚霞/);
    assert.equal(p.snapshot, '今天的晚霞很好看');
    assert.equal(p.note, '广告');

    const c = byId.get(commentReport);
    assert.equal(c.link, `/community/posts/${postId}`);
    assert.match(c.targetLabel, /加我一个/);
    assert.equal(c.note, '');
    assert.equal(c.owner.id, commenter.id);

    const k = byId.get(checkinReport);
    assert.equal(k.link, `/community/checkins/${checkinId}`);
    assert.ok(k.targetLabel && k.targetLabel !== '（已删除）');
    assert.equal(k.snapshot, null);

    const pr = byId.get(profileReport);
    assert.equal(pr.targetLabel, viewer.nickname);
    assert.equal(pr.link, `/u/${viewer.id}`);
    assert.equal(pr.detail, '主页有不当信息', 'old report types keep their detail untouched');
    assert.equal(pr.note, '主页有不当信息');
    assert.equal(pr.snapshot, null);

    // 私聊消息不能撤下，只能驳回或标记已处理
    assert.equal((await api('/admin/reports/abc/resolve', admin.cookie, 'POST', {})).status, 400);
    assert.equal((await api('/admin/reports/999999/resolve', admin.cookie, 'POST', {})).status, 404);
    assert.equal((await api(`/admin/reports/${messageReport}/resolve`, admin.cookie, 'POST', { status: 'resolved' })).status, 200);
    assert.equal((db.prepare('SELECT status FROM reports WHERE id = ?').get(messageReport) as { status: string }).status, 'resolved');
    assert.equal((await api(`/admin/reports/${checkinReport}/resolve`, admin.cookie, 'POST', {})).status, 200);
    assert.equal((db.prepare('SELECT status FROM reports WHERE id = ?').get(checkinReport) as { status: string }).status, 'dismissed');
    const open = (await api('/admin/reports', admin.cookie)).body.items.map((i: { id: number }) => i.id);
    assert.ok(!open.includes(messageReport) && !open.includes(checkinReport));
    assert.ok((await api('/admin/reports?status=all', admin.cookie)).body.items.some((i: { id: number }) => i.id === messageReport));

    // 撤下评论后，评论举报随之处理，状态显示为已撤下
    await api('/admin/takedown', admin.cookie, 'POST', { type: 'comment', id: commentId, reason: '人身攻击' });
    const all = (await api('/admin/reports?status=all', admin.cookie)).body.items as any[];
    const handled = all.find((i) => i.id === commentReport);
    assert.equal(handled.status, 'resolved');
    assert.equal(handled.targetState, 'down');
  });

  await t.test('moderation logs include community targets', async () => {
    const r = await api('/admin/logs', admin.cookie);
    assert.equal(r.status, 200);
    const types = new Set((r.body.items as { targetType: string }[]).map((l) => l.targetType));
    for (const type of ['forum_post', 'comment', 'checkin', 'profile', 'post']) assert.ok(types.has(type), type);
  });
});
