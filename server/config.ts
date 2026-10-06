import crypto from 'node:crypto';
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
const megabytes = (v: string | undefined, fallback: number) => {
  const n = Number(v);
  return (v?.trim() && Number.isFinite(n) && n >= 0 ? n : fallback) * 1024 * 1024;
};

export const config = {
  root,
  isProd,
  // 开发与生产都只监听本机；需要让其他设备访问时显式设置 HOST（生产环境应放在反向代理之后）
  host: env.HOST ?? '127.0.0.1',
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
  /**
   * 邮箱验证码校验值的 HMAC 密钥，不写入数据库。未配置时每次启动随机生成：
   * 重启后尚未使用的验证码（10 分钟有效）失效，重新获取即可。
   */
  codePepper: env.CODE_PEPPER?.trim() || crypto.randomBytes(32).toString('hex'),
  /** 每位同学通过 /api/uploads 上传的图片合计上限（不含打卡照片） */
  uploadQuotaBytes: megabytes(env.UPLOAD_QUOTA_MB, 200),
  /** 数据目录所在磁盘的可用空间低于此值时，暂停接收图片与打卡照片 */
  minFreeDiskBytes: megabytes(env.MIN_FREE_DISK_MB, 1024),
  sessionDays: Number(env.SESSION_DAYS ?? 30),
};

fs.mkdirSync(path.join(config.dataDir, 'uploads'), { recursive: true });
