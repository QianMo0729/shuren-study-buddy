// 树仁搭子的 Service Worker：让「添加到主屏幕」后的网页像 App 一样打开得快、断网时也能显示界面。
// 只缓存两类东西：
//   1. 带哈希的构建产物（/assets/xxx-AbCd1234.js 等）：内容永不改变，缓存优先；
//   2. 页面本身（index.html）：网络优先，断网时用上一次的版本。
// 接口（/api/）、上传的图片和其它文件一律直接走网络，不缓存，避免看到过期的私聊、打卡等数据。
const SHELL = 'dz-shell-v1';
const ASSETS = 'dz-assets-v1';
const MAX_ASSETS = 300;
const HASHED = /^\/assets\/.+-[A-Za-z0-9_-]{8}\.\w+$/;

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([SHELL, ASSETS]);
      for (const key of await caches.keys()) if (!keep.has(key)) await caches.delete(key);
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  if (req.mode === 'navigate') {
    event.respondWith(page(req));
  } else if (HASHED.test(url.pathname)) {
    event.respondWith(asset(req));
  }
});

async function page(req) {
  const cache = await caches.open(SHELL);
  try {
    const res = await fetch(req);
    if (res.ok && (res.headers.get('content-type') ?? '').includes('text/html')) await cache.put('/index.html', res.clone());
    return res;
  } catch {
    return (await cache.match('/index.html')) ?? Response.error();
  }
}

async function asset(req) {
  const cache = await caches.open(ASSETS);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) {
    await cache.put(req, res.clone());
    // 每次发布都会产生新的哈希文件，旧的按先进先出删掉，缓存不会无限增长
    const keys = await cache.keys();
    for (const key of keys.slice(0, Math.max(0, keys.length - MAX_ASSETS))) await cache.delete(key);
  }
  return res;
}
