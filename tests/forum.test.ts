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

// 1×1 PNG：上传接口只检查文件头，足够用于权限测试
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

async function startServer() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'study-buddy-forum-'));
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

test('forum posts, comments, likes, search and file access respect ownership, exclusion and moderation', { timeout: 120_000 }, async (t) => {
  const app = await startServer();
  const { api, db } = app;
  t.after(async () => { db.close(); await app.stop(); });

  let seq = 0;
  function createUser(opts: { profile?: Partial<ProfileInput>; published?: boolean; role?: 'admin' | 'user'; noProfile?: boolean } = {}) {
    seq++;
    const studentId = `1262${String(seq).padStart(4, '0')}`;
    const email = `${studentId}@mail.sustech.edu.cn`;
    const id = Number(db.prepare("INSERT INTO users (email, activated, password_hash, role) VALUES (?, 1, 'x', ?)").run(email, opts.role ?? 'user').lastInsertRowid);
    const data: ProfileInput = {
      ...emptyProfile(), realName: `私密姓名${id}`, studentId,
      contacts: { showEmail: true, wechat: `private-wechat-${id}`, qq: '', phone: '', other: '' },
      privacyConsent: consent, planTags: ['期末复习备考'], places: ['library'], schedule: [0, 1], studyType: 'quiet',
      ...opts.profile,
    };
    const nickname = `测试同学${id}`;
    if (!opts.noProfile) {
      db.prepare('INSERT INTO profiles (user_id, nickname, data, published) VALUES (?, ?, ?, ?)').run(id, nickname, JSON.stringify(data), opts.published === false ? 0 : 1);
    }
    const token = crypto.randomBytes(32).toString('base64url');
    db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(
      crypto.createHash('sha256').update(token).digest('hex'), id, new Date(Date.now() + 3_600_000).toISOString());
    return { id, email, nickname, cookie: `dz_sid=${token}`, data };
  }

  const coverName = `${'c'.repeat(24)}.jpg`;
  const a = createUser({ profile: {
    major: '计算机科学与技术', gender: 'female', grade: 'y2', studyType: 'quiet', status: 'seeking', subjects: ['线性代数'],
    bio: '喜欢在图书馆刷题', photos: [coverName], photoVisibility: 'public',
  } });
  const b = createUser({ profile: { major: '数学与应用数学', gender: 'male', grade: 'y4', studyType: 'discuss', status: 'busy', subjects: ['雅思'], bio: '准备雅思口语' } });
  // 主页未公开的作者：作者条件一律不命中
  const hidden = createUser({ published: false, profile: { major: '计算机科学与技术', gender: 'female', studyType: 'quiet', subjects: ['线性代数'] } });
  const viewer = createUser();
  const excluded = createUser();
  const admin = createUser({ role: 'admin' });
  const fresh = createUser({ noProfile: true });
  db.prepare('INSERT INTO exclusions (user_id, target_id) VALUES (?, ?)').run(excluded.id, a.id);

  const upload = async (user: { cookie: string }, kind: 'forum' | 'photo' = 'forum') => {
    const r = await api('/uploads', user.cookie, 'POST', { dataUrl: PNG, kind });
    assert.equal(r.status, 200, r.text);
    return r.body.name as string;
  };
  const create = async (user: { cookie: string }, body: Record<string, unknown>) => api('/forum/posts', user.cookie, 'POST', { title: '', images: [], ...body });
  const feedIds = async (user: { cookie: string }, query = '') => ((await api(`/forum/posts${query}`, user.cookie)).body.items as { id: number }[]).map((p) => p.id);

  let postA = 0;
  let postB = 0;
  let postHidden = 0;
  let imageA = '';

  await t.test('requires login', async () => {
    assert.equal((await api('/forum/posts')).status, 401);
    assert.equal((await api('/forum/search', '', 'POST', { criteria: [] })).status, 401);
  });

  await t.test('validates post content and only accepts the author\'s own forum uploads', async () => {
    assert.equal((await create(a, { body: '   ' })).status, 400);
    assert.equal((await create(a, { body: 'x'.repeat(2001) })).status, 400);
    assert.equal((await create(a, { title: 't'.repeat(61), body: '正文' })).status, 400);
    imageA = await upload(a);
    const otherImage = await upload(b);
    const photoKind = await upload(a, 'photo');
    assert.equal((await create(a, { body: '别人的图', images: [otherImage] })).status, 400, 'cannot attach another user\'s upload');
    assert.equal((await create(a, { body: '头像图', images: [photoKind] })).status, 400, 'profile photos are not forum images');
    assert.equal((await create(a, { body: '伪造', images: ['../../etc/passwd'] })).status, 400);
    assert.equal((await create(a, { body: '格式', images: 'abc' })).status, 400);
    const five = await Promise.all(Array.from({ length: 4 }, () => upload(a)));
    assert.equal((await create(a, { body: '五张图', images: [...five, imageA] })).status, 400);

    const created = await create(a, { title: '  期末周的图书馆  ', body: '最近在复习线性代数，\r\n\r\n\r\n\r\n一起刷题吗？\u202E', images: [imageA, imageA] });
    assert.equal(created.status, 200, created.text);
    const post = created.body.post;
    postA = post.id;
    assert.equal(post.title, '期末周的图书馆');
    assert.equal(post.body, '最近在复习线性代数，\n\n一起刷题吗？');
    assert.deepEqual(post.images, [imageA]);
    assert.equal(post.isMine, true);
    assert.deepEqual(Object.keys(post.author).sort(), ['cover', 'id', 'nickname', 'profileVisible']);
    assert.equal(post.author.nickname, a.nickname);
    assert.equal(post.author.profileVisible, true);
    assert.equal(post.author.cover, coverName);
    for (const secret of [a.email, a.data.realName, 'private-wechat']) assert.ok(!created.text.includes(secret), `leaked ${secret}`);

    postB = (await create(b, { title: '雅思口语搭子', body: '每天练习 IELTS 口语，周末去咖啡厅' })).body.post.id;
    postHidden = (await create(hidden, { body: '线代复习笔记分享，线性代数真难' })).body.post.id;
    assert.ok(postB && postHidden);

    // 首次发帖的同学会自动获得系统昵称
    const first = await create(fresh, { body: '第一次发帖' });
    assert.equal(first.status, 200);
    assert.match(first.body.post.author.nickname, /\S/);
    assert.equal(first.body.post.author.profileVisible, false);
  });

  await t.test('author visibility controls cover and profile link', async () => {
    const seenByViewer = (await api(`/forum/posts/${postHidden}`, viewer.cookie)).body.post;
    assert.equal(seenByViewer.author.profileVisible, false);
    assert.equal(seenByViewer.author.cover, null);
    const priv = createUser({ profile: { photos: [coverName], photoVisibility: 'private' } });
    const p = (await create(priv, { body: '照片不公开' })).body.post;
    assert.equal(p.author.profileVisible, true);
    assert.equal(p.author.cover, null);
  });

  await t.test('only the author can edit or delete a post', async () => {
    assert.equal((await api(`/forum/posts/${postA}`, b.cookie, 'PUT', { title: '', body: '篡改', images: [] })).status, 403);
    assert.equal((await api(`/forum/posts/${postA}`, b.cookie, 'DELETE')).status, 403);
    db.prepare("UPDATE forum_posts SET reviewed_at = datetime('now') WHERE id = ?").run(postA);
    const edited = await api(`/forum/posts/${postA}`, a.cookie, 'PUT', { title: '期末周的图书馆', body: '最近在复习线性代数和高数，一起刷题吗？', images: [imageA] });
    assert.equal(edited.status, 200, edited.text);
    assert.match(edited.body.post.body, /高数/);
    assert.equal(db.prepare('SELECT reviewed_at FROM forum_posts WHERE id = ?').get(postA)!.reviewed_at, null, 'edits go back to review');
    const disposable = (await create(a, { body: '马上删掉' })).body.post.id;
    assert.equal((await api(`/forum/posts/${disposable}`, a.cookie, 'DELETE')).status, 200);
    assert.equal((await api(`/forum/posts/${disposable}`, a.cookie)).status, 404);
    assert.equal((await api(`/forum/posts/${disposable}`, viewer.cookie)).status, 404);
    assert.equal((await api(`/forum/posts/${disposable}`, a.cookie, 'PUT', { body: '复活', images: [] })).status, 404);
    assert.ok(!(await feedIds(a)).includes(disposable));
    assert.equal((await api(`/forum/post/${disposable}/like`, viewer.cookie, 'POST', {})).status, 404);
  });

  await t.test('feed paginates newest first and mine=1 lists only my posts', async () => {
    // 两天前的旧帖：不占用今天的发帖额度
    const insert = db.prepare("INSERT INTO forum_posts (user_id, title, body, created_at) VALUES (?, ?, ?, datetime('now', '-2 days'))");
    for (let i = 0; i < 22; i++) insert.run(viewer.id, '', `批量帖子 ${i}`);
    const first = await api('/forum/posts', viewer.cookie);
    assert.equal(first.body.items.length, 20);
    assert.equal(first.body.hasMore, true);
    const ids = first.body.items.map((p: { id: number }) => p.id);
    assert.deepEqual(ids, [...ids].sort((x: number, y: number) => y - x));
    const second = await api(`/forum/posts?before=${ids.at(-1)}`, viewer.cookie);
    assert.ok(second.body.items.length > 0);
    assert.ok(second.body.items.every((p: { id: number }) => p.id < ids.at(-1)));
    const mine = await api('/forum/posts?mine=1', a.cookie);
    assert.ok(mine.body.items.length > 0);
    assert.ok(mine.body.items.every((p: { isMine: boolean }) => p.isMine));
  });

  await t.test('exclusion hides posts, comments, likes and images in both directions', async () => {
    const postX = (await create(excluded, { body: '被排除者的帖子 线性代数' })).body.post.id;
    assert.ok(!(await feedIds(excluded)).includes(postA));
    assert.ok(!(await feedIds(a)).includes(postX));
    assert.equal((await api(`/forum/posts/${postA}`, excluded.cookie)).status, 404);
    assert.equal((await api(`/forum/posts/${postX}`, a.cookie)).status, 404);
    assert.equal((await api(`/forum/post/${postA}/like`, excluded.cookie, 'POST', {})).status, 404);
    assert.equal((await api(`/forum/post/${postA}/comments`, excluded.cookie, 'POST', { body: '你好' })).status, 404);
    assert.equal((await api(`/forum/post/${postA}/comments`, excluded.cookie)).status, 404);
    assert.equal((await api(`/files/${imageA}`, excluded.cookie)).status, 404);
    assert.ok(!(await feedIds(excluded, '?q=线性代数')).includes(postA));
    const search = await api('/forum/search', excluded.cookie, 'POST', { criteria: [{ field: 'postText', mode: 'should', values: ['线性代数'] }] });
    assert.ok(!search.body.items.some((p: { id: number }) => p.id === postA));
    // 被排除者在第三方帖子下的评论，对另一方不可见，也不计入评论数
    const c = await api(`/forum/post/${postB}/comments`, excluded.cookie, 'POST', { body: '来自被排除者的评论' });
    assert.equal(c.status, 200);
    const seenByA = await api(`/forum/post/${postB}/comments`, a.cookie);
    assert.ok(!seenByA.body.items.some((x: { body: string }) => x.body.includes('被排除者')));
    const seenByViewer = await api(`/forum/post/${postB}/comments`, viewer.cookie);
    assert.ok(seenByViewer.body.items.some((x: { body: string }) => x.body.includes('被排除者')));
    const countForA = (await api(`/forum/posts/${postB}`, a.cookie)).body.post.commentCount;
    const countForViewer = (await api(`/forum/posts/${postB}`, viewer.cookie)).body.post.commentCount;
    assert.equal(countForViewer - countForA, 1);
    assert.equal((await api('/reports', a.cookie, 'POST', { targetType: 'comment', targetId: c.body.comment.id, reason: '其他' })).status, 404);
  });

  await t.test('comments notify the content owner and can only be deleted by their author', async () => {
    const before = db.prepare('SELECT COUNT(*) n FROM notifications WHERE user_id = ?').get(a.id)!.n as number;
    assert.equal((await api(`/forum/post/${postA}/comments`, viewer.cookie, 'POST', { body: '  ' })).status, 400);
    assert.equal((await api(`/forum/post/${postA}/comments`, viewer.cookie, 'POST', { body: 'x'.repeat(501) })).status, 400);
    const c = await api(`/forum/post/${postA}/comments`, viewer.cookie, 'POST', { body: '一起！我也在复习线代' });
    assert.equal(c.status, 200, c.text);
    assert.equal(c.body.comment.isMine, true);
    assert.equal(c.body.comment.targetType, 'post');
    assert.equal(c.body.comment.author.nickname, viewer.nickname);
    const note = db.prepare('SELECT title, body, link FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 1').get(a.id) as { title: string; body: string; link: string };
    assert.equal(note.title, `${viewer.nickname} 评论了你的帖子`);
    assert.match(note.body, /线代/);
    assert.equal(note.link, `/community/posts/${postA}`);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM notifications WHERE user_id = ?').get(a.id)!.n, before + 1);
    // 评论自己的帖子不通知自己
    assert.equal((await api(`/forum/post/${postA}/comments`, a.cookie, 'POST', { body: '好呀' })).status, 200);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM notifications WHERE user_id = ?').get(a.id)!.n, before + 1);

    const list = await api(`/forum/post/${postA}/comments`, b.cookie);
    assert.deepEqual(list.body.items.map((x: { body: string }) => x.body), ['一起！我也在复习线代', '好呀']);
    assert.ok(!list.text.includes(viewer.email));
    assert.equal((await api(`/forum/posts/${postA}`, b.cookie)).body.post.commentCount, 2);

    const report = await api('/reports', b.cookie, 'POST', { targetType: 'comment', targetId: c.body.comment.id, reason: '其他' });
    assert.equal(report.status, 200);
    const detail = db.prepare("SELECT snapshot FROM reports WHERE target_type = 'comment' AND target_id = ?").get(c.body.comment.id) as { snapshot: string };
    assert.match(detail.snapshot, /一起！我也在复习线代/);

    assert.equal((await api(`/forum/comments/${c.body.comment.id}`, a.cookie, 'DELETE')).status, 403, 'post author cannot delete others\' comments');
    assert.equal((await api(`/forum/comments/${c.body.comment.id}`, viewer.cookie, 'DELETE')).status, 200);
    assert.equal((await api(`/forum/comments/${c.body.comment.id}`, viewer.cookie, 'DELETE')).status, 404);
    assert.deepEqual((await api(`/forum/post/${postA}/comments`, b.cookie)).body.items.map((x: { body: string }) => x.body), ['好呀']);
    assert.equal((await api('/forum/foo/1/comments', b.cookie)).status, 404);
    assert.equal((await api('/forum/post/999999/comments', b.cookie)).status, 404);
  });

  await t.test('likes toggle and report liked state per viewer', async () => {
    const on = await api(`/forum/post/${postA}/like`, viewer.cookie, 'POST', {});
    assert.deepEqual(on.body, { liked: true, likeCount: 1 });
    assert.deepEqual((await api(`/forum/post/${postA}/like`, b.cookie, 'POST', {})).body, { liked: true, likeCount: 2 });
    const off = await api(`/forum/post/${postA}/like`, viewer.cookie, 'POST', {});
    assert.deepEqual(off.body, { liked: false, likeCount: 1 });
    const forB = (await api(`/forum/posts/${postA}`, b.cookie)).body.post;
    assert.equal(forB.liked, true);
    assert.equal(forB.likeCount, 1);
    assert.equal((await api(`/forum/posts/${postA}`, viewer.cookie)).body.post.liked, false);
  });

  await t.test('keyword search covers title and body with synonyms and ranks by hits', async () => {
    const two = (await create(viewer, { title: '线代', body: '雅思和线性代数一起准备' })).body.post.id;
    const r = await api(`/forum/posts?q=${encodeURIComponent('线代 雅思')}`, viewer.cookie);
    const ids = r.body.items.map((p: { id: number }) => p.id);
    assert.equal(ids[0], two, 'two hits rank first');
    assert.ok(ids.includes(postA), 'synonym 线代 → 线性代数');
    assert.ok(ids.includes(postB), 'synonym 雅思 → IELTS / title hit');
    assert.ok(ids.indexOf(two) < ids.indexOf(postA));
    assert.equal(r.body.items[0].match.score, 2);
    const none = await api(`/forum/posts?q=${encodeURIComponent('不存在的词汇')}`, viewer.cookie);
    assert.deepEqual(none.body.items, []);
    // 关键词结果的分页：before 为上一页最后一条
    const insert = db.prepare("INSERT INTO forum_posts (user_id, title, body, created_at) VALUES (?, ?, ?, datetime('now', '-2 days'))");
    for (let i = 0; i < 25; i++) insert.run(b.id, '', `分页关键词 羽毛球 ${i}`);
    const p1 = await api(`/forum/posts?q=${encodeURIComponent('羽毛球')}`, viewer.cookie);
    assert.equal(p1.body.items.length, 20);
    assert.equal(p1.body.hasMore, true);
    const p2 = await api(`/forum/posts?q=${encodeURIComponent('羽毛球')}&before=${p1.body.items.at(-1).id}`, viewer.cookie);
    assert.equal(p2.body.items.length, 5);
    assert.equal(p2.body.hasMore, false);
    const all = [...p1.body.items, ...p2.body.items].map((p: { id: number }) => p.id);
    assert.equal(new Set(all).size, 25);
  });

  await t.test('advanced post search applies majority, must and exclusion rules; hidden authors never match author criteria', async () => {
    const search = async (body: Record<string, unknown>) => {
      const r = await api('/forum/search', viewer.cookie, 'POST', body);
      assert.equal(r.status, 200, r.text);
      return r.body as { items: { id: number; match: { score: number; total: number; matched: string[]; snippet?: string } }[]; total: number };
    };
    assert.equal((await api('/forum/search', viewer.cookie, 'POST', { criteria: [] })).status, 400);
    const should = (field: string, values: string[]) => ({ field, mode: 'should', values });
    // a：女、静、y2、seeking；4 项加分中命中 2 项 → 精确不命中，模糊命中
    const twoOfFour = [should('gender', ['female']), should('studyType', ['quiet']), should('grade', ['y4']), should('status', ['busy'])];
    assert.ok(!(await search({ criteria: twoOfFour, matchMode: 'precise' })).items.some((p) => p.id === postA));
    const fuzzy = await search({ criteria: twoOfFour, matchMode: 'fuzzy' });
    const hitA = fuzzy.items.find((p) => p.id === postA)!;
    assert.ok(hitA);
    assert.equal(hitA.match.score, 2);
    assert.equal(hitA.match.total, 4);
    assert.ok(hitA.match.matched.includes('0:gender'));
    // 3/4 → 精确命中
    const three = [...twoOfFour.slice(0, 3), should('status', ['seeking'])];
    assert.ok((await search({ criteria: three, matchMode: 'precise' })).items.some((p) => p.id === postA));
    // 作者主页不可见：作者条件不命中（即便资料里写了同样的专业）
    const mustCs = await search({ criteria: [{ field: 'major', mode: 'must', values: ['计算机科学与技术'] }] });
    assert.ok(mustCs.items.some((p) => p.id === postA));
    assert.ok(!mustCs.items.some((p) => p.id === postHidden));
    // 「排除」因此也不会排除隐藏作者的帖子
    const notCs = await search({ criteria: [{ field: 'major', mode: 'not', values: ['计算机科学与技术'] }, should('postText', ['线代'])] });
    assert.ok(notCs.items.some((p) => p.id === postHidden));
    assert.ok(!notCs.items.some((p) => p.id === postA));
    // 正文条件 + 作者科目条件（同义词）；结果按命中数降序
    const combo = await search({ criteria: [should('postText', ['线性代数']), should('subjects', ['线代'])], matchMode: 'fuzzy' });
    const comboA = combo.items.find((p) => p.id === postA)!;
    assert.equal(comboA.match.score, 2);
    assert.match(comboA.match.snippet ?? '', /线性代数/);
    assert.equal(combo.items.find((p) => p.id === postHidden)!.match.score, 1);
    const scores = combo.items.map((p) => p.match.score);
    assert.deepEqual(scores, [...scores].sort((x, y) => y - x));
    assert.equal(combo.total, combo.items.length);
    // 必须 + 正文：只剩含「雅思 / IELTS」的帖子
    const ielts = await search({ criteria: [{ field: 'postText', mode: 'must', values: ['雅思'] }] });
    assert.ok(ielts.items.some((p) => p.id === postB));
    assert.ok(!ielts.items.some((p) => p.id === postA));
    // 关键词作为附加的必需条件
    const withKeyword = await search({ criteria: [should('gender', ['male', 'female'])], keyword: '咖啡厅' });
    assert.deepEqual(withKeyword.items.map((p) => p.id), [postB]);
    // 同学检索专用条件（如 overlap、schedule）在帖子检索里被忽略
    assert.equal((await api('/forum/search', viewer.cookie, 'POST', { criteria: [should('overlap', ['2'])] })).status, 400);
  });

  await t.test('takedown hides a post from others but not from its author or admins', async () => {
    db.prepare("UPDATE forum_posts SET taken_down = 1, taken_down_at = datetime('now'), takedown_reason = '包含不当内容' WHERE id = ?").run(postA);
    assert.equal((await api(`/forum/posts/${postA}`, viewer.cookie)).status, 404);
    assert.ok(!(await feedIds(viewer)).includes(postA));
    assert.ok(!(await feedIds(viewer, `?q=${encodeURIComponent('线性代数')}`)).includes(postA));
    assert.equal((await api(`/forum/post/${postA}/like`, viewer.cookie, 'POST', {})).status, 404);
    assert.equal((await api(`/forum/post/${postA}/comments`, viewer.cookie, 'POST', { body: '还在吗' })).status, 404);
    assert.equal((await api(`/forum/post/${postA}/comments`, viewer.cookie)).status, 404);
    assert.equal((await api('/reports', viewer.cookie, 'POST', { targetType: 'forum_post', targetId: postA, reason: '其他' })).status, 404);
    const own = await api(`/forum/posts/${postA}`, a.cookie);
    assert.equal(own.status, 200);
    assert.equal(own.body.post.takenDown, true);
    assert.equal(own.body.post.takedownReason, '包含不当内容');
    assert.equal((await api(`/forum/post/${postA}/comments`, a.cookie)).status, 200, 'author can still read the discussion');
    assert.equal((await api(`/forum/post/${postA}/comments`, a.cookie, 'POST', { body: '申诉' })).status, 404, 'but cannot add to it');
    assert.equal((await api(`/forum/posts/${postA}`, admin.cookie)).body.post.takenDown, true);
    db.prepare('UPDATE forum_posts SET taken_down = 0, takedown_reason = NULL WHERE id = ?').run(postA);
    const restored = await api(`/forum/posts/${postA}`, viewer.cookie);
    assert.equal(restored.status, 200);
    assert.equal(restored.body.post.takenDown, false);
    assert.equal(restored.body.post.takedownReason, null);
    const report = await api('/reports', viewer.cookie, 'POST', { targetType: 'forum_post', targetId: postA, reason: '其他', detail: '补充' });
    assert.equal(report.status, 200);
    const stored = db.prepare("SELECT detail, snapshot FROM reports WHERE target_type = 'forum_post' AND target_id = ?").get(postA) as { detail: string; snapshot: string };
    assert.equal(stored.detail, '补充');
    assert.match(stored.snapshot, /期末周的图书馆/);
  });

  await t.test('forum images are readable only through posts visible to the viewer', async () => {
    const loose = await upload(b);
    assert.equal((await api(`/files/${loose}`, b.cookie)).status, 200, 'owner');
    assert.equal((await api(`/files/${loose}`, viewer.cookie)).status, 404, 'not yet attached to any post');
    const pid = (await create(b, { body: '晒晒今天的晚霞', images: [loose] })).body.post.id;
    assert.equal((await api(`/files/${loose}`, viewer.cookie)).status, 200);
    assert.equal((await api(`/files/${loose}`, admin.cookie)).status, 200);
    db.prepare('INSERT INTO exclusions (user_id, target_id) VALUES (?, ?)').run(b.id, viewer.id);
    assert.equal((await api(`/files/${loose}`, viewer.cookie)).status, 404, 'exclusion');
    db.prepare('DELETE FROM exclusions WHERE user_id = ? AND target_id = ?').run(b.id, viewer.id);
    db.prepare('UPDATE forum_posts SET taken_down = 1 WHERE id = ?').run(pid);
    assert.equal((await api(`/files/${loose}`, viewer.cookie)).status, 404, 'taken down');
    assert.equal((await api(`/files/${loose}`, b.cookie)).status, 200, 'owner keeps access');
    db.prepare('UPDATE forum_posts SET taken_down = 0 WHERE id = ?').run(pid);
    assert.equal((await api(`/forum/posts/${pid}`, b.cookie, 'DELETE')).status, 200);
    assert.equal((await api(`/files/${loose}`, viewer.cookie)).status, 404, 'deleted');
    assert.equal((await api(`/files/${imageA}`, viewer.cookie)).status, 200, 'image of a visible post');
  });

  await t.test('daily post limit', async () => {
    const insert = db.prepare('INSERT INTO forum_posts (user_id, title, body, deleted) VALUES (?, ?, ?, 1)');
    const busy = createUser();
    for (let i = 0; i < 20; i++) insert.run(busy.id, '', `已删除也计数 ${i}`);
    assert.equal((await create(busy, { body: '第 21 条' })).status, 429);
  });

  await t.test('people search supports the subjects field', async () => {
    const r = await api('/profiles/search', viewer.cookie, 'POST', { criteria: [{ field: 'subjects', mode: 'must', values: ['线代'] }] });
    assert.equal(r.status, 200, r.text);
    const ids = r.body.items.map((x: { id: number }) => x.id);
    assert.ok(ids.includes(a.id));
    assert.ok(!ids.includes(b.id));
    assert.ok(!ids.includes(hidden.id), 'unpublished profiles stay hidden');
    const ielts = await api('/profiles/search', viewer.cookie, 'POST', { criteria: [{ field: 'subjects', mode: 'should', values: ['IELTS'] }] });
    assert.deepEqual(ielts.body.items.map((x: { id: number }) => x.id), [b.id]);
    // 帖子正文条件不属于同学检索
    const postOnly = await api('/profiles/search', viewer.cookie, 'POST', { criteria: [{ field: 'postText', mode: 'must', values: ['不存在'] }] });
    assert.ok(postOnly.body.items.length >= 2, 'postText is ignored for people search');
  });
});
