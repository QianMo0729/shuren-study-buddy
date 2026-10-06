import assert from 'node:assert/strict';
import fs from 'node:fs';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import test from 'node:test';
import { createServer, resolveConfig } from 'vite';

// The development server serves the repository directory, which is also where the database,
// uploaded images and local secrets live by default. These tests run the real vite.config.ts.
const root = path.resolve(import.meta.dirname, '..');
const configFile = path.join(root, 'vite.config.ts');
const resolve = () => resolveConfig({ root, configFile, logLevel: 'silent' }, 'serve');

test('the dev server listens on this machine only unless LAN access is requested, and tells the API who is calling', async (t) => {
  const previous = process.env.DEV_LAN;
  t.after(() => { if (previous === undefined) delete process.env.DEV_LAN; else process.env.DEV_LAN = previous; });
  process.env.DEV_LAN = '';
  const config = await resolve();
  assert.equal(config.server.host, '127.0.0.1');
  const proxy = config.server.proxy!['/api'] as { target: string; xfwd?: boolean };
  // Without the forwarded address the API would see every proxied request as coming from loopback.
  assert.equal(proxy.xfwd, true);
  assert.match(proxy.target, /^http:\/\/127\.0\.0\.1:\d+$/);
  process.env.DEV_LAN = 'true';
  assert.equal((await resolve()).server.host, true);
});

test('the dev server refuses to serve the database, uploads and local records as static files', { timeout: 60_000 }, async (t) => {
  // A data directory inside the served root, like the default ./data.
  const dataDir = fs.mkdtempSync(path.join(root, 'node_modules', '.tmp-dev-data-'));
  const previous = process.env.DATA_DIR;
  process.env.DATA_DIR = dataDir;
  const secret = 'SECRET-CONTENT-THAT-MUST-NOT-BE-SERVED';
  const files = ['app.db', 'app.db-wal', 'app.db-shm', 'uploads/0123456789abcdef01234567.jpg', 'notes.txt'];
  fs.mkdirSync(path.join(dataDir, 'uploads'));
  for (const file of files) fs.writeFileSync(path.join(dataDir, file), secret);
  const server = await createServer({
    root, configFile, logLevel: 'silent',
    server: { port: 0, host: '127.0.0.1', hmr: false, watch: null }, optimizeDeps: { noDiscovery: true, include: [] },
  });
  t.after(async () => {
    await server.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
    if (previous === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = previous;
  });
  await server.listen();
  const base = `http://127.0.0.1:${(server.httpServer!.address() as AddressInfo).port}`;
  const get = async (url: string) => {
    const response = await fetch(`${base}${url}`);
    return { status: response.status, text: await response.text() };
  };

  const relative = path.relative(root, dataDir).split(path.sep).join('/');
  for (const file of files) {
    // By URL path, by absolute path, and through the import queries that return raw file contents.
    for (const url of [`/${relative}/${file}`, `/@fs${encodeURI(dataDir.split(path.sep).join('/'))}/${file}`, `/${relative}/${file}?raw`, `/${relative}/${file}?url`]) {
      const response = await get(url);
      assert.equal(response.status, 403, url);
      assert.equal(response.text.includes(secret), false, url);
    }
  }
  // Database files are refused wherever they are, and the default data directory is sealed even when DATA_DIR points elsewhere.
  const stray = path.join(root, 'node_modules', `.tmp-stray-${process.pid}.db`);
  fs.writeFileSync(stray, secret);
  t.after(() => fs.rmSync(stray, { force: true }));
  assert.equal((await get(`/node_modules/${path.basename(stray)}`)).status, 403);
  if (fs.existsSync(path.join(root, 'data', 'app.db'))) assert.equal((await get('/data/app.db')).status, 403);
  if (fs.existsSync(path.join(root, '.env'))) assert.equal((await get('/.env')).status, 403);

  // Source files, including the similarly named shared/data directory, are still served.
  assert.equal((await get('/shared/options.ts')).status, 200);
  const catalog = fs.readdirSync(path.join(root, 'shared', 'data')).find((name) => /\.(json|ts)$/.test(name));
  if (catalog) assert.equal((await get(`/shared/data/${catalog}${catalog.endsWith('.json') ? '?import' : ''}`)).status, 200);
});
