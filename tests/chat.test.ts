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
import type { ChatMessage, ChatSummary, Contacts, ProfileInput } from '../shared/types.ts';

const password = 'ChatFixturePassword2026';

async function startServer() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'study-buddy-chat-'));
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
  const api = async (endpoint: string, cookie = '', method = 'GET', body?: unknown) => {
    const response = await fetch(`${url}/api${endpoint}`, {
      method,
      headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json', Origin: url }) },
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

const NO_CONTACTS: Contacts = { showEmail: false, wechat: '', qq: '', phone: '', other: '' };

test('private chat between mutually interested students', { timeout: 120_000 }, async (t) => {
  const app = await startServer();
  const { api, db } = app;
  t.after(async () => { db.close(); await app.stop(); });
  const passwordHash = await bcrypt.hash(password, 4);
  let studentNumber = 12619000;

  function createUser(patch: Partial<ProfileInput> = {}) {
    const studentId = String(++studentNumber);
    const email = `${studentId}@mail.sustech.edu.cn`;
    const id = Number(db.prepare('INSERT INTO users (email, activated, password_hash) VALUES (?, 1, ?)').run(email, passwordHash).lastInsertRowid);
    const data: ProfileInput = {
      ...emptyProfile(), realName: `SECRET-NAME-${id}`, studentId,
      planTags: ['期末复习备考'], places: ['library'], schedule: [0, 1, 2], studyType: 'quiet',
      privacyConsent: { policy: true, contactExchange: true, silentExclusion: true, withdrawal: true },
      contacts: { showEmail: false, wechat: `SECRET-WECHAT-${id}`, qq: '', phone: '', other: '' },
      ...patch,
    };
    const nickname = `聊天测试${id}`;
    db.prepare('INSERT INTO profiles (user_id, nickname, data, published, saved_at) VALUES (?, ?, ?, 1, ?)')
      .run(id, nickname, JSON.stringify(data), new Date().toISOString());
    const token = crypto.randomBytes(32).toString('base64url');
    db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
      .run(crypto.createHash('sha256').update(token).digest('hex'), id, new Date(Date.now() + 3_600_000).toISOString());
    return { id, email, cookie: `dz_sid=${token}`, data, nickname };
  }
  type Member = ReturnType<typeof createUser>;
  const setProfile = (member: Member, patch: Partial<ProfileInput>) => {
    member.data = { ...member.data, ...patch };
    db.prepare('UPDATE profiles SET data = ? WHERE user_id = ?').run(JSON.stringify(member.data), member.id);
  };
  /** 直接写库：双方互相感兴趣并建立配对（与 server/matches.ts 的 ensureMatch 一致） */
  function matchUsers(a: Member, b: Member): number {
    for (const [from, to] of [[a, b], [b, a]]) {
      db.prepare("INSERT OR REPLACE INTO match_feedback (user_id, target_id, action) VALUES (?, ?, 'like')").run(from.id, to.id);
    }
    const [x, y] = a.id < b.id ? [a.id, b.id] : [b.id, a.id];
    const id = Number(db.prepare('INSERT INTO matches (user_a, user_b) VALUES (?, ?)').run(x, y).lastInsertRowid);
    db.prepare("INSERT INTO messages (match_id, sender_id, kind, body) VALUES (?, NULL, 'system', '你们互相感兴趣啦！')").run(id);
    db.prepare("UPDATE matches SET last_message_at = datetime('now') WHERE id = ?").run(id);
    return id;
  }
  const chat = (member: Member, matchId: number, query = '') => api(`/chat/${matchId}${query}`, member.cookie);
  const send = (member: Member, matchId: number, body: unknown) => api(`/chat/${matchId}/messages`, member.cookie, 'POST', { body });
  const list = async (member: Member): Promise<ChatSummary[]> => {
    const response = await api('/chat', member.cookie);
    assert.equal(response.status, 200);
    return response.body.items;
  };
  const summaryOf = async (member: Member, matchId: number) => (await list(member)).find((item) => item.matchId === matchId);
  const unreadBadge = async (member: Member) => (await api('/auth/me', member.cookie)).body.user.unreadMessages as number;
  const notificationCount = (member: Member) => (db.prepare('SELECT COUNT(*) n FROM notifications WHERE user_id = ?').get(member.id) as { n: number }).n;
  const systemMessages = (matchId: number) =>
    (db.prepare("SELECT body FROM messages WHERE match_id = ? AND kind = 'system' ORDER BY id").all(matchId) as { body: string }[]).map((row) => row.body);

  await t.test('only participants can read, send, mark read or close a chat', async () => {
    const a = createUser();
    const b = createUser();
    const outsider = createUser();
    const matchId = matchUsers(a, b);
    assert.equal((await api('/chat')).status, 401);
    assert.equal((await api(`/chat/${matchId}`)).status, 401);
    assert.equal((await chat(outsider, matchId)).status, 404);
    assert.equal((await send(outsider, matchId, '你好')).status, 404);
    assert.equal((await api(`/chat/${matchId}/read`, outsider.cookie, 'POST', { lastId: 1 })).status, 404);
    assert.equal((await api(`/chat/${matchId}/close`, outsider.cookie, 'POST', {})).status, 404);
    assert.deepEqual(await list(outsider), []);
    for (const bad of ['abc', '0', '-1', '1.5', '99999999']) assert.equal((await chat(a, bad as unknown as number)).status, 404);
    assert.equal((await chat(a, matchId, '?after=abc')).status, 400);
    assert.equal(db.prepare('SELECT status FROM matches WHERE id = ?').get(matchId)!.status, 'active');
    // 没有配对的两人之间没有可用的会话
    const stranger = createUser();
    const strangerChats = await list(stranger);
    assert.equal(strangerChats.length, 0);
  });

  await t.test('matched students exchange messages with unread counts and read markers', async () => {
    const a = createUser();
    const b = createUser();
    const matchId = matchUsers(a, b);
    const first = await send(a, matchId, '  你好，一起复习线代吗？  ');
    assert.equal(first.status, 200);
    const message: ChatMessage = first.body.message;
    assert.equal(message.body, '你好，一起复习线代吗？');
    assert.equal(message.mine, true);
    assert.equal(message.kind, 'text');
    assert.equal(message.senderId, a.id);
    assert.equal(message.matchId, matchId);
    assert.ok(!Number.isNaN(Date.parse(message.createdAt)));

    assert.equal((await send(a, matchId, '   ')).status, 400);
    assert.equal((await send(a, matchId, 42)).status, 400);
    assert.equal((await send(a, matchId, 'x'.repeat(1001))).status, 400);
    assert.equal((await send(a, matchId, 'x'.repeat(1000))).status, 200);
    const cleaned = await send(a, matchId, 'a‮b\u0000c\r\n\n\n\n\nd');
    assert.equal(cleaned.body.message.body, 'abc\n\n\nd');

    const forB = await chat(b, matchId);
    assert.equal(forB.status, 200);
    assert.equal(forB.body.hasMore, false);
    assert.deepEqual(forB.body.messages.map((m: ChatMessage) => m.kind), ['system', 'text', 'text', 'text']);
    assert.equal(forB.body.messages[0].senderId, null);
    assert.equal(forB.body.messages[1].mine, false);
    assert.ok(forB.body.messages.every((m: ChatMessage, i: number, all: ChatMessage[]) => i === 0 || all[i - 1].id < m.id));
    const summary: ChatSummary = forB.body.summary;
    assert.equal(summary.matchId, matchId);
    assert.equal(summary.status, 'active');
    assert.equal(summary.unread, 3);
    assert.equal(summary.contactState, 'none');
    assert.deepEqual(Object.keys(summary.other).sort(), ['cover', 'id', 'nickname']);
    assert.deepEqual(summary.other, { id: a.id, nickname: a.nickname, cover: null });
    assert.equal(summary.lastMessage?.kind, 'text');
    assert.equal(summary.lastMessage?.senderId, a.id);
    assert.equal(await unreadBadge(b), 3);
    assert.equal(await unreadBadge(a), 0, 'own messages are never unread');
    assert.equal((await summaryOf(a, matchId))!.unread, 0);

    // 不发站内通知
    assert.equal(notificationCount(b), 0);
    // last_message_at 随消息更新
    assert.ok(db.prepare('SELECT last_message_at FROM matches WHERE id = ?').get(matchId)!.last_message_at);

    // 已读：只会前进，并且不超过该会话最大的消息 id
    const ids = forB.body.messages.map((m: ChatMessage) => m.id);
    assert.equal((await api(`/chat/${matchId}/read`, b.cookie, 'POST', { lastId: ids[1] })).status, 200);
    assert.equal((await summaryOf(b, matchId))!.unread, 2);
    assert.equal((await api(`/chat/${matchId}/read`, b.cookie, 'POST', { lastId: 0 })).status, 200);
    assert.equal((await summaryOf(b, matchId))!.unread, 2, 'read marker never moves backwards');
    assert.equal((await api(`/chat/${matchId}/read`, b.cookie, 'POST', { lastId: 'x' })).status, 400);
    assert.equal((await api(`/chat/${matchId}/read`, b.cookie, 'POST', { lastId: 10_000_000 })).status, 200);
    assert.equal((await summaryOf(b, matchId))!.unread, 0);
    assert.equal(await unreadBadge(b), 0);
    const later = await send(a, matchId, '后来的消息');
    assert.equal((await summaryOf(b, matchId))!.unread, 1, 'marking far ahead must not swallow future messages');
    assert.equal(await unreadBadge(b), 1);

    // after 轮询只返回新消息
    const polled = await chat(b, matchId, `?after=${ids[ids.length - 1]}`);
    assert.deepEqual(polled.body.messages.map((m: ChatMessage) => m.id), [later.body.message.id]);
    assert.equal(polled.body.hasMore, false);
    assert.equal((await chat(b, matchId, `?after=${later.body.message.id}`)).body.messages.length, 0);

    const reply = await send(b, matchId, '好呀');
    assert.equal(reply.status, 200);
    const chatsForA = await list(a);
    assert.equal(chatsForA[0].matchId, matchId);
    assert.equal(chatsForA[0].lastMessage?.body, '好呀');
    assert.equal(chatsForA[0].unread, 1);
  });

  await t.test('history is paginated 50 messages at a time in ascending order', async () => {
    const a = createUser();
    const b = createUser();
    const matchId = matchUsers(a, b);
    const insert = db.prepare("INSERT INTO messages (match_id, sender_id, kind, body) VALUES (?, ?, 'text', ?)");
    for (let i = 1; i <= 120; i++) insert.run(matchId, i % 2 ? a.id : b.id, `消息 ${i}`);
    const latest = await chat(a, matchId);
    assert.equal(latest.body.messages.length, 50);
    assert.equal(latest.body.hasMore, true);
    assert.equal(latest.body.messages.at(-1).body, '消息 120');
    assert.equal(latest.body.messages[0].body, '消息 71');
    const older = await chat(a, matchId, `?before=${latest.body.messages[0].id}`);
    assert.equal(older.body.messages.length, 50);
    assert.equal(older.body.messages[0].body, '消息 21');
    assert.equal(older.body.hasMore, true);
    const oldest = await chat(a, matchId, `?before=${older.body.messages[0].id}`);
    assert.equal(oldest.body.messages.length, 21, '20 messages and the opening system message');
    assert.equal(oldest.body.hasMore, false);
    assert.equal(oldest.body.messages[0].kind, 'system');
    const catchUp = await chat(a, matchId, `?after=${oldest.body.messages[0].id}`);
    assert.equal(catchUp.body.messages.length, 50);
    assert.equal(catchUp.body.hasMore, true, 'polling reports that more new messages remain');
    assert.equal(catchUp.body.messages[0].body, '消息 1');
  });

  await t.test('sending is rate limited per minute', async () => {
    const a = createUser();
    const b = createUser();
    const matchId = matchUsers(a, b);
    for (let i = 0; i < 20; i++) assert.equal((await send(a, matchId, `第 ${i} 条`)).status, 200);
    assert.equal((await send(a, matchId, '太多了')).status, 429);
    assert.equal((await send(b, matchId, '我还可以发')).status, 200);
  });

  await t.test('closing a match is silent, keeps history and blocks new messages', async () => {
    const a = createUser();
    const b = createUser();
    const matchId = matchUsers(a, b);
    await send(b, matchId, '你好');
    const before = notificationCount(b);
    assert.equal((await api(`/chat/${matchId}/close`, a.cookie, 'POST', {})).status, 200);
    assert.equal(notificationCount(b), before, 'the other student is not notified');
    assert.equal(db.prepare('SELECT status FROM matches WHERE id = ?').get(matchId)!.status, 'closed');
    assert.equal(db.prepare('SELECT action FROM match_feedback WHERE user_id = ? AND target_id = ?').get(a.id, b.id)!.action, 'dislike');
    assert.equal((await send(a, matchId, '还在吗')).status, 403);
    assert.equal((await send(b, matchId, '还在吗')).status, 403);
    const forB = await chat(b, matchId);
    assert.equal(forB.status, 200);
    assert.equal(forB.body.summary.status, 'closed');
    assert.equal(forB.body.messages.at(-1).kind, 'system');
    assert.match(forB.body.messages.at(-1).body, /配对已解除/);
    assert.equal((await summaryOf(b, matchId))!.status, 'closed');
    assert.equal((await api(`/chat/${matchId}/close`, b.cookie, 'POST', {})).status, 200, 'closing twice is idempotent');
    assert.equal(systemMessages(matchId).filter((body) => /配对已解除/.test(body)).length, 1);
    assert.equal(await unreadBadge(b), 0, 'closed chats do not count towards the badge');
  });

  await t.test('excluding closes the match and hides the chat from both students', async () => {
    const a = createUser();
    const b = createUser();
    const matchId = matchUsers(a, b);
    await send(a, matchId, '你好');
    const before = notificationCount(b);
    assert.equal((await api(`/connections/${a.id}/exclude`, b.cookie, 'POST', {})).status, 200);
    assert.equal(notificationCount(a), 0);
    assert.equal(notificationCount(b), before);
    assert.equal(db.prepare('SELECT status FROM matches WHERE id = ?').get(matchId)!.status, 'closed');
    for (const member of [a, b]) {
      assert.equal((await list(member)).some((item) => item.matchId === matchId), false);
      assert.equal((await chat(member, matchId)).status, 404);
      assert.equal((await send(member, matchId, '能看到吗')).status, 404);
      assert.equal((await api(`/chat/${matchId}/read`, member.cookie, 'POST', { lastId: 1 })).status, 404);
    }
    assert.equal(await unreadBadge(b), 0);
    // 取消排除后能看到已关闭的历史，但不会恢复配对
    assert.equal((await api(`/connections/${a.id}/exclude`, b.cookie, 'DELETE')).status, 200);
    assert.equal((await chat(a, matchId)).body.summary.status, 'closed');
    assert.equal((await send(a, matchId, '恢复了吗')).status, 403);
  });

  await t.test('a matched student can be excluded from the chat even after unpublishing', async () => {
    const a = createUser();
    const b = createUser();
    const matchId = matchUsers(a, b);
    db.prepare('UPDATE profiles SET published = 0 WHERE user_id = ?').run(b.id);
    assert.equal((await api(`/connections/${b.id}/exclude`, a.cookie, 'POST', {})).status, 200);
    assert.equal((await chat(a, matchId)).status, 404);
    const stranger = createUser();
    db.prepare('UPDATE profiles SET published = 0 WHERE user_id = ?').run(stranger.id);
    assert.equal((await api(`/connections/${stranger.id}/exclude`, a.cookie, 'POST', {})).status, 404, 'unrelated hidden profiles stay unknown');
  });

  await t.test('chat summaries reveal only nickname and an allowed cover', async () => {
    const photo = `${crypto.randomBytes(12).toString('hex')}.jpg`;
    const a = createUser();
    const b = createUser({ photos: [photo], photoVisibility: 'private' });
    db.prepare("INSERT INTO uploads (name, user_id, kind) VALUES (?, ?, 'photo')").run(photo, b.id);
    const matchId = matchUsers(a, b);
    await send(b, matchId, '你好');
    assert.equal((await summaryOf(a, matchId))!.other.cover, null, 'private photo stays private');
    setProfile(b, { photoVisibility: 'public' });
    assert.equal((await summaryOf(a, matchId))!.other.cover, photo);
    db.prepare('UPDATE profiles SET published = 0 WHERE user_id = ?').run(b.id);
    assert.equal((await summaryOf(a, matchId))!.other.cover, null, 'unpublished profiles have no cover');
    db.prepare('UPDATE profiles SET published = 1 WHERE user_id = ?').run(b.id);
    const raw = JSON.stringify([await api('/chat', a.cookie), await chat(a, matchId)].map((r) => r.body));
    for (const secret of [b.data.realName, b.email, b.data.studentId, b.data.contacts.wechat, 'SECRET']) {
      assert.equal(raw.includes(secret), false, `chat payload must not leak ${secret}`);
    }
  });

  await t.test('contact exchange requires an active match and contact methods on both sides', async () => {
    const a = createUser({ contacts: NO_CONTACTS });
    const b = createUser({ contacts: NO_CONTACTS });
    const outsider = createUser();

    // 没有配对：不能申请
    const unmatched = await api(`/connections/${b.id}`, a.cookie, 'POST', {});
    assert.equal(unmatched.status, 403);
    assert.match(unmatched.body.error, /互相感兴趣/);
    assert.equal((await api(`/connections/${a.id}`, outsider.cookie, 'POST', {})).status, 403);
    // 单向感兴趣也不行
    db.prepare("INSERT INTO match_feedback (user_id, target_id, action) VALUES (?, ?, 'like')").run(outsider.id, a.id);
    assert.equal((await api(`/connections/${a.id}`, outsider.cookie, 'POST', {})).status, 403);

    const matchId = matchUsers(a, b);
    // 申请人没有联系方式
    const missing = await api(`/connections/${b.id}`, a.cookie, 'POST', {});
    assert.equal(missing.status, 400);
    assert.equal(missing.body.needContacts, true);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM contact_requests').get()!.n, 0);

    // 只开启交换校园邮箱也算有联系方式
    setProfile(a, { contacts: { ...NO_CONTACTS, showEmail: true } });
    const sent = await api(`/connections/${b.id}`, a.cookie, 'POST', {});
    assert.equal(sent.status, 200);
    assert.equal(sent.body.request.status, 'pending');
    const requestId = sent.body.request.id;
    assert.equal((await summaryOf(a, matchId))!.contactState, 'pending_outgoing');
    assert.equal((await summaryOf(b, matchId))!.contactState, 'pending_incoming');
    assert.ok(systemMessages(matchId).some((body) => body.includes(`${a.nickname} 申请交换联系方式`)));
    const notice = db.prepare('SELECT link FROM notifications WHERE user_id = ? ORDER BY id DESC').get(b.id) as { link: string };
    assert.equal(notice.link, `/messages/${matchId}`);
    // 重复申请幂等
    assert.equal((await api(`/connections/${b.id}`, a.cookie, 'POST', {})).body.request.id, requestId);
    assert.equal((await api(`/connections/${a.id}`, b.cookie, 'POST', {})).body.request.id, requestId);

    // 待确认时双方都看不到联系方式
    assert.equal((await api(`/connections/${b.id}`, a.cookie)).body.contacts, null);
    assert.equal((await api(`/connections/${a.id}`, b.cookie)).body.contacts, null);

    // 接受者没有联系方式不能接受
    const cannotAccept = await api(`/connections/${requestId}/respond`, b.cookie, 'POST', { action: 'accept' });
    assert.equal(cannotAccept.status, 400);
    assert.equal(cannotAccept.body.needContacts, true);
    assert.equal(db.prepare('SELECT status FROM contact_requests WHERE id = ?').get(requestId)!.status, 'pending');

    // 申请人事后清空了联系方式：接受会落空，所以拒绝执行
    setProfile(b, { contacts: { ...NO_CONTACTS, qq: '12345678' } });
    setProfile(a, { contacts: NO_CONTACTS });
    assert.equal((await api(`/connections/${requestId}/respond`, b.cookie, 'POST', { action: 'accept' })).status, 409);
    setProfile(a, { contacts: { ...NO_CONTACTS, showEmail: true, wechat: 'wx-a-visible' } });

    assert.equal((await api(`/connections/${requestId}/respond`, a.cookie, 'POST', { action: 'accept' })).status, 404, 'requester cannot accept');
    assert.equal((await api(`/connections/${requestId}/respond`, outsider.cookie, 'POST', { action: 'accept' })).status, 404);
    const accepted = await api(`/connections/${requestId}/respond`, b.cookie, 'POST', { action: 'accept' });
    assert.equal(accepted.status, 200);
    assert.equal(accepted.body.request.status, 'accepted');
    assert.ok(systemMessages(matchId).some((body) => body.includes(`${b.nickname} 同意了交换联系方式`)));
    assert.equal((await summaryOf(a, matchId))!.contactState, 'accepted');
    assert.equal((await summaryOf(b, matchId))!.contactState, 'accepted');

    const forA = await api(`/connections/${b.id}`, a.cookie);
    assert.equal(forA.body.contacts.qq, '12345678');
    assert.equal(forA.body.contacts.email, null);
    const forB = await api(`/connections/${a.id}`, b.cookie);
    assert.equal(forB.body.contacts.wechat, 'wx-a-visible');
    assert.equal(forB.body.contacts.email, a.email);
    assert.equal((await api(`/profiles/${b.id}/contact`, a.cookie, 'POST', {})).body.contacts.qq, '12345678');
    // 外人仍然看不到
    assert.equal((await api(`/connections/${b.id}`, outsider.cookie)).body.contacts, null);
    assert.equal((await api(`/profiles/${b.id}/contact`, outsider.cookie, 'POST', {})).status, 403);

    // 解除配对后不再展示联系方式
    assert.equal((await api(`/chat/${matchId}/close`, b.cookie, 'POST', {})).status, 200);
    assert.equal((await api(`/connections/${b.id}`, a.cookie)).body.contacts, null);
    assert.equal((await api(`/profiles/${b.id}/contact`, a.cookie, 'POST', {})).status, 403);
    assert.equal((await api(`/connections/${b.id}`, a.cookie, 'POST', {})).status, 403);
  });

  await t.test('a rejected request can be renewed after seven days by reusing the same row', async () => {
    const a = createUser();
    const b = createUser();
    const matchId = matchUsers(a, b);
    const sent = await api(`/connections/${b.id}`, a.cookie, 'POST', {});
    const requestId = sent.body.request.id;
    const notices = notificationCount(a);
    const rejected = await api(`/connections/${requestId}/respond`, b.cookie, 'POST', { action: 'reject' });
    assert.equal(rejected.status, 200);
    assert.equal(rejected.body.request.status, 'rejected');
    assert.equal(notificationCount(a), notices + 1);
    assert.ok(systemMessages(matchId).some((body) => body.includes(`${b.nickname} 暂时不想交换联系方式`)));
    assert.equal((await summaryOf(a, matchId))!.contactState, 'rejected');
    assert.equal((await api(`/connections/${b.id}`, a.cookie)).body.contacts, null);
    assert.equal((await api(`/connections/${requestId}/respond`, b.cookie, 'POST', { action: 'accept' })).status, 409);

    const tooSoon = await api(`/connections/${b.id}`, a.cookie, 'POST', {});
    assert.equal(tooSoon.status, 409);
    assert.ok(Date.parse(tooSoon.body.retryAt) > Date.now() + 6 * 86_400_000);
    db.prepare("UPDATE contact_requests SET updated_at = datetime('now', '-8 days') WHERE id = ?").run(requestId);
    const renewed = await api(`/connections/${b.id}`, a.cookie, 'POST', {});
    assert.equal(renewed.status, 200);
    assert.equal(renewed.body.request.id, requestId);
    assert.equal(renewed.body.request.status, 'pending');
    assert.equal(renewed.body.request.direction, 'outgoing');
    assert.equal(db.prepare('SELECT COUNT(*) n FROM contact_requests WHERE (requester_id = ? AND recipient_id = ?) OR (requester_id = ? AND recipient_id = ?)').get(a.id, b.id, b.id, a.id)!.n, 1);

    // 拒绝的一方随时可以反过来申请
    assert.equal((await api(`/connections/${requestId}/respond`, b.cookie, 'POST', { action: 'reject' })).status, 200);
    const reversed = await api(`/connections/${a.id}`, b.cookie, 'POST', {});
    assert.equal(reversed.status, 200);
    assert.equal(reversed.body.request.id, requestId);
    assert.equal(reversed.body.request.requesterId, b.id);
    assert.equal((await summaryOf(a, matchId))!.contactState, 'pending_incoming');
  });

  await t.test('messages can be reported by the recipient with a snapshot of the text', async () => {
    const a = createUser();
    const b = createUser();
    const outsider = createUser();
    const matchId = matchUsers(a, b);
    const sent = await send(a, matchId, '这是一条需要核实的消息');
    const messageId = sent.body.message.id;
    const systemId = (db.prepare("SELECT id FROM messages WHERE match_id = ? AND kind = 'system'").get(matchId) as { id: number }).id;
    const report = (member: Member, targetId: number) => api('/reports', member.cookie, 'POST', { targetType: 'message', targetId, reason: '不当言论或骚扰', detail: '补充说明' });
    assert.equal((await report(a, messageId)).status, 404, 'cannot report own message');
    assert.equal((await report(outsider, messageId)).status, 404, 'outsiders cannot report');
    assert.equal((await report(b, systemId)).status, 404, 'system messages cannot be reported');
    assert.equal((await report(b, 9_999_999)).status, 404);
    const ok = await report(b, messageId);
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    const row = db.prepare("SELECT detail, snapshot, reporter_id FROM reports WHERE target_type = 'message' AND target_id = ?").get(messageId) as { detail: string; snapshot: string; reporter_id: number };
    assert.equal(row.reporter_id, b.id);
    assert.match(row.detail, /补充说明/);
    assert.equal(row.snapshot, '这是一条需要核实的消息', 'the message text is stored in its own column');
    assert.doesNotMatch(row.detail, /这是一条需要核实的消息/);
  });

  await t.test('account deletion removes the matches and messages of that student', async () => {
    const a = createUser();
    const b = createUser();
    const matchId = matchUsers(a, b);
    await send(a, matchId, '我要注销了');
    await send(b, matchId, '好的');
    assert.equal((await api('/auth/account', a.cookie, 'DELETE', { password })).status, 200);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM matches WHERE id = ?').get(matchId)!.n, 0);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM messages WHERE match_id = ?').get(matchId)!.n, 0);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM message_reads WHERE match_id = ?').get(matchId)!.n, 0);
    assert.equal((await list(b)).some((item) => item.matchId === matchId), false);
    assert.equal((await chat(b, matchId)).status, 404);
    assert.equal(await unreadBadge(b), 0);
  });
});
