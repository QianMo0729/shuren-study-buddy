import { Router } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import '../connections.ts';
import type { SessionUser } from '../../shared/types.ts';
import { missingFields, pickProfileInput } from '../../shared/profileRules.ts';
import { config } from '../config.ts';
import { q, tx } from '../db.ts';
import { sendCodeMail } from '../mail.ts';
import {
  HttpError, accountEmail, canShowDevCodes, consumeCode, consumeSetupToken, createSession, destroySession,
  issueCode, issueSetupToken, rateLimit, requirePassword, requireUser, revokeAccountCredentials, setupTokenEmail, sha256, studentEmail,
} from '../auth.ts';
import type { CodePurpose } from '../auth.ts';

export const authRouter = Router();
authRouter.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });

interface Account { id: number; email: string; activated: number; password_hash: string | null }
const account = (email: string) => q.get<Account>('SELECT id, email, activated, password_hash FROM users WHERE email = ?', email);
const PASSWORD_COST = 12;
// Unknown and inactive accounts still do a password comparison to avoid a fast account-existence oracle.
const DUMMY_HASH = bcrypt.hashSync('This-is-not-an-account-password-4278', PASSWORD_COST);

function verificationCode(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9]{6}$/.test(value)) throw new HttpError(400, '请输入 6 位数字验证码');
  return value;
}

async function deliverCode(email: string, purpose: CodePurpose) {
  const code = issueCode(email, purpose);
  const status = await sendCodeMail(email, code, purpose);
  if (status === 'failed') {
    q.run('DELETE FROM email_codes WHERE email = ? AND purpose = ? AND code_hash = ? AND used = 0',
      email, purpose, sha256(`${email}:${purpose}:${code}`));
    throw new HttpError(502, '验证码邮件发送失败，请稍后重试');
  }
  return code;
}

function ensureCanActivate(email: string) {
  const user = account(email);
  if (user?.activated && user.password_hash) throw new HttpError(409, '该账号已激活，请使用邮箱和密码登录，或找回密码');
}

export function sessionUser(userId: number): SessionUser | null {
  const u = q.get<{ id: number; email: string; role: string }>('SELECT id, email, role FROM users WHERE id = ?', userId);
  if (!u) return null;
  const p = q.get<{ nickname: string; published: number; taken_down: number; data: string; saved_at: string | null }>(
    'SELECT nickname, published, taken_down, data, saved_at FROM profiles WHERE user_id = ?',
    userId,
  );
  const unread = q.get<{ n: number }>('SELECT COUNT(*) n FROM notifications WHERE user_id = ? AND read = 0', userId)!.n;
  let questionnaireComplete = false;
  try { questionnaireComplete = !!p?.saved_at && missingFields(pickProfileInput(JSON.parse(p.data))).length === 0; } catch { /* Unreadable answers must be filled again. */ }
  return {
    id: u.id,
    email: u.email,
    role: u.role === 'admin' ? 'admin' : 'user',
    nickname: p?.nickname ?? null,
    published: !!p?.published && !p.taken_down,
    hasProfile: !!p,
    questionnaireComplete,
    unread,
  };
}

/** 管理员名单写在 .env 的 ADMIN_EMAILS 中，每次登录时同步角色 */
function syncRole(userId: number, email: string) {
  if (config.adminEmails.includes(email)) q.run("UPDATE users SET role = 'admin' WHERE id = ?", userId);
}

authRouter.get('/me', (req, res) => {
  res.json({ user: req.user ? sessionUser(req.user.id) : null });
});

authRouter.post('/request-activation-code', async (req, res) => {
  const email = studentEmail(req.body?.studentId);
  rateLimit(`code:${req.ip}`, 20, 60 * 60_000);
  ensureCanActivate(email);
  const code = await deliverCode(email, 'activation');
  res.json({ ok: true, email, devCode: canShowDevCodes(req) ? code : undefined });
});

authRouter.post('/verify-activation-code', (req, res) => {
  const email = studentEmail(req.body?.studentId);
  const code = verificationCode(req.body?.code);
  rateLimit(`verify:${req.ip}:${email}`, 10, 10 * 60_000);
  ensureCanActivate(email);
  const outcome = tx(() => {
    try {
      consumeCode(email, 'activation', code);
    } catch (error) {
      // Incorrect attempts must commit even when the request is rejected.
      if (error instanceof HttpError) return { error };
      throw error;
    }
    return { setupToken: issueSetupToken(email) };
  });
  if ('error' in outcome) throw outcome.error;
  res.json({ email, setupToken: outcome.setupToken });
});

authRouter.post('/activate', async (req, res) => {
  rateLimit(`activate:${req.ip}`, 30, 10 * 60_000);
  const password = requirePassword(req.body?.password);
  const email = setupTokenEmail(req.body?.setupToken);
  ensureCanActivate(email);
  const hash = await bcrypt.hash(password, PASSWORD_COST);
  const user = tx(() => {
    // Recheck after the asynchronous hash so concurrent completion cannot overwrite a password.
    ensureCanActivate(email);
    consumeSetupToken(req.body.setupToken);
    q.run(`INSERT INTO users (email, activated, password_hash) VALUES (?, 1, ?)
           ON CONFLICT(email) DO UPDATE SET activated = 1, password_hash = excluded.password_hash`, email, hash);
    const id = account(email)!.id;
    revokeAccountCredentials(id, email);
    syncRole(id, email);
    destroySession(req, res);
    createSession(res, id);
    return sessionUser(id);
  });
  res.json({ user });
});

