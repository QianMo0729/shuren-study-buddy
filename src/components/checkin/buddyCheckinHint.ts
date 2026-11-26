import { beijingDay, shortDate, type ActivityConfig } from '../../../shared/activity';
import type { BuddyStatus, DayCheckinIssue } from '../../../shared/types';

const ISSUE_TEXT: Record<DayCheckinIssue, string> = {
  deleted: '已删除',
  taken_down: '已被撤下',
  invalid: '已被判无效',
  caption: '说明字数不够',
  location: '定位未达到精度要求',
};

type Hint = { text: string; tone: 'plain' | 'warn' | 'good' };
type Rules = Pick<ActivityConfig, 'windowMinutes' | 'distanceMeters'>;
const time = (iso: string) => new Date(Date.parse(iso) + 8 * 3_600_000).toISOString().slice(11, 16);

/** 个人首条符合要求后，仍须等服务器确认两人完成了同一次打卡。 */
export function buddyCheckinHint(status: BuddyStatus, rules: Rules, now: number, receiptAt?: string): Hint | null {
  const { pair, today, week, season } = status;
  if (!pair || !today) return receiptAt ? { tone: 'plain', text: '你还没有绑定搭子，这次只记录社区打卡。' } : null;
  if (receiptAt) {
    const date = beijingDay(new Date(receiptAt));
    if (date !== today.date) {
      const matched = week?.events.some((event) => event.date === date);
      if (matched) return { tone: 'good', text: `${shortDate(date)}你们已完成一次同时打卡。` };
      if (week && date >= week.start && date <= week.end) return { tone: 'plain', text: `${shortDate(date)}没有同时打卡记录。` };
      return { tone: 'plain', text: `这条打卡拍摄于${shortDate(date)}，已超出本周记录的查询范围。` };
    }
  }
  if (season.status === 'ended') return receiptAt ? { tone: 'plain', text: '赛季已结束，这次只记录社区打卡。' } : null;
  if (!pair.started || season.status !== 'running') return { tone: 'plain', text: `你们从${shortDate(pair.startsOn)}开始计分。` };

  const { mine, partner, pairOutcome } = today;
  const windowMs = rules.windowMinutes * 60_000;
  const nearby = rules.distanceMeters > 0 ? `、相距不超过 ${rules.distanceMeters} 米` : '';
  const together = `两人须在同一天打卡，相差不超过 ${rules.windowMinutes} 分钟${nearby}。`;
  const repeat = mine && (!receiptAt || Date.parse(receiptAt) > Date.parse(mine.at)) ? '本次只记录社区打卡。' : '';
  const first = mine ? `你 ${time(mine.at)} 的首次打卡` : '';
  if (mine && !mine.counts) {
    const reason = mine.issue ? ISSUE_TEXT[mine.issue] : '未达到个人要求';
    const both = partner && !partner.counts ? '，搭子的首次打卡也未达标' : '';
    return { tone: 'warn', text: `${first}${reason}${both}，今天未计入同时打卡。${repeat}` };
  }
  if (partner && !partner.counts) {
    return { tone: 'warn', text: `${mine ? `${first}符合个人要求。` : ''}搭子的首次打卡未达标，今天未计入同时打卡。${repeat}` };
  }
  if (pairOutcome === 'matched' || (pairOutcome === undefined && week?.events.some((event) => event.date === today.date))) {
    return { tone: 'good', text: `你们今天已完成 1 次同时打卡。${repeat}` };
  }
  if (mine && partner) {
    const late = pairOutcome === 'too_late' || (pairOutcome === undefined && Math.abs(Date.parse(mine.at) - Date.parse(partner.at)) > windowMs);
    if (late) return { tone: 'warn', text: `两人的首次打卡都符合个人要求，但相差超过 ${rules.windowMinutes} 分钟，今天未计入同时打卡。${repeat}` };
    if (pairOutcome === 'too_far') {
      const limit = rules.distanceMeters > 0 ? `超过 ${rules.distanceMeters} 米` : '过远';
      return { tone: 'warn', text: `两人的首次打卡都符合个人要求，但相距${limit}，今天未计入同时打卡。${repeat}` };
    }
    if (week) return { tone: 'plain', text: `两人的首次打卡都符合个人要求。今天未列入本周同时打卡记录。${repeat}` };
    return { tone: 'plain', text: `两人的首次打卡都符合个人要求。今天的同时打卡记录尚未确认。${repeat}` };
  }
  if (mine) {
    const expired = now - Date.parse(mine.at) > windowMs;
    return expired
      ? { tone: 'warn', text: `${first}符合个人要求。搭子未在 ${rules.windowMinutes} 分钟内打卡，今天未计入同时打卡。${repeat}` }
      : { tone: 'plain', text: `${first}符合个人要求，正在等搭子打卡。${together}${repeat}` };
  }
  // 提交成功后如遇状态尚未同步，不显示拍摄前的提示。
  if (receiptAt) return { tone: 'plain', text: '正在核对这次打卡的搭子活动记录。' };
  if (partner && now - Date.parse(partner.at) > windowMs) {
    return { tone: 'warn', text: `搭子已在 ${time(partner.at)} 打卡，已超过 ${rules.windowMinutes} 分钟，今天无法完成同时打卡。` };
  }
  const start = partner ? `搭子已于 ${time(partner.at)}${rules.distanceMeters > 0 ? `在${partner.place}` : ''}打卡。` : '搭子今天还没打卡。';
  return { tone: 'plain', text: `${start}今天只看每人的首次打卡。${together}` };
}
