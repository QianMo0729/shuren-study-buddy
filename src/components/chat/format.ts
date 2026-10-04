// 私聊里的时间显示：会话列表用短格式，消息之间的分隔线带具体时刻。

const pad = (n: number) => String(n).padStart(2, '0');
const hm = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

function dayDiff(d: Date, now: Date) {
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  return Math.round((start(now) - start(d)) / 86_400_000);
}

/** 会话列表：今天 14:05 / 昨天 / 周三 / 10月3日 / 2025/10/3 */
export function listTime(iso: string | null | undefined, now = new Date()) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const diff = dayDiff(d, now);
  if (diff <= 0) return hm(d);
  if (diff === 1) return '昨天';
  if (diff < 7) return WEEKDAYS[d.getDay()];
  if (d.getFullYear() === now.getFullYear()) return `${d.getMonth() + 1}月${d.getDate()}日`;
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}

/** 消息分隔线：14:05 / 昨天 09:12 / 10月3日 14:05 / 2025年10月3日 14:05 */
export function separatorTime(iso: string, now = new Date()) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const diff = dayDiff(d, now);
  if (diff <= 0) return hm(d);
  if (diff === 1) return `昨天 ${hm(d)}`;
  if (d.getFullYear() === now.getFullYear()) return `${d.getMonth() + 1}月${d.getDate()}日 ${hm(d)}`;
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${hm(d)}`;
}

/** 两条消息相隔超过 5 分钟时显示时间分隔 */
export const needsSeparator = (prev: string | undefined, cur: string) =>
  !prev || new Date(cur).getTime() - new Date(prev).getTime() > 5 * 60_000;

export const fullTime = (iso: string) =>
  new Date(iso).toLocaleString('zh-CN', { hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });

/** 单条消息的字数上限（与服务器一致） */
export const MESSAGE_MAX = 1000;