authRouter.post('/login', async (req, res) => {
  rateLimit(`login-ip:${req.ip}`, 60, 10 * 60_000);
  const email = accountEmail(req.body?.email);
  rateLimit(`login-email:${email}`, 15, 10 * 60_000);
  const password: unknown = req.body?.password;
  if (typeof password !== 'string' || !password || Buffer.byteLength(password, 'utf8') > 72) {
    throw new HttpError(401, '邮箱或密码不正确，请确认账号已激活');
  }
  const before = account(email);
  const valid = await bcrypt.compare(password, before?.password_hash || DUMMY_HASH);
  // Password resets can run while bcrypt yields. Never issue a session for an outdated hash.
  const current = account(email);
  if (!valid || !before?.activated || !before.password_hash || !current?.activated || current.password_hash !== before.password_hash) {
    throw new HttpError(401, '邮箱或密码不正确，请确认账号已激活');
  }
  syncRole(current.id, email);
  destroySession(req, res);
  createSession(res, current.id);
  res.json({ user: sessionUser(current.id) });
});

authRouter.post('/request-reset-code', async (req, res) => {
  const email = accountEmail(req.body?.email);
  rateLimit(`code:${req.ip}`, 20, 60 * 60_000);
  rateLimit(`reset-request:${email}`, 5, 60 * 60_000);
  const user = account(email);
  // A reset request never reveals whether an address has a password-enabled account.
  if (!user?.activated || !user.password_hash) return res.json({ ok: true });
  const code = await deliverCode(email, 'password_reset');
  res.json({ ok: true, devCode: canShowDevCodes(req) ? code : undefined });
});

authRouter.post('/reset-password', async (req, res) => {
  const email = accountEmail(req.body?.email);
  const code = verificationCode(req.body?.code);
  const password = requirePassword(req.body?.password);
  rateLimit(`reset:${req.ip}:${email}`, 10, 10 * 60_000);
  rateLimit(`reset-ip:${req.ip}`, 30, 10 * 60_000);
  const user = account(email);
  if (!user?.activated || !user.password_hash) throw new HttpError(400, '验证码不正确或已失效，请重新获取');
  const hash = await bcrypt.hash(password, PASSWORD_COST);
  const outcome = tx(() => {
    try {
      consumeCode(email, 'password_reset', code);
    } catch (error) {
      if (error instanceof HttpError) return { error };
      throw error;
    }
    q.run('UPDATE users SET password_hash = ? WHERE id = ?', hash, user.id);
    revokeAccountCredentials(user.id, email);
    return { ok: true };
  });
  if ('error' in outcome) throw outcome.error;
  destroySession(req, res);
  res.json({ ok: true });
});

// Retired OTP login must never bypass the password required by activated accounts.
authRouter.post(['/request-login-code', '/verify-login-code'], (_req, _res) => {
  throw new HttpError(410, '验证码直接登录已停用，请激活账号后使用邮箱和密码登录');
});

authRouter.delete('/account', requireUser, async (req, res) => {
  const uid = req.user!.id;
  rateLimit(`delete-account:${uid}`, 5, 10 * 60_000);
  const current = account(req.user!.email);
  const password: unknown = req.body?.password;
  if (!current?.password_hash || typeof password !== 'string' || Buffer.byteLength(password, 'utf8') > 72
    || !(await bcrypt.compare(password, current.password_hash))) throw new HttpError(400, '密码不正确');
  const files = q.all<{ name: string }>('SELECT name FROM uploads WHERE user_id = ?', uid);
  tx(() => {
    const latest = account(current.email);
    if (!latest || latest.password_hash !== current.password_hash) throw new HttpError(409, '账号状态已改变，请重新登录后操作');
    revokeAccountCredentials(uid, current.email);
    q.run('DELETE FROM email_codes WHERE email = ?', current.email);
    q.run('DELETE FROM contact_requests WHERE requester_id = ? OR recipient_id = ?', uid, uid);
    q.run('DELETE FROM exclusions WHERE user_id = ? OR target_id = ?', uid, uid);
    q.run('DELETE FROM favorites WHERE user_id = ? OR target_id = ?', uid, uid);
    q.run('DELETE FROM contact_views WHERE viewer_id = ? OR target_id = ?', uid, uid);
    q.run('DELETE FROM post_interests WHERE user_id = ? OR post_id IN (SELECT id FROM posts WHERE user_id = ?)', uid, uid);
    q.run('DELETE FROM notifications WHERE user_id = ?', uid);
    q.run('DELETE FROM reports WHERE reporter_id = ?', uid);
    q.run('DELETE FROM uploads WHERE user_id = ?', uid);
    q.run('DELETE FROM profiles WHERE user_id = ?', uid);
    q.run(`UPDATE posts SET title = '已撤回', description = '', time_text = '', location = '', tags = '[]',
           deleted = 1, status = 'closed', updated_at = datetime('now') WHERE user_id = ?`, uid);
    // Keep the numeric id so administrator audit records remain referentially intact.
    q.run("UPDATE users SET email = ?, activated = 0, password_hash = NULL, role = 'user', last_login_at = NULL WHERE id = ?",
      `deleted-${uid}-${crypto.randomBytes(12).toString('hex')}@deleted.invalid`, uid);
  });
  for (const { name } of files) {
    if (!/^[a-f0-9]{24}\.(jpg|png|webp)$/.test(name)) continue;
    try { fs.rmSync(path.join(config.dataDir, 'uploads', name), { force: true }); }
    catch { console.error('[account] 注销账号的上传文件清理失败；文件访问权限已撤销'); }
  }
  destroySession(req, res);
  res.json({ ok: true });
});

authRouter.post('/logout', (req, res) => {
  destroySession(req, res);
  res.json({ ok: true });
});
