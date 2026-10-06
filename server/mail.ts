import nodemailer from 'nodemailer';
import type { ModerationTargetType } from '../shared/types.ts';
import crypto from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { config } from './config.ts';

const transporter = config.smtp.configured
  ? nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.secure,
      requireTLS: config.smtp.requireTLS,
      auth: { user: config.smtp.user, pass: config.smtp.pass },
      connectionTimeout: 10_000,
      socketTimeout: 20_000,
    })
  : null;

const BRAND = '树仁学发 · 学习搭子';

function layout(title: string, body: string) {
  return `<!doctype html><html lang="zh-CN" dir="ltr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)}</title></head><body style="margin:0;background:#F4F2EC;padding:32px 12px;font-family:-apple-system,'PingFang SC','Microsoft YaHei',sans-serif;color:#18211C">
  <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:18px;overflow:hidden;border:1px solid #E6E3DA">
    <div style="padding:22px 28px;background:#005C65;color:#fff;font-size:15px;letter-spacing:.08em">● ${BRAND}</div>
    <div style="padding:28px">
      <h1 style="margin:0 0 16px;font-size:20px;font-weight:600">${title}</h1>
      ${body}
    </div>
    <div style="padding:16px 28px;border-top:1px solid #EFEDE6;color:#8A948E;font-size:12px">居高怀仁 · 止于至善　|　此邮件由系统自动发送，请勿直接回复</div>
  </div></body></html>`;
}

