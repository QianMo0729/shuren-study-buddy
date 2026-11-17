import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

test('partner benefits preserve quotas, private access and single-code allocation', async (t) => {
  t.mock.method(Date, 'now', () => Date.parse('2026-11-16T00:00:00Z'));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shuren-benefits-'));
  process.env.DATA_DIR = dir;
  process.env.XMIND_LIST_TOKEN = 'fixture-partner-token-with-at-least-32-characters';
  delete process.env.MARGINNOTE_RENEWAL_TERMS;
  const { db, q } = await import('../server/db.ts');
  const { sha256 } = await import('../server/auth.ts');
  const benefits = await import('../server/benefits.ts');
  t.after(() => { db.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const user = (email: string) => Number(q.run('INSERT INTO users (email, activated) VALUES (?, 1)', email).lastInsertRowid);
  const a = user('benefits-a@mail.sustech.edu.cn');
  const b = user('benefits-b@mail.sustech.edu.cn');
  const c = user('benefits-c@mail.sustech.edu.cn');
  const matureVisit = (id: number) => {
    const visit = benefits.startBenefitVisit(id);
    q.run('UPDATE benefit_visits SET started_at = ? WHERE token_hash = ?', Date.now() - 31_000, sha256(visit.token));
    return visit.token;
  };
  const body = (token: string) => ({ token, phone: '13800138000', consent: true });

  await t.test('requires consent, a valid phone, a user-bound visit and the waiting period', () => {
    const token = benefits.startBenefitVisit(a).token;
    assert.throws(() => benefits.registerXmind(a, { ...body(token), consent: false }), /同意/);
    assert.throws(() => benefits.registerXmind(a, { ...body(token), phone: '123' }), /手机号/);
    assert.throws(() => benefits.registerXmind(b, body(token)), /过期/);
    assert.throws(() => benefits.registerXmind(a, body(token)), /30 秒/);
    q.run('UPDATE benefit_visits SET started_at = ? WHERE token_hash = ?', Date.now() - 3_600_001, sha256(token));
    assert.throws(() => benefits.registerXmind(a, body(token)), /过期/);
    assert.equal(benefits.xmindRegistrations().length, 0);
  });

  await t.test('a retry is idempotent, while the rules permit the same phone on separate submissions', () => {
    const token = matureVisit(a);
    const first = benefits.registerXmind(a, body(token));
    assert.deepEqual(benefits.registerXmind(a, body(token)), first);
    benefits.registerXmind(b, body(matureVisit(b)));
    assert.equal(benefits.xmindRegistrations().length, 2);
    assert.equal(benefits.benefitStatus().xmind.remaining, 198);
  });

  await t.test('an account keeps one place however many times it opens the page, and cannot swap in another number', () => {
    const first = benefits.registerXmind(a, body(matureVisit(a)));
    for (let i = 0; i < 5; i++) assert.deepEqual(benefits.registerXmind(a, body(matureVisit(a))), first);
    assert.throws(() => benefits.registerXmind(a, { ...body(matureVisit(a)), phone: '13900139000' }), /已经登记过/);
    assert.equal(benefits.xmindRegistrations().length, 2);
    // The student sees enough to recognise the number, never the whole of it.
    const mine = benefits.myXmindRegistration(a)!;
    assert.equal(mine.phone, '138****8000');
    assert.ok(!Number.isNaN(Date.parse(mine.createdAt)));
    assert.equal(benefits.myXmindRegistration(c), null);
  });

  await t.test('the 200th registration succeeds, record 201 is refused, and a successful retry still works', () => {
    for (let i = 2; i < 199; i++) q.run('INSERT INTO benefit_xmind (visit_hash, phone) VALUES (?, ?)', `fixture-${i}`, '13800138000');
    const d = user('benefits-d@mail.sustech.edu.cn');
    const tokenC = matureVisit(c), tokenD = matureVisit(d);
    const last = benefits.registerXmind(c, body(tokenC));
    assert.throws(() => benefits.registerXmind(d, body(tokenD)), /名额已满/);
    assert.equal(benefits.xmindRegistrations().length, 200);
    assert.equal(benefits.benefitStatus().xmind.remaining, 0);
    assert.deepEqual(benefits.registerXmind(c, body(tokenC)), last);
    // An account that already holds a place is still told so when the list is full and its visit is new.
    assert.deepEqual(benefits.registerXmind(c, body(matureVisit(c))), last);
  });

  await t.test('removing a registration frees its place for a corrected number, and closing an account removes its number', async () => {
    const { runAccountCleanup } = await import('../server/social.ts');
    const mine = () => q.get<{ id: number }>('SELECT id FROM benefit_xmind WHERE user_id = ?', c);
    assert.equal(benefits.deleteXmindRegistration(mine()!.id), true);
    assert.equal(benefits.deleteXmindRegistration(999_999), false);
    assert.equal(benefits.benefitStatus().xmind.remaining, 1);
    benefits.registerXmind(c, { ...body(matureVisit(c)), phone: '13900139000' });
    assert.equal(benefits.myXmindRegistration(c)!.phone, '139****9000');
    assert.equal(benefits.benefitStatus().xmind.remaining, 0);
    runAccountCleanup(c);
    assert.equal(mine(), undefined);
    assert.equal(q.get<{ n: number }>('SELECT count(*) AS n FROM benefit_visits WHERE user_id = ?', c)!.n, 0);
    assert.equal(benefits.benefitStatus().xmind.remaining, 1);
  });

  await t.test('codes stay private, claims are idempotent, and deleted accounts never release a used code', () => {
    assert.equal(benefits.importMarginNoteCodes(['TESTCODE001', 'TESTCODE002', 'TESTCODE001']), 2);
    assert.equal(benefits.benefitStatus().marginnote.enabled, false);
    assert.equal(benefits.benefitStatus().marginnote.phase, 'upcoming');
    assert.throws(() => benefits.claimMarginNote(a), /暂未开放/);
    process.env.MARGINNOTE_RENEWAL_TERMS = 'Fixture terms for tests only';
    assert.equal(benefits.benefitStatus().marginnote.phase, 'open');
    const first = benefits.claimMarginNote(a);
    assert.deepEqual(benefits.claimMarginNote(a), first);
    assert.notEqual(benefits.claimMarginNote(b).code, first.code);
    assert.equal(benefits.myMarginNoteCode(c), null);
    assert.throws(() => benefits.claimMarginNote(c), /领完/);
    q.run('DELETE FROM users WHERE id = ?', b);
    assert.equal(benefits.benefitStatus().marginnote.remaining, 0);
    assert.equal(benefits.benefitStatus().marginnote.phase, 'exhausted');
    assert.throws(() => benefits.claimMarginNote(c), /领完/);
    assert.equal(JSON.stringify(benefits.benefitStatus()).includes('TESTCODE'), false);
  });

  await t.test('expiry is distinct from an unopened activity, even when renewal terms are absent', (subtest) => {
    subtest.mock.method(Date, 'now', () => Date.parse('2027-02-13T00:00:00+08:00'));
    const terms = process.env.MARGINNOTE_RENEWAL_TERMS;
    try {
      assert.equal(benefits.benefitStatus().marginnote.phase, 'ended');
      delete process.env.MARGINNOTE_RENEWAL_TERMS;
      assert.equal(benefits.benefitStatus().marginnote.phase, 'ended');
      assert.equal(benefits.benefitStatus().marginnote.enabled, false);
      assert.throws(() => benefits.claimMarginNote(c), /暂未开放或已结束/);
    } finally { process.env.MARGINNOTE_RENEWAL_TERMS = terms; }
  });

  await t.test('the list accepts only admins or the partner credential and exports no unrelated user fields', async () => {
    const { benefitsRouter } = await import('../server/routes/benefits.ts');
    // Exercise the real router middleware without needing a listening network socket.
    const call = (url: string, headers: Record<string, string> = {}, method = 'GET') => new Promise<{ status: number; body: any; headers: Record<string, string> }>((resolve) => {
      const role = headers['x-fixture-role'];
      const [pathname, search = ''] = url.split('?');
      const responseHeaders: Record<string, string> = {};
      const res = {
        setHeader: (key: string, value: string) => { responseHeaders[key] = value; },
        type: (value: string) => { responseHeaders['content-type'] = value; return res; },
        json: (value: unknown) => { resolve({ status: 200, body: value, headers: responseHeaders }); },
        send: (value: unknown) => { resolve({ status: 200, body: value, headers: responseHeaders }); },
      };
      const req = { method, url: pathname, headers: { ...headers, authorization: headers.Authorization }, query: Object.fromEntries(new URLSearchParams(search)), ip: '127.0.0.1',
        user: role ? { id: a, email: 'fixture@example.com', role } : undefined };
      benefitsRouter.handle(req as any, res as any, (error: any) => resolve({ status: error?.status ?? 404, body: error?.message, headers: responseHeaders }));
    });
    const endpoint = '/xmind/registrations';
    assert.equal((await call(endpoint)).status, 401);
    for (const role of ['user', 'moderator']) assert.equal((await call(endpoint, { 'x-fixture-role': role })).status, 403);
    assert.equal((await call(endpoint, { Authorization: 'Bearer incorrect' })).status, 401);
    assert.equal((await call(endpoint, { 'x-fixture-role': 'admin' })).status, 200);
    const headers = { Authorization: `Bearer ${process.env.XMIND_LIST_TOKEN}` };
    const records = await call(endpoint, headers);
    assert.equal(records.status, 200);
    assert.deepEqual(Object.keys(records.body.items[0]).sort(), ['createdAt', 'id', 'phone']);
    const csv = await call(`${endpoint}?format=csv`, headers);
    assert.equal(csv.status, 200);
    assert.match(csv.body, /手机号/);
    assert.equal((await call('/marginnote/mine', headers)).status, 401);
    assert.equal((await call('/xmind/mine', headers)).status, 401);
    assert.equal((await call('/xmind/mine', { 'x-fixture-role': 'user' })).body.registration.phone, '138****8000');
    // The partner credential reads the list; only a site administrator can remove a record.
    const target = `${endpoint}/${records.body.items[0].id}`;
    assert.equal((await call(target, headers, 'DELETE')).status, 401);
    assert.equal((await call(target, { 'x-fixture-role': 'moderator' }, 'DELETE')).status, 403);
    assert.equal((await call(target, { 'x-fixture-role': 'admin' }, 'DELETE')).status, 200);
    assert.equal((await call(target, { 'x-fixture-role': 'admin' }, 'DELETE')).status, 404);
    assert.equal((await call(endpoint, headers)).body.items.length, records.body.items.length - 1);
  });
});
