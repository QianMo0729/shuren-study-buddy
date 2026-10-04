import { q } from './db.ts';

export function notify(userId: number, title: string, body: string, link: string | null = null) {
  q.run('INSERT INTO notifications (user_id, title, body, link) VALUES (?, ?, ?, ?)', userId, title, body, link);
}

/** 邮件中使用的北京时间 */
export const beijingTime = (d = new Date()) =>
  d.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
