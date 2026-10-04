import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { STUDENT_EMAIL_DOMAIN, normalizeStudentEmail, passwordError } from '../shared/authRules.ts';
import { config } from './config.ts';
import { q } from './db.ts';

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

export function canShowDevCodes(req: Request): boolean {
  const ip = req.ip ?? '';
  return config.devShowCodes && (ip === '::1' || /^(?:::ffff:)?127\./.test(ip));
}

// ---------- 邮箱验证码 ----------

export const CODE_TTL_MIN = 10;
const RESEND_SECONDS = 60;
export type CodePurpose = 'activation' | 'password_reset';

export function issueCode(email: string, purpose: CodePurpose): string {
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
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  q.run('UPDATE email_codes SET used = 1 WHERE email = ? AND purpose = ?', email, purpose);
  q.run(
    'INSERT INTO email_codes (email, purpose, code_hash, expires_at) VALUES (?, ?, ?, ?)',
    email,
    purpose,
    sha256(`${email}:${purpose}:${code}`),
    new Date(Date.now() + CODE_TTL_MIN * 60_000).toISOString(),
  );
  return code;
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
  if (row.code_hash !== sha256(`${email}:${purpose}:${String(code).trim()}`)) {
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

const buckets = new Map<string, { count: number; reset: number }>();

export function rateLimit(key: string, max: number, windowMs: number) {
  const now = Date.now();
  if (buckets.size > 10_000) {
    for (const [bucketKey, bucket] of buckets) if (bucket.reset <= now) buckets.delete(bucketKey);
  }
  const b = buckets.get(key);
  if (!b || b.reset < now) {
    buckets.set(key, { count: 1, reset: now + windowMs });
    return;
  }
  b.count++;
  if (b.count > max) throw new HttpError(429, '操作过于频繁，请稍后再试');
}