export async function sendMail(to: string, subject: string, html: string, text: string): Promise<'sent' | 'logged' | 'failed'> {
  if (config.resend.configured) {
    // Reuse a single key across retries of this delivery; never expose provider credentials/errors.
    const idempotencyKey = crypto.randomUUID();
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const result = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${config.resend.apiKey}`,
            'Content-Type': 'application/json',
            'Idempotency-Key': idempotencyKey,
          },
          body: JSON.stringify({ from: `${BRAND} <${config.mailFrom}>`, to: [to], subject, html, text }),
          signal: AbortSignal.timeout(10_000),
        });
        if (result.ok) return 'sent';
        if (attempt === 0 && (result.status === 429 || result.status >= 500)) {
          await delay(1_000);
          continue;
        }
        console.error(`[mail] Resend 发送失败，HTTP ${result.status}`);
        return 'failed';
      } catch {
        if (attempt === 0) { await delay(1_000); continue; }
        console.error('[mail] Resend 网络请求失败');
        return 'failed';
      }
    }
    return 'failed';
  }
  if (!transporter) {
    if (config.isProd || !config.devShowCodes) return 'failed';
    console.log(`\n📮 [仅本地开发：邮件未发送]\n  收件人：${to}\n  主题：${subject}\n  ${text.replace(/\n/g, '\n  ')}\n`);
    return 'logged';
  }
  try {
    await transporter.sendMail({ from: `"${BRAND}" <${config.smtp.from}>`, to, subject, html, text });
    return 'sent';
  } catch {
    console.error('[mail] SMTP 发送失败');
    return 'failed';
  }
}

const PURPOSE_TEXT: Record<string, string> = {
  activation: '激活学习搭子账号',
  password_reset: '重置学习搭子账号密码',
};

export function sendCodeMail(to: string, code: string, purpose: string) {
  const what = PURPOSE_TEXT[purpose] ?? '身份验证';
  const html = layout(
    `${what}验证码`,
    `<p style="margin:0 0 18px;color:#4A5650;line-height:1.7">你正在进行「${what}」操作，验证码为：</p>
     <div style="font-size:34px;letter-spacing:.35em;font-weight:700;color:#005C65;background:#EDF5F4;border-radius:12px;padding:18px 0;text-align:center">${code}</div>
     <p style="margin:18px 0 0;color:#8A948E;font-size:13px;line-height:1.7">验证码 10 分钟内有效。如非本人操作，请忽略此邮件。</p>`,
  );
  return sendMail(to, `【${BRAND}】${what}验证码`, html, `你正在进行「${what}」操作，验证码：${code}（10 分钟内有效）。请勿向他人透露验证码。如非本人操作，请忽略此邮件。`);
}

/**
 * 发码接口收到不符合条件的邮箱时，改发这封说明邮件（见 routes/auth.ts 的 deliverCode）。
 * 接口本身的响应不透露账号状态，只有邮箱的主人能从邮件里知道。
 */
export function sendAccountNoticeMail(to: string, purpose: string) {
  const [title, text] = purpose === 'activation'
    ? ['你的账号已经激活', '有人（可能是你本人）正在用这个邮箱对应的学号激活学习搭子账号。这个账号此前已经激活，不需要再次激活：请直接使用学校邮箱和密码登录；忘记密码时，在登录页选择「忘记密码」即可重新设置。']
    : ['这个邮箱还没有激活账号', '有人（可能是你本人）正在为这个邮箱申请重设学习搭子的登录密码，但它还没有激活账号，所以没有可以重设的密码。如果你想使用学习搭子，请在登录页选择「激活账号」。'];
  const html = layout(
    title,
    `<p style="margin:0;color:#4A5650;line-height:1.8">${text}</p>
     <p style="margin:18px 0 0;color:#8A948E;font-size:13px;line-height:1.7">这封邮件里没有验证码。如非本人操作，请忽略此邮件。</p>`,
  );
  return sendMail(to, `【${BRAND}】${title}`, html, `${text}这封邮件里没有验证码。如非本人操作，请忽略此邮件。`);
}

export function sendContactRequestMail(to: string, nickname: string, matchId: number) {
  const link = `${config.appUrl}/messages/${matchId}`;
  return sendMail(
    to,
    `【${BRAND}】你收到一条交换联系方式的申请`,
    layout('你收到一条交换联系方式的申请',
      `<p style="line-height:1.8">${escapeHtml(nickname)} 在私聊中申请与你交换联系方式。请登录网站查看，并选择同意或拒绝。</p>
       <p style="line-height:1.8">只有双方确认后，系统才会互相展示联系方式。</p>
       <a href="${escapeHtml(link)}" style="display:inline-block;padding:12px 22px;background:#005C65;color:#fff;text-decoration:none;border-radius:12px">去私聊查看</a>`),
    `${nickname} 在私聊中申请与你交换联系方式。请登录 ${link} 查看并选择同意或拒绝。只有双方确认后才会互相展示联系方式。`,
  );
}

export function sendMatchMail(to: string, nickname: string, matchId: number) {
  const link = `${config.appUrl}/messages/${matchId}`;
  return sendMail(
    to,
    `【${BRAND}】你们互相感兴趣了`,
    layout('你们互相感兴趣了',
      `<p style="line-height:1.8">你和 ${escapeHtml(nickname)} 都对彼此感兴趣，现在可以在站内私聊了。</p>
       <p style="line-height:1.8">先聊聊学习目标和时间安排，确认合适后再决定是否交换联系方式。</p>
       <a href="${escapeHtml(link)}" style="display:inline-block;padding:12px 22px;background:#005C65;color:#fff;text-decoration:none;border-radius:12px">去私聊</a>`),
    `你和 ${nickname} 互相感兴趣，现在可以在站内私聊了：${link}`,
  );
}

const TAKEDOWN_KIND_TEXT: Record<ModerationTargetType, string> = {
  profile: '个人主页', post: '招募帖子', forum_post: '社区帖子', comment: '评论', checkin: '打卡',
};

export function sendTakedownMail(to: string, kind: ModerationTargetType, label: string, reason: string, time: string) {
  const what = TAKEDOWN_KIND_TEXT[kind];
  const html = layout(
    `您的${what}已被管理员撤下`,
    `<p style="margin:0 0 14px;line-height:1.8;color:#4A5650">您的${what}「<b style="color:#18211C">${escapeHtml(label)}</b>」因违规被管理员撤下。</p>
     <table style="width:100%;font-size:14px;color:#4A5650;border-collapse:collapse">
       <tr><td style="padding:8px 0;width:72px;color:#8A948E">时间</td><td style="padding:8px 0">${time}</td></tr>
       <tr><td style="padding:8px 0;color:#8A948E">原因</td><td style="padding:8px 0">${escapeHtml(reason)}</td></tr>
     </table>
     <p style="margin:18px 0 0;line-height:1.8;color:#4A5650;font-size:14px">您可以登录系统修改内容后重新发布。如有疑问，请联系树仁书院学生发展中心。</p>
     <a href="${config.appUrl}/me" style="display:inline-block;margin-top:18px;background:#005C65;color:#fff;text-decoration:none;padding:10px 22px;border-radius:999px;font-size:14px">前往查看</a>`,
  );
  return sendMail(
    to,
    `【${BRAND}】您的${what}已被撤下`,
    html,
    `您的${what}「${label}」因违规被管理员撤下，时间：${time}。原因：${reason}`,
  );
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
