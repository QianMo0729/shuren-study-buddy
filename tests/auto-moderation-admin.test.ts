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

async function startServer() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'study-buddy-auto-admin-'));
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
  const api = async (endpoint: string, cookie = '', body?: unknown) => {
    const response = await fetch(`${url}/api${endpoint}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { ...(cookie ? { Cookie: cookie } : {}),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json', Origin: url }) },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(10_000),
    });
    return { status: response.status, body: await response.json() };
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

test('admin approval separates automatic holds from manual takedowns and profile drafts', { timeout: 120_000 }, async (t) => {
  const { api, db, stop } = await startServer();
  t.after(async () => { db.close(); await stop(); });
  let sequence = 0;
  const user = (admin = false, published = true) => {
    const email = `1273${String(++sequence).padStart(4, '0')}@mail.sustech.edu.cn`;
    const id = Number(db.prepare("INSERT INTO users (email, activated, password_hash, role) VALUES (?, 1, 'x', ?)")
      .run(email, admin ? 'admin' : 'user').lastInsertRowid);
    db.prepare('INSERT INTO profiles (user_id, nickname, data, published) VALUES (?, ?, ?, ?)')
      .run(id, `自动审核同学${id}`, JSON.stringify(emptyProfile()), Number(published));
    const token = crypto.randomBytes(32).toString('base64url');
    db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
      .run(crypto.createHash('sha256').update(token).digest('hex'), id, new Date(Date.now() + 3_600_000).toISOString());
    return { id, cookie: `dz_sid=${token}` };
  };
  const admin = user(true, false);
  const author = user();
  const ordinaryProfile = user();
  const manualProfile = user();
  const draft = user(false, false);
  const insertPost = () => Number(db.prepare("INSERT INTO posts (user_id, title, category, description) VALUES (?, '学习招募', 'study', '一起复习')")
    .run(author.id).lastInsertRowid);
  const insertForum = () => Number(db.prepare("INSERT INTO forum_posts (user_id, title, body) VALUES (?, '学习交流', '一起复习')")
    .run(author.id).lastInsertRowid);
  const parentPost = insertForum();
  const insertComment = () => Number(db.prepare("INSERT INTO forum_comments (target_type, target_id, user_id, body) VALUES ('post', ?, ?, '一起复习')")
    .run(parentPost, author.id).lastInsertRowid);
  const insertCheckin = () => Number(db.prepare(
    "INSERT INTO checkins (user_id, image, place_label, stamped_at, local_date, stamp_text) VALUES (?, 'aaaaaaaaaaaaaaaaaaaaaaaa.jpg', '图书馆', datetime('now'), '2026-10-06', '今日学习')")
    .run(author.id).lastInsertRowid);
  const targets = [
    { type: 'profile', table: 'profiles', key: 'user_id', endpoint: '/admin/profiles', held: author.id, ordinary: ordinaryProfile.id, manual: manualProfile.id },
    { type: 'post', table: 'posts', key: 'id', endpoint: '/admin/posts', held: insertPost(), ordinary: insertPost(), manual: insertPost() },
    { type: 'forum_post', table: 'forum_posts', key: 'id', endpoint: '/admin/content?type=forum_post', held: insertForum(), ordinary: parentPost, manual: insertForum() },
    { type: 'comment', table: 'forum_comments', key: 'id', endpoint: '/admin/content?type=comment', held: insertComment(), ordinary: insertComment(), manual: insertComment() },
    { type: 'checkin', table: 'checkins', key: 'id', endpoint: '/admin/content?type=checkin', held: insertCheckin(), ordinary: insertCheckin(), manual: insertCheckin() },
  ];
  const stored = (target: typeof targets[number], id: number) =>
    db.prepare(`SELECT * FROM ${target.table} WHERE ${target.key} = ?`).get(id) as Record<string, any>;
  const hold = (target: typeof targets[number], id: number) => db.prepare(
    `UPDATE ${target.table} SET auto_held = 1, risk_reasons = '["高风险内容"]', taken_down = 1, reviewed_at = NULL WHERE ${target.key} = ?`).run(id);
  for (const target of targets) {
    hold(target, target.held);
    db.prepare(`UPDATE ${target.table} SET taken_down = 1, taken_down_at = '2026-10-01 12:00:00', takedown_reason = '管理员决定' WHERE ${target.key} = ?`)
      .run(target.manual);
  }
  hold(targets[0]!, draft.id);
  const list = async (target: typeof targets[number], filter: string) => {
    const response = await api(`${target.endpoint}${target.endpoint.includes('?') ? '&' : '?'}filter=${filter}`, admin.cookie);
    assert.equal(response.status, 200, target.type);
    return response.body.items as Record<string, any>[];
  };

  await t.test('pending counts and lists include only held submitted content and show reasons', async () => {
    assert.equal((await api('/admin/overview')).status, 401);
    assert.equal((await api('/admin/overview', author.cookie)).status, 403);
    const overview = (await api('/admin/overview', admin.cookie)).body;
    assert.equal(overview.stats.pendingProfiles, 1, 'drafts do not enter the submitted profile queue');
    assert.equal(overview.stats.pendingPosts, 1);
    assert.equal(overview.stats.pendingCommunity, 3);
    assert.deepEqual(overview.pendingContent, { forum_post: 1, comment: 1, checkin: 1 });
    for (const target of targets) {
      const pending = await list(target, 'pending');
      assert.deepEqual(pending.map((item) => item.id), [target.held], target.type);
      assert.equal(pending[0]!.reviewPending, true);
      assert.deepEqual(pending[0]!.reviewReasons, ['高风险内容']);
      assert.equal(pending[0]!.takenDown, false, 'an automatic hold is not a manual takedown');
      const down = await list(target, 'down');
      assert.deepEqual(down.map((item) => item.id), [target.manual], target.type);
      assert.equal(down[0]!.takenDown, true);
      assert.equal(down[0]!.reviewPending, false);
      assert.deepEqual(down[0]!.reviewReasons, []);
      assert.ok((await list(target, 'all')).some((item) => item.id === target.ordinary && !item.reviewPending),
        'reviewed_at NULL alone does not imply an automatic hold');
    }
  });

  await t.test('batch approval clears holds while preserving manual takedowns', async () => {
    for (const target of targets) {
      const response = await api('/admin/approve', admin.cookie, { type: target.type, ids: [target.held, target.ordinary, target.manual] });
      assert.equal(response.status, 200, target.type);
      assert.equal(response.body.count, 3);
      const held = stored(target, target.held);
      assert.equal(held.auto_held, 0);
      assert.equal(held.risk_reasons, '[]');
      assert.equal(held.taken_down, 0);
      assert.ok(held.reviewed_at);
      assert.ok(stored(target, target.ordinary).reviewed_at);
      const manual = stored(target, target.manual);
      assert.equal(manual.taken_down, 1);
      assert.equal(manual.takedown_reason, '管理员决定');
      assert.equal(manual.taken_down_at, '2026-10-01 12:00:00');
      assert.deepEqual(await list(target, 'pending'), []);
    }
    assert.equal((await api('/admin/approve', admin.cookie, { type: 'profile', id: draft.id })).status, 200);
    const profile = stored(targets[0]!, draft.id);
    assert.equal(profile.published, 0, 'approval cannot publish a profile draft');
    assert.equal(profile.auto_held, 0);
  });

  await t.test('manual decisions clear stale automatic flags and risk reasons', async () => {
    for (const target of targets) {
      hold(target, target.held);
      assert.equal((await api('/admin/takedown', admin.cookie, { type: target.type, id: target.held, reason: '人工复核违规' })).status, 200);
      const down = stored(target, target.held);
      assert.equal(down.auto_held, 0);
      assert.equal(down.risk_reasons, '[]');
      assert.equal(down.taken_down, 1);
      assert.equal(down.takedown_reason, '人工复核违规');
      hold(target, target.held);
      assert.equal((await api('/admin/restore', admin.cookie, { type: target.type, id: target.held })).status, 200);
      const restored = stored(target, target.held);
      assert.equal(restored.auto_held, 0);
      assert.equal(restored.risk_reasons, '[]');
      assert.equal(restored.taken_down, 0);
      assert.equal(restored.takedown_reason, null);
    }
  });
});
