import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const envFile = path.join(root, '.env');
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

const env = process.env;
const list = (v: string | undefined) =>
  (v ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);

const isProd = env.NODE_ENV === 'production';
const mailFrom = env.MAIL_FROM?.trim() || '';
const resendConfigured = Boolean(env.RESEND_API_KEY?.trim() && mailFrom);
const smtpConfigured = Boolean(env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS && mailFrom);
const mailConfigured = resendConfigured || smtpConfigured;

export const config = {
  root,
  isProd,
  host: env.HOST ?? (isProd ? '127.0.0.1' : '0.0.0.0'),
  port: Number(env.PORT ?? 8787),
  appUrl: env.APP_URL ?? 'http://localhost:5173',
  dataDir: path.resolve(root, env.DATA_DIR ?? 'data'),
  allowedDomains: ['mail.sustech.edu.cn'],
  adminEmails: list(env.ADMIN_EMAILS),
  mailFrom,
  mailConfigured,
  resend: {
    configured: resendConfigured,
    apiKey: env.RESEND_API_KEY?.trim() ?? '',
  },
  smtp: {
    configured: smtpConfigured,
    host: env.SMTP_HOST ?? '',
    port: Number(env.SMTP_PORT ?? 465),
    secure: (env.SMTP_SECURE ?? 'true') !== 'false',
    requireTLS: env.SMTP_REQUIRE_TLS === 'true',
    user: env.SMTP_USER ?? '',
    pass: env.SMTP_PASS ?? '',
    from: mailFrom,
  },
  /** 验证码回显仅供本地开发；生产环境始终关闭。 */
  devShowCodes: !isProd && (env.DEV_SHOW_CODES ? env.DEV_SHOW_CODES === 'true' : !mailConfigured),
  sessionDays: Number(env.SESSION_DAYS ?? 30),
};

fs.mkdirSync(path.join(config.dataDir, 'uploads'), { recursive: true });
