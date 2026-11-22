import type { NotificationPreferences } from '../shared/types.ts';
import { q, tx } from './db.ts';

export function notify(userId: number, title: string, body: string, link: string | null = null) {
  q.run('INSERT INTO notifications (user_id, title, body, link) VALUES (?, ?, ?, ?)', userId, title, body, link);
}

/** 第一次调整分项前，三项都沿用该账号原来的总开关。 */
export function emailReminderRecipient(userId: number) {
  const row = q.get<{ email: string; incoming_interest: number; mutual_match: number; contact_request: number }>(
    `SELECT u.email, COALESCE(p.incoming_interest, u.message_email_enabled) AS incoming_interest,
            COALESCE(p.mutual_match, u.message_email_enabled) AS mutual_match,
            COALESCE(p.contact_request, u.message_email_enabled) AS contact_request
     FROM users u LEFT JOIN message_email_preferences p ON p.user_id = u.id
     WHERE u.id = ? AND u.activated = 1`, userId);
  return row && { email: row.email, preferences: {
    incomingInterest: !!row.incoming_interest, mutualMatch: !!row.mutual_match, contactRequest: !!row.contact_request,
  } satisfies NotificationPreferences };
}

export function updateEmailPreferences(userId: number, changes: Partial<NotificationPreferences>) {
  return tx(() => {
    const prefs = { ...emailReminderRecipient(userId)!.preferences, ...changes };
    q.run(`INSERT INTO message_email_preferences (user_id, incoming_interest, mutual_match, contact_request)
           VALUES (?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET incoming_interest = excluded.incoming_interest,
           mutual_match = excluded.mutual_match, contact_request = excluded.contact_request`,
      userId, Number(prefs.incomingInterest), Number(prefs.mutualMatch), Number(prefs.contactRequest));
    // 回退到只认识总开关的服务端时，保留所有已关闭的提醒。
    q.run('UPDATE users SET message_email_enabled = ? WHERE id = ?', Number(Object.values(prefs).every(Boolean)), userId);
    return prefs;
  });
}

/** 邮件中使用的北京时间 */
export const beijingTime = (d = new Date()) =>
  d.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
