// 逐帧渲染：在无头 Chrome 里调用 film.html 的 window.seek(t)，截图后交给 ffmpeg。
//   node render.mjs --stills 1,2.5,9 --out build/stills      截几张静帧检查
//   node render.mjs --video out/silent.mp4 [--from 0 --to 52 --fps 30]
//   node render.mjs --page photos.html --q scene=a --shot build/desk-a.jpg --w 960 --h 1280
// 自带一个只读静态服务器，只开放 promo/、public/、shared/data/ 和学名字体目录，只监听本机。
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ALLOWED = ['/promo/', '/public/', '/shared/data/', '/node_modules/@fontsource/source-sans-3/files/'];
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.css': 'text/css',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.otf': 'font/otf' };

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, arr) => {
  if (v.startsWith('--')) a.push([v.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true]);
  return a;
}, []));
const W = +(args.w || 1920), H = +(args.h || 1080);

const server = http.createServer((req, res) => {
  const url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const file = path.join(ROOT, path.normalize(url));
  if (!ALLOWED.some((p) => url.startsWith(p)) || !file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); res.end(); return;
  }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--force-color-profile=srgb', '--font-render-hinting=none', '--hide-scrollbars'],
});
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: +(args.dpr || 1) });
page.on('pageerror', (e) => console.error('PAGE ERROR', e.message));
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.error('console:', m.text()); });
await page.goto(`${base}/promo/${args.page || 'film.html'}${args.q ? '?' + args.q : ''}`);
await page.evaluate(() => window.READY);

if (args.shot) {
  fs.mkdirSync(path.dirname(args.shot), { recursive: true });
  await page.screenshot({ path: args.shot, type: args.shot.endsWith('.png') ? 'png' : 'jpeg', quality: args.shot.endsWith('.png') ? undefined : 95 });
  console.log('shot', args.shot);
}

if (args.events) {
  const ev = await page.evaluate(() => window.EVENTS);
  fs.writeFileSync(args.events, JSON.stringify(ev, null, 1));
  console.log('events', ev.length);
}

if (args.stills) {
  const out = args.out || 'build/stills';
  fs.mkdirSync(out, { recursive: true });
  for (const t of String(args.stills).split(',').map(Number)) {
    await page.evaluate((t) => window.seek(t), t);
    await page.screenshot({ path: path.join(out, `${args.prefix || 'f'}_${t.toFixed(2)}.png`) });
  }
  console.log('stills done');
}

if (args.video) {
  const fps = +(args.fps || 30);
  const from = +(args.from || 0);
  const to = +(args.to || await page.evaluate(() => window.DURATION));
  const n = Math.round((to - from) * fps);
  fs.mkdirSync(path.dirname(args.video), { recursive: true });
  const ff = spawn('ffmpeg', ['-y', '-v', 'error', '-f', 'image2pipe', '-framerate', String(fps), '-i', '-',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', String(args.crf || 16), '-pix_fmt', 'yuv420p',
    '-tune', 'animation', '-movflags', '+faststart', args.video], { stdio: ['pipe', 'inherit', 'inherit'] });
  const t0 = Date.now();
  for (let i = 0; i < n; i++) {
    await page.evaluate((t) => window.seek(t), from + i / fps);
    const buf = await page.screenshot({ type: 'png' });
    if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
    if (i % 150 === 0) console.log(`frame ${i}/${n}  ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  }
  ff.stdin.end();
  await new Promise((r) => ff.on('close', r));
  console.log('video done', args.video);
}
await browser.close();
server.close();
