import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { STUDENT_EMAIL_DOMAIN, normalizeStudentEmail, passwordError } from '../shared/authRules.ts';
import { config } from './config.ts';
import { q } from './db.ts';
import { createRateLimiter, ipKey } from './rateLimit.ts';

export interface AuthedUser {
  id: number;
  email: string;
  role: 'user' | 'admin';
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthedUser;
    }
  }
}

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public extra?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

const COOKIE = 'dz_sid';

function parseCookies(header: string | undefined) {
  const out: Record<string, string> = {};
  for (const part of (header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) {
      try { out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); } catch { /* Ignore malformed cookies. */ }
    }
  }
  return out;
}

export function createSession(res: Response, userId: number) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + config.sessionDays * 86400_000);
  q.run(
    'INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)',
    sha256(token),
    userId,
    expires.toISOString(),
  );
  q.run("UPDATE users SET last_login_at = datetime('now') WHERE id = ?", userId);
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.appUrl.startsWith('https'),
    expires,
    path: '/',
  });
}

export function destroySession(req: Request, res: Response) {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (token) q.run('DELETE FROM sessions WHERE token_hash = ?', sha256(token));
  res.clearCookie(COOKIE, { path: '/' });
}

/** 解析会话，不强制登录 */
export function loadUser(req: Request, _res: Response, next: NextFunction) {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (token) {
    const row = q.get<{ id: number; email: string; role: string; expires_at: string }>(
      `SELECT u.id, u.email, u.role, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ? AND u.activated = 1 AND u.password_hash IS NOT NULL`,
      sha256(token),
    );
    if (row && new Date(row.expires_at) > new Date()) {
      req.user = { id: row.id, email: row.email, role: row.role === 'admin' ? 'admin' : 'user' };
    }
  }
  next();
}

export function requireUser(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) return next(new HttpError(401, '请先登录'));
  next();
}

export function requireAdmin(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) return next(new HttpError(401, '请先登录'));
  if (req.user.role !== 'admin') return next(new HttpError(403, '仅管理员可操作'));
  next();
}

export function studentEmail(studentId: unknown): string {
  if (typeof studentId !== 'string' || !/^[0-9]{8}$/.test(studentId)) {
    throw new HttpError(400, '请输入 8 位数字学号');
  }
  return `${studentId}@${STUDENT_EMAIL_DOMAIN}`;
}

export function accountEmail(value: unknown): string {
  const email = normalizeStudentEmail(value);
  if (!email) throw new HttpError(400, '请输入完整的南科大学生邮箱（8 位学号@mail.sustech.edu.cn）');
  return email;
}

export function requirePassword(value: unknown): string {
  const error = passwordError(value);
  if (error) throw new HttpError(400, error);
  return value as string;
}

const isLoopback = (ip: string | undefined) => !!ip && (ip === '::1' || /^(?:::ffff:)?127\./.test(ip));

/**
 * 请求来自本机：直连对端是回环地址，转发链上也没有出现其他地址。
 * 开发代理（vite.config.ts）会带上 X-Forwarded-For，所以经它进来的局域网请求不算本机。
 */
export function isLocalDevRequest(req: Request): boolean {
  return config.devShowCodes && isLoopback(req.socket.remoteAddress) && isLoopback(req.ip);
}

/**
 * 验证码回显只给本机浏览器里的开发页面：除本机来源外，还必须带有回环地址的 Origin。
 * 省略来源头的脚本请求一律不回显，验证码仍会打印在服务端控制台。
 */
export function canShowDevCodes(req: Request): boolean {
  if (!isLocalDevRequest(req)) return false;
  try {
    const host = new URL(String(req.headers.origin)).hostname;
    return host === 'localhost' || host === '[::1]' || /^127(?:\.\d{1,3}){3}$/.test(host);
  } catch {
    return false;
  }
}

/** 限流用的来源标识（IPv6 按 /64 归并） */
export const clientKey = (req: Request) => ipKey(req.ip);

// ---------- 邮箱验证码 ----------

export const CODE_TTL_MIN = 10;
const RESEND_SECONDS = 60;
export type CodePurpose = 'activation' | 'password_reset';

/**
 * 验证码只有 100 万种可能，库里存的是带服务器密钥的 HMAC（密钥不在数据库里，见 config.codePepper）：
 * 只拿到数据库或备份无法离线穷举出仍然有效的验证码。
 */
const codeVerifier = (email: string, purpose: CodePurpose, code: string) =>
  crypto.createHmac('sha256', config.codePepper).update(`${email}:${purpose}:${code}`).digest('hex');

const sameHash = (a: string, b: string) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

export interface IssuedCode {
  id: number;
  /** 占位记录没有验证码 */
  code: string | null;
}

/**
 * 签发验证码。decoy 为 true 时只登记一条占位记录：冷却、每小时上限、过期与试错次数都和真验证码一样，
 * 但校验值是随机数，不对应任何验证码。用于不符合条件的邮箱，使接口对外的表现不随账号状态变化。
 */
