// 评审发现的问题的回归测试：每个用例都对应一个曾经可以复现的缺陷。
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
import { emptyProfile } from '../shared/profileRules.ts';
import type { ProfileInput } from '../shared/types.ts';

async function freePort() {
  const listener = net.createServer();
  listener.listen(0, '127.0.0.1');
  await once(listener, 'listening');
  const port = (listener.address() as net.AddressInfo).port;
  await new Promise<void>((resolve, reject) => listener.close((error) => (error ? reject(error) : resolve())));
  return port;
}

/** 在指定数据目录上启动服务；同一目录可以先停再启，用来验证“重启”行为 */
async function startServer(dir: string) {
  const port = await freePort();
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
    return { status: response.status, body: (() => { try { return JSON.parse(text); } catch { return text; } })() };
  };
  const stop = async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const ended = once(child, 'exit');
      child.kill('SIGTERM');
      const timer = setTimeout(() => child.kill('SIGKILL'), 2_000);
      try { await ended; } finally { clearTimeout(timer); }
    }
  };
  let ready = false;
  for (let i = 0; i < 200 && !ready; i++) {
    if (child.exitCode !== null) throw new Error(`API exited: ${output}`);
    try { ready = (await api('/auth/me')).status === 200; } catch { /* 等待端口绑定 */ }
    if (!ready) await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.ok(ready, `API did not start: ${output}`);
  return { api, stop, output: () => output };
}

const password = 'RegressionPass2026';

