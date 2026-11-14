import express, { type NextFunction, type Request, type Response } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { HttpError, loadUser } from './auth.ts';
import { config } from './config.ts';
import './db.ts';
import './matches.ts';
import './community.ts';
import { adminRouter } from './routes/admin.ts';
import { adminActivityRouter } from './routes/adminActivity.ts';
import { activityRouter } from './routes/activity.ts';
import { authRouter } from './routes/auth.ts';
import { miscRouter } from './routes/misc.ts';
import { postRouter } from './routes/posts.ts';
import { connectionsRouter } from './routes/connections.ts';
import { profileRouter } from './routes/profiles.ts';
import { matchRouter } from './routes/match.ts';
import { chatRouter } from './routes/chat.ts';
import { notesRouter } from './routes/notes.ts';
import { forumRouter } from './routes/forum.ts';
import { checkinRouter } from './routes/checkins.ts';
import { timetableRouter } from './routes/timetables.ts';
import { startUploadMaintenance } from './uploads.ts';
import { startAuditMaintenance } from './audits.ts';
import './buddies.ts';

const app = express();
app.set('trust proxy', 'loopback');
app.disable('x-powered-by');
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  next();
});
app.use('/api', (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    const allowed = new Set([new URL(config.appUrl).origin]);
    if (!config.isProd) { allowed.add('http://localhost:5173'); allowed.add('http://127.0.0.1:5173'); }
    if ((req.headers.origin && !allowed.has(req.headers.origin)) || req.headers['sec-fetch-site'] === 'cross-site') {
      return next(new HttpError(403, '请求来源无效，请从网站页面重试'));
    }
  }
  next();
});
app.use(express.json({ limit: '8mb' }));
// 只有接口需要识别登录状态；静态文件不必为每个请求查一次会话
app.use('/api', loadUser);

app.use('/api/auth', authRouter);
app.use('/api/profiles', profileRouter);
app.use('/api/posts', postRouter);
app.use('/api/connections', connectionsRouter);
app.use('/api/match', matchRouter);
app.use('/api/chat', chatRouter);
app.use('/api/notes', notesRouter);
app.use('/api/forum', forumRouter);
app.use('/api/checkins', checkinRouter);
app.use('/api/timetables', timetableRouter);
app.use('/api/activity', activityRouter);
app.use('/api/admin', adminActivityRouter);
app.use('/api/admin', adminRouter);
app.use('/api', miscRouter);
app.use('/api', (_req, _res, next) => next(new HttpError(404, '接口不存在')));

// 生产环境由同一进程托管前端构建产物
const dist = path.join(config.root, 'dist');
if (config.isProd && fs.existsSync(dist)) {
  app.use(
    express.static(dist, {
      index: false,
      // 带哈希的构建产物长期缓存；吉祥物等可替换的图片只缓存 1 小时；sw.js 与清单不缓存
      setHeaders: (res, file) => {
        const hashed = /-[A-Za-z0-9_-]{8}\.\w+$/.test(file);
        // Service Worker 与应用清单每次都要向服务器确认，发布新版本后才能尽快生效
        const fresh = /[\\/](sw\.js|manifest\.webmanifest)$/.test(file);
        res.setHeader('Cache-Control', fresh ? 'no-cache' : hashed ? 'public, max-age=31536000, immutable' : 'public, max-age=3600');
      },
    }),
  );
  // 构建产物里没有的文件返回 404 而不是首页：发布新版本后，旧页面请求已被替换的分块时能明确失败，前端据此刷新到新版本
  app.use('/assets', (_req, res) => {
    res.status(404).type('text/plain').send('Not found');
  });
  app.get(/.*/, (_req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(dist, 'index.html'));
  });
}

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, ...err.extra });
  if ((err as any)?.type === 'entity.parse.failed') return res.status(400).json({ error: '请求格式不正确' });
  if ((err as any)?.type === 'entity.too.large') return res.status(413).json({ error: '上传内容过大' });
  console.error(err);
  res.status(500).json({ error: '服务器开小差了，请稍后再试' });
});

startUploadMaintenance();
startAuditMaintenance();

app.listen(config.port, config.host, () => {
  console.log(`\n🌳 树仁学发 · 学习搭子 API 已启动：http://${config.host}:${config.port}`);
  if (!config.mailConfigured) {
    console.log(config.isProd
      ? 'ℹ️  未配置 Resend / SMTP：邮件验证码功能暂不可用，公开页面可正常访问。'
      : '⚠️  未配置 Resend / SMTP：验证码与通知邮件将打印在此控制台，验证码回显仅供开发调试。');
  }
  if (!config.adminEmails.length) console.log('ℹ️  未配置 ADMIN_EMAILS：可在 .env 中填写管理员邮箱（逗号分隔）。');
});