export function issueCode(email: string, purpose: CodePurpose, decoy = false): IssuedCode {
  if (!config.mailConfigured && !config.devShowCodes) {
    throw new HttpError(503, '邮件服务暂未配置，暂时无法获取验证码，请稍后再试');
  }
  const last = q.get<{ created_at: string }>(
    'SELECT created_at FROM email_codes WHERE email = ? AND purpose = ? ORDER BY id DESC LIMIT 1',
    email,
    purpose,
  );
  if (last) {
    const elapsed = (Date.now() - new Date(last.created_at.replace(' ', 'T') + 'Z').getTime()) / 1000;
    if (elapsed < RESEND_SECONDS) {
      const retryAfter = Math.ceil(RESEND_SECONDS - elapsed);
      throw new HttpError(429, `发送太频繁，请 ${retryAfter} 秒后再试`, { retryAfter });
    }
  }
  const recent = q.get<{ n: number }>(
    "SELECT COUNT(*) n FROM email_codes WHERE email = ? AND purpose = ? AND created_at > datetime('now', '-1 hour')",
    email, purpose,
  )!.n;
  if (recent >= 5) throw new HttpError(429, '该邮箱获取验证码过于频繁，请稍后再试');
  const code = decoy ? null : String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  // 顺手清理过期超过一天的验证码与激活凭证（上面的每小时计数只看最近一小时）
  q.run('DELETE FROM email_codes WHERE expires_at < ?', new Date(Date.now() - 86_400_000).toISOString());
  q.run('UPDATE email_codes SET used = 1 WHERE email = ? AND purpose = ?', email, purpose);
  const id = Number(q.run(
    'INSERT INTO email_codes (email, purpose, code_hash, expires_at) VALUES (?, ?, ?, ?)',
    email,
    purpose,
    code === null ? crypto.randomBytes(32).toString('hex') : codeVerifier(email, purpose, code),
    new Date(Date.now() + CODE_TTL_MIN * 60_000).toISOString(),
  ).lastInsertRowid);
  return { id, code };
}

/** 邮件没有送达时撤销刚签发的验证码，不留下冷却时间 */
export function discardCode(id: number) {
  q.run('DELETE FROM email_codes WHERE id = ? AND used = 0', id);
}

export function consumeCode(email: string, purpose: CodePurpose, code: string) {
  const row = q.get<{ id: number; code_hash: string; attempts: number; expires_at: string }>(
    'SELECT id, code_hash, attempts, expires_at FROM email_codes WHERE email = ? AND purpose = ? AND used = 0 ORDER BY id DESC LIMIT 1',
    email,
    purpose,
  );
  if (!row) throw new HttpError(400, '请先获取邮箱验证码');
  if (new Date(row.expires_at) <= new Date()) throw new HttpError(400, '验证码已过期，请重新获取');
  if (row.attempts >= 5) throw new HttpError(400, '尝试次数过多，请重新获取验证码');
  if (!sameHash(row.code_hash, codeVerifier(email, purpose, String(code).trim()))) {
    q.run('UPDATE email_codes SET attempts = attempts + 1 WHERE id = ?', row.id);
    throw new HttpError(400, '验证码不正确');
  }
  const result = q.run('UPDATE email_codes SET used = 1 WHERE id = ? AND used = 0', row.id);
  if (Number(result.changes) !== 1) throw new HttpError(400, '验证码已使用，请重新获取');
}

/** A verified mailbox grants only the one-time right to finish password setup. */
export function issueSetupToken(email: string): string {
  const token = crypto.randomBytes(32).toString('base64url');
  q.run("UPDATE email_codes SET used = 1 WHERE email = ? AND purpose = 'activation_setup'", email);
  q.run(
    "INSERT INTO email_codes (email, purpose, code_hash, expires_at) VALUES (?, 'activation_setup', ?, ?)",
    email, sha256(token), new Date(Date.now() + CODE_TTL_MIN * 60_000).toISOString(),
  );
  return token;
}

export function setupTokenEmail(token: unknown): string {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) {
    throw new HttpError(400, '请先完成邮箱验证');
  }
  const row = q.get<{ email: string; expires_at: string }>(
    "SELECT email, expires_at FROM email_codes WHERE purpose = 'activation_setup' AND code_hash = ? AND used = 0",
    sha256(token),
  );
  if (!row || new Date(row.expires_at) <= new Date()) throw new HttpError(400, '验证已失效，请重新获取验证码');
  return row.email;
}

export function consumeSetupToken(token: string): string {
  const email = setupTokenEmail(token);
  const result = q.run("UPDATE email_codes SET used = 1 WHERE purpose = 'activation_setup' AND code_hash = ? AND used = 0", sha256(token));
  if (Number(result.changes) !== 1) throw new HttpError(400, '验证已失效，请重新获取验证码');
  return email;
}

export function revokeAccountCredentials(userId: number, email: string) {
  q.run('DELETE FROM sessions WHERE user_id = ?', userId);
  q.run('UPDATE email_codes SET used = 1 WHERE email = ?', email);
}

// ---------- 简易限流 ----------

// 实现见 server/rateLimit.ts。键里含有请求方可以随意更换的内容（如邮箱）时，
// 必须先过一道按来源计数的限额，再登记这个键。
const limiter = createRateLimiter();

export function rateLimit(key: string, max: number, windowMs: number) {
  if (!limiter.hit(key, max, windowMs)) throw new HttpError(429, '操作过于频繁，请稍后再试');
}