test('review regressions', { timeout: 180_000 }, async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'study-buddy-regressions-'));
  let app = await startServer(dir);
  const db = new DatabaseSync(path.join(dir, 'app.db'));
  t.after(async () => { db.close(); await app.stop(); await fs.rm(dir, { recursive: true, force: true }); });
  const passwordHash = await bcrypt.hash(password, 4);
  let studentNumber = 12719000;

  function createUser(patch: Partial<ProfileInput> = {}) {
    const studentId = String(++studentNumber);
    const email = `${studentId}@mail.sustech.edu.cn`;
    const id = Number(db.prepare('INSERT INTO users (email, activated, password_hash) VALUES (?, 1, ?)').run(email, passwordHash).lastInsertRowid);
    const data: ProfileInput = {
      ...emptyProfile(), realName: `回归测试${id}`, studentId, gender: 'male', grade: 'y1', planTags: ['期末复习备考'], places: ['library'], schedule: [0, 1, 2, 3],
      studyType: 'quiet', privacyConsent: { policy: true, contactExchange: true, silentExclusion: true, withdrawal: true },
      contacts: { showEmail: false, wechat: `wechat-${id}`, qq: '', phone: '', other: '' },
      ...patch,
    };
    db.prepare('INSERT INTO profiles (user_id, nickname, data, published, saved_at) VALUES (?, ?, ?, 1, ?)')
      .run(id, `回归${id}`, JSON.stringify(data), new Date().toISOString());
    const token = crypto.randomBytes(32).toString('base64url');
    db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
      .run(crypto.createHash('sha256').update(token).digest('hex'), id, new Date(Date.now() + 3_600_000).toISOString());
    return { id, email, cookie: `dz_sid=${token}` };
  }
  type Member = ReturnType<typeof createUser>;
  const like = (a: Member, b: Member, action = 'like') => app.api('/match/feedback', a.cookie, 'POST', { targetId: b.id, action });
  const feedbackOf = (a: Member, b: Member) =>
    (db.prepare('SELECT action, features FROM match_feedback WHERE user_id = ? AND target_id = ?').get(a.id, b.id) as { action: string; features: string } | undefined);
  const matchedNotices = (m: Member) => (db.prepare("SELECT COUNT(*) n FROM notifications WHERE user_id = ? AND title = '你们互相感兴趣了'").get(m.id) as { n: number }).n;
  const contactsOf = async (viewer: Member, other: Member) => (await app.api(`/connections/${other.id}`, viewer.cookie)).body?.contacts ?? null;

  await t.test('a server restart never re-creates likes from contact requests (the legacy migration runs once)', async () => {
    const a = createUser();
    const b = createUser();
    const matchId = (await like(a, b)).body.matchId ?? (await like(b, a)).body.matchId;
    assert.ok(matchId);
    assert.equal((await app.api(`/connections/${b.id}`, a.cookie, 'POST', { message: '' })).status, 200);
    const requests = (await app.api('/connections', b.cookie)).body.items as { id: number }[];
    assert.equal((await app.api(`/connections/${requests[0].id}/respond`, b.cookie, 'POST', { action: 'accept' })).status, 200);
    assert.ok((await contactsOf(a, b))?.wechat);
    // B 关闭聊天，再把 A 放回推荐：B 对 A 不再有任何选择
    assert.equal((await app.api(`/chat/${matchId}/close`, b.cookie, 'POST', {})).status, 200);
    assert.equal((await app.api(`/match/feedback/${a.id}`, b.cookie, 'DELETE')).status, 200);
    assert.equal(feedbackOf(b, a), undefined);
    await app.stop();
    app = await startServer(dir);
    assert.equal(feedbackOf(b, a), undefined, 'the restart must not bring back B’s like');
    const again = await like(a, b);
    assert.equal(again.body.matched, false, 'A cannot reopen the chat B closed on their own');
    assert.equal(await contactsOf(a, b), null);
  });

  await t.test('closing a match revokes the contact exchange, and reopening neither re-notifies nor restores contacts', async () => {
    const a = createUser();
    const b = createUser();
    await like(a, b);
    const matchId = (await like(b, a)).body.matchId;
    assert.equal(matchedNotices(a), 1);
    assert.equal((await app.api(`/connections/${b.id}`, a.cookie, 'POST', { message: '' })).status, 200);
    const req = ((await app.api('/connections', b.cookie)).body.items as { id: number }[])[0];
    await app.api(`/connections/${req.id}/respond`, b.cookie, 'POST', { action: 'accept' });
    assert.ok((await contactsOf(a, b))?.wechat);
    // B 反复“稍后再看 → 感兴趣”：每次都会关闭再重开配对，但不能刷屏通知与邮件
    for (let i = 0; i < 3; i++) {
      await like(b, a, 'skip');
      assert.equal((await like(b, a)).body.matchId, matchId);
    }
    assert.equal(matchedNotices(a), 1, 'only the first match notifies');
    assert.equal(matchedNotices(b), 1);
    assert.equal(await contactsOf(a, b), null, 'a reopened chat needs a fresh contact exchange');
    assert.equal((db.prepare('SELECT COUNT(*) n FROM contact_requests WHERE status = \'accepted\' AND (requester_id = ? OR recipient_id = ?)').get(a.id, a.id) as { n: number }).n, 0);
  });

  await t.test('exclude → un-exclude keeps the 7-day wait after a rejection and records the excluder’s dislike', async () => {
    const a = createUser();
    const b = createUser();
    await like(a, b);
    await like(b, a);
    assert.equal((await app.api(`/connections/${b.id}`, a.cookie, 'POST', { message: '' })).status, 200);
    const req = ((await app.api('/connections', b.cookie)).body.items as { id: number }[])[0];
    await app.api(`/connections/${req.id}/respond`, b.cookie, 'POST', { action: 'reject' });
    assert.equal((await app.api(`/connections/${b.id}`, a.cookie, 'POST', { message: '' })).status, 409);
    assert.equal((await app.api(`/connections/${b.id}/exclude`, a.cookie, 'POST', {})).status, 200);
    assert.equal(feedbackOf(a, b)?.action, 'dislike');
    assert.equal(feedbackOf(a, b)?.features, '{}', 'an exclusion is not a card choice and is not learned from');
    assert.equal((await app.api(`/connections/${b.id}/exclude`, a.cookie, 'DELETE')).status, 200);
    // 放回推荐后再次感兴趣会重新配对，但拒绝后的 7 天冷却仍然有效
    await app.api(`/match/feedback/${b.id}`, a.cookie, 'DELETE');
    assert.equal((await like(a, b)).body.matched, true);
    assert.equal((await app.api(`/connections/${b.id}`, a.cookie, 'POST', { message: '' })).status, 409);
  });

  await t.test('an in-chat rejection does not hide the pair from recommendations forever', async () => {
    const a = createUser();
    const b = createUser();
    await like(a, b);
    const matchId = (await like(b, a)).body.matchId;
    await app.api(`/connections/${b.id}`, a.cookie, 'POST', { message: '' });
    const req = ((await app.api('/connections', b.cookie)).body.items as { id: number }[])[0];
    await app.api(`/connections/${req.id}/respond`, b.cookie, 'POST', { action: 'reject' });
    await app.api(`/chat/${matchId}/close`, b.cookie, 'POST', {});
    await app.api(`/match/feedback/${a.id}`, b.cookie, 'DELETE');
    const deck = (await app.api('/match/ranked?limit=100', b.cookie)).body.items as { id: number }[];
    assert.ok(deck.some((card) => card.id === a.id), '放回推荐 must work for a pair that once matched');
  });

  await t.test('undo after closing a chat leaves the personal model exactly as if the close never happened', async () => {
    const a = createUser();
    const b = createUser();
    await like(a, b);
    const matchId = (await like(b, a)).body.matchId;
    const before = db.prepare('SELECT weights, samples FROM preference_models WHERE user_id = ?').get(a.id) as { weights: string; samples: number };
    assert.equal(before.samples, 1);
    await app.api(`/chat/${matchId}/close`, a.cookie, 'POST', {});
    await app.api(`/match/feedback/${b.id}`, a.cookie, 'DELETE');
    const after = db.prepare('SELECT weights, samples FROM preference_models WHERE user_id = ?').get(a.id) as { weights: string; samples: number };
    assert.equal(after.samples, 0);
    const deck = (await app.api('/match/deck', a.cookie)).body;
    assert.equal(deck.personalization.samples, 0);
  });

  await t.test('the unread badge and the chat list agree about closed chats', async () => {
    const a = createUser();
    const b = createUser();
    await like(a, b);
    const matchId = (await like(b, a)).body.matchId;
    for (const text of ['在吗', '周二一起复习？']) assert.equal((await app.api(`/chat/${matchId}/messages`, b.cookie, 'POST', { body: text })).status, 200);
    await app.api(`/chat/${matchId}/close`, b.cookie, 'POST', {});
    const summary = ((await app.api('/chat', a.cookie)).body.items as { matchId: number; unread: number }[]).find((c) => c.matchId === matchId)!;
    const badge = (await app.api('/auth/me', a.cookie)).body.user.unreadMessages;
    assert.equal(summary.unread, 2);
    assert.equal(badge, 2);
  });

  await t.test('the forum search cursor cannot be pointed at a hidden post to probe its text', async () => {
    const author = createUser();
    const viewer = createUser();
    const ids: number[] = [];
    for (const body of ['公开帖子 苹果 一', '私密 7 栋 302 苹果', '公开帖子 苹果 二']) {
      const r = await app.api('/forum/posts', author.cookie, 'POST', { title: '', body, images: [] });
      assert.equal(r.status, 200, JSON.stringify(r.body));
      ids.push(r.body.post.id);
    }
    assert.equal((await app.api(`/forum/posts/${ids[1]}`, author.cookie, 'DELETE')).status, 200);
    const probe = async (q: string) => ((await app.api(`/forum/posts?q=${encodeURIComponent(q)}&before=${ids[1]}`, viewer.cookie)).body.items as { id: number }[]).map((p) => p.id);
    assert.deepEqual(await probe('苹果 302'), await probe('苹果 303'), 'results must not depend on the deleted post’s text');
    assert.deepEqual(await probe('苹果 302'), []);
  });

  await t.test('a report note can never be shown as the stored snapshot', async () => {
    const a = createUser();
    const b = createUser();
    await like(a, b);
    const matchId = (await like(b, a)).body.matchId;
    const sent = await app.api(`/chat/${matchId}/messages`, b.cookie, 'POST', { body: '你好呀' });
    const forged = '【被举报【被举报内容】内容】我要杀了你';
    assert.equal((await app.api('/reports', a.cookie, 'POST', { targetType: 'message', targetId: sent.body.message.id, reason: '其他', detail: forged })).status, 200);
    const row = db.prepare("SELECT detail, snapshot FROM reports WHERE target_type = 'message' AND target_id = ?").get(sent.body.message.id) as { detail: string; snapshot: string };
    assert.equal(row.snapshot, '你好呀');
    assert.equal(row.detail, forged, 'the note is stored verbatim and kept apart from the snapshot');
  });

  await t.test('a forum or check-in upload cannot be used as a profile photo, and /uploads rejects check-ins', async () => {
    const a = createUser();
    const tiny = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=';
    assert.equal((await app.api('/uploads', a.cookie, 'POST', { dataUrl: tiny, kind: 'checkin' })).status, 400);
    const forum = await app.api('/uploads', a.cookie, 'POST', { dataUrl: tiny, kind: 'forum' });
    assert.equal(forum.status, 200);
    const me = (await app.api('/profiles/me', a.cookie)).body.profile;
    const saved = await app.api('/profiles/me', a.cookie, 'PUT', { profile: { ...me, photos: [forum.body.name] } });
    assert.equal(saved.status, 400);
  });
});
