import { beijingDay, shortDate, type ActivityConfig } from '../../../shared/activity';
import type { BuddyStatus, DayCheckinIssue } from '../../../shared/types';

const ISSUE_TEXT: Record<DayCheckinIssue, string> = {
  deleted: '已删除',
  taken_down: '已被撤下',
  invalid: '已被判无效',
  caption: '说明字数不够',
  location: '定位未达到精度要求',
};

type Hint = {
  text: string;
  details?: string;
  tone: 'plain' | 'warn' | 'good';
  canRetake?: boolean;
  canAddScoringCaption?: boolean;
};
type Rules = Pick<ActivityConfig, 'windowMinutes' | 'distanceMeters'>;
const time = (iso: string) => new Date(Date.parse(iso) + 8 * 3_600_000).toISOString().slice(11, 16);

/** 本人尚未有可供组合核对的记录时，拍照前需检查字数与定位。 */
export function canTakeScoringCheckin(status: BuddyStatus | null | undefined): boolean {
  if (!status?.pair?.started || !status.today || status.season.status !== 'running') return false;
  const { mine, checkinPolicy } = status.today;
  return !mine || (checkinPolicy === 'first_eligible' && !mine.counts);
}

/** 今天、我的搭子和拍照页共用同一条当日判定。 */
export function buddyDayStatus(status: BuddyStatus, rules: Rules, now: number, view: 'detail' | 'camera' = 'detail'): Hint | null {
  const { pair, today, week, season } = status;
  if (!pair || !today) return null;
  if (season.status === 'ended') return { tone: 'plain', text: '本赛季已经结束。' };
  if (!pair.started || season.status !== 'running') return { tone: 'plain', text: `你们从${shortDate(pair.startsOn)}开始计分。` };

  const { mine, partner, pairOutcome } = today;
  const replaceable = today.checkinPolicy === 'first_eligible';
  const nearby = rules.distanceMeters > 0 ? `、相距不超过 ${rules.distanceMeters} 米` : '';
  const together = `两人须在同一天打卡，相差不超过 ${rules.windowMinutes} 分钟${nearby}。`;
  const selection = replaceable ? '每人按今天最早保留的合格打卡计分。' : '每人按今天的首次打卡计分。';
  const wording = (camera: string, detail: string, includeRules = false) => view === 'camera'
    ? { text: camera, details: `${detail}${selection}${together}` }
    : { text: includeRules ? `${detail}${together}` : detail };
  const windowMs = rules.windowMinutes * 60_000;
  const kind = replaceable ? '打卡' : '首次打卡';
  const first = mine ? `你 ${time(mine.at)} 的${mine.isReplacement ? '补拍' : kind}` : '';
  const reasons: string[] = [];
  if (mine && !mine.counts) reasons.push(`${first}${mine.issue ? ISSUE_TEXT[mine.issue] : '未达到个人要求'}`);
  if (partner && !partner.counts) {
    reasons.push(partner.issue === 'deleted' ? `搭子 ${time(partner.at)} 的${kind}已删除` : `搭子的${kind}${reasons.length ? '也' : ''}未达标`);
  }
  const reason = reasons.join('，');
  if (reason && !replaceable) {
    const qualified = mine?.counts ? `${first}符合个人要求。` : '';
    const who = mine && !mine.counts ? (partner && !partner.counts ? '双方' : '你的') : '搭子';
    return { tone: 'warn', ...wording(`${who}首卡未达标`, `${qualified}${reason}，今天未计入同时打卡。`) };
  }
  if (pairOutcome === 'matched' || (pairOutcome === undefined && week?.events.some((event) => event.date === today.date))) {
    return { tone: 'good', ...wording('今日同时打卡已完成', '你们今天已完成 1 次同时打卡。') };
  }
  if (mine?.counts && partner?.counts) {
    const both = `两人的${replaceable ? '计分打卡' : '首次打卡'}都符合个人要求`;
    const late = pairOutcome === 'too_late' || (pairOutcome === undefined && Math.abs(Date.parse(mine.at) - Date.parse(partner.at)) > windowMs);
    if (late) return { tone: 'warn', ...wording(`相差超过 ${rules.windowMinutes} 分钟，未计分`, `${both}，但相差超过 ${rules.windowMinutes} 分钟，今天未计入同时打卡。`) };
    if (pairOutcome === 'too_far') {
      const limit = rules.distanceMeters > 0 ? `超过 ${rules.distanceMeters} 米` : '过远';
      return { tone: 'warn', ...wording(`相距${limit}，未计分`, `${both}，但相距${limit}，今天未计入同时打卡。`) };
    }
    const record = week ? '今天未列入本周同时打卡记录。' : '今天的同时打卡记录尚未确认。';
    return { tone: 'plain', ...wording(week ? '今日暂无同时打卡记录' : '同时打卡待确认', `${both}。${record}`) };
  }

  const prior = reason ? `${reason}。` : '';
  if (mine?.counts) {
    if (now - Date.parse(mine.at) > windowMs) {
      return { tone: 'warn', ...wording('等搭子打卡已超时', `${first}符合个人要求。${prior}搭子未在 ${rules.windowMinutes} 分钟内打卡，今天未计入同时打卡。`) };
    }
    if (reason) return { tone: 'warn', ...wording('等搭子补拍', `${first}符合个人要求。${prior}搭子还可以补拍。`, true) };
    return { tone: 'plain', ...wording('你已打卡，等搭子打卡', `${first}符合个人要求，正在等搭子打卡。`, true) };
  }
  const scoringCaption = view === 'camera' ? { canAddScoringCaption: true } : {};
  if (partner?.counts) {
    if (now - Date.parse(partner.at) > windowMs) {
      return { tone: 'warn', ...wording(`距搭子打卡已超过 ${rules.windowMinutes} 分钟`, `${prior}搭子已在 ${time(partner.at)} 打卡，已超过 ${rules.windowMinutes} 分钟，今天未计入同时打卡。`) };
    }
    const place = rules.distanceMeters > 0 && partner.place ? `在${partner.place}` : '';
    const partnerTime = time(partner.at);
    return {
      tone: reason ? 'warn' : 'plain', canRetake: !!mine,
      ...scoringCaption,
      ...wording(`搭子 ${partnerTime} 已打卡${mine ? '，可补拍' : ''}`, `${prior}搭子已于 ${partnerTime}${place}打卡，${reason ? '你还可以补拍' : '正在等你打卡'}。`, true),
    };
  }
  if (reason) {
    const next = mine && partner ? '你们都可以补拍。' : mine ? '你可以补拍，搭子也还需要打卡。' : '搭子可以补拍，你也还需要打卡。';
    const retry = mine && partner ? '双方都可补拍' : mine ? '你上次未达标，可补拍' : '搭子可补拍，你还未打卡';
    return { tone: 'warn', canRetake: !!mine, ...scoringCaption, ...wording(retry, `${prior}今天还没有合格打卡。${next}`) };
  }
  return { tone: 'plain', ...scoringCaption, ...wording('两人今天均未打卡', '你和搭子今天都还没有打卡。') };
}

/** 相机和回执另外说明本次拍摄是否只是社区记录。 */
export function buddyCheckinHint(status: BuddyStatus, rules: Rules, now: number, receiptAt?: string, receiptId?: number): Hint | null {
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
  const hint = buddyDayStatus(status, rules, now, receiptAt ? 'detail' : 'camera');
  if (!hint || !pair.started || season.status !== 'running') return hint;
  if (!today.mine && receiptAt) return { tone: 'plain', text: '正在核对这次打卡的搭子活动记录。' };
  const { mine, checkinPolicy } = today;
  const selected = checkinPolicy === 'first_eligible' ? mine?.counts : !!mine;
  if (mine && selected) {
    const sameCheckin = receiptId !== undefined && mine.checkinId !== undefined
      ? receiptId === mine.checkinId : receiptAt !== undefined && Date.parse(receiptAt) === Date.parse(mine.at);
    if (!sameCheckin) return { ...hint, text: receiptAt ? `${hint.text}本次只记录社区打卡。` : `${hint.text} · 本次仅社区打卡` };
    if (mine.isReplacement) return { ...hint, text: `这张补拍已选为你今天的计分打卡。${hint.text}` };
  }
  return hint;
}
