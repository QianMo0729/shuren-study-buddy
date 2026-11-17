import { useActivityConfig } from '../lib/activity';
import { useCached } from '../lib/cache';
import { splitNickname } from '../components/ProfileCard';
import { Link } from 'react-router';
import { DAYS, GRADES, PERIODS } from '../../shared/options';
import { shortDate } from '../../shared/activity';
import type { BuddyStatus, DeckCard, DeckResponse } from '../../shared/types';
import { api, ApiError } from '../lib/api';
import { cx } from '../lib/format';
import { Plate } from '../components/brand';
import { MeAvatar } from '../components/Shell';
import { Button, PageHeader, Skeleton } from '../components/ui';
import { CameraIcon, Chevron, ClockIcon } from '../components/icons';
import { InstallSheet } from '../components/InstallSheet';
import { BenefitBanner } from '../components/BenefitBanner';

const DAY = 86_400_000;
/** 北京时间的日期字符串 YYYY-MM-DD */
const bjDate = (t: number) => new Date(t + 8 * 3_600_000).toISOString().slice(0, 10);
const WEEK_LABELS = ['一', '二', '三', '四', '五', '六', '日'];

function beijingNow() {
  const d = new Date(Date.now() + 8 * 3_600_000);
  const day = (d.getUTCDay() + 6) % 7;
  return { day, date: bjDate(Date.now()), label: `${d.getUTCMonth() + 1}月${d.getUTCDate()}日 ${DAYS[day].replace('周', '星期')}` };
}

const gradeLabel = (v: string) => GRADES.find((g) => g.value === v)?.label ?? '';
const errorText = (e: unknown) => (e instanceof ApiError ? e.message : '网络连接失败，请稍后重试');
/** 「14–16」→「14:00–16:00」 */
const slotTime = (period: number) => PERIODS[period].time.split('–').map((h) => `${h}:00`).join('–');

/** 今日推荐没有可显示的同学时，按推荐状态说明原因 */
const PICKS_EMPTY: Record<DeckResponse['state'], string> = {
  ready: '今天的推荐都处理完了，明天零点更新。',
  daily_done: '今天的推荐都看过了，明天零点更新。',
  incomplete: '问卷还差几项，填完就能收到每日推荐。',
  unpublished: '上传你的主页后，就能收到每日推荐。',
  unavailable: '你的主页暂不参与推荐，去「我的」看看状态。',
  no_overlap: '暂时没有空闲时间和你重合的同学。',
  empty: '暂时没有可以推荐的同学。',
};

/**
 * 今天：每天打开先看到的一页。我的搭子本周进度、今天两人都有空的时段、拍照打卡、今日推荐。
 */
export function Today() {
  const today = beijingNow();
  // 先显示上次的内容，后台再刷新：切回「今天」时不用再等
  const buddy = useCached<BuddyStatus>('activity:me', () => api.activity.me());
  const deckQuery = useCached<DeckResponse>('match:deck:5', () => api.match.deck(5));
  const status = buddy.data ?? null;
  const error = buddy.error ? errorText(buddy.error) : null;
  const deck = deckQuery.data ?? null;
  const reload = () => { buddy.reload(); deckQuery.reload(); };

  const picks = deck?.state === 'ready' ? deck.items.slice(0, 2) : [];

  return (
    <div className="mx-auto max-w-[720px]">
      <PageHeader eyebrow={today.label} title="今天" />

      <div className="flex flex-col gap-[22px]">
        <section aria-label="我的搭子" className="flex flex-col gap-4 rounded-[22px] bg-surface px-[18px] pt-[18px] pb-4 shadow-[0_1px_2px_rgba(28,35,32,0.04)]">
          {error && !status ? (
            <p className="text-[15px] text-ink-2">
              搭子信息加载失败：{error}
              <Button size="sm" className="ml-2" onClick={reload}>重试</Button>
            </p>
          ) : !status ? (
            <Skeleton className="h-40 rounded-2xl" />
          ) : status.pair ? (
            <BuddyBlock status={status} today={today} />
          ) : (
            <NoBuddy invites={status.invites.filter((i) => i.direction === 'incoming').length} />
          )}

          <Link to="/community/checkin/new" className="flex h-[50px] items-center justify-center gap-2 rounded-[14px] bg-brand text-[17px] font-semibold text-white hover:bg-brand-2 active:opacity-90">
            <CameraIcon size={20} />
            拍照打卡
          </Link>
        </section>

        <section aria-labelledby="picks-title" className="flex flex-col gap-2.5">
          <div className="flex items-baseline justify-between px-1">
            <h2 id="picks-title" className="text-[22px] font-bold text-ink">今日推荐</h2>
            <Link to="/match" className="text-[15px] text-brand-text">全部</Link>
          </div>
          {!deck && deckQuery.error ? (
            <button type="button" onClick={deckQuery.reload} className="flex items-center gap-3 rounded-[18px] bg-surface px-4 py-3.5 text-left text-[15px] text-ink-2">
              <span className="flex-1">推荐没有加载出来，点一下重试</span>
            </button>
          ) : !deck ? (
            <div className="flex gap-3">{[0, 1].map((i) => <Skeleton key={i} className="h-[202px] flex-1 rounded-[18px]" />)}</div>
          ) : picks.length ? (
            <div className="flex gap-3">{picks.map((card) => <PickCard key={card.id} card={card} />)}</div>
          ) : (
            <Link to="/match" className="flex items-center gap-3 rounded-[18px] bg-surface px-4 py-3.5 text-[15px] text-ink-2">
              <span className="flex-1">{PICKS_EMPTY[deck.state]}</span>
              <Chevron />
            </Link>
          )}
        </section>

        <BenefitBanner />
      </div>

      <InstallSheet />
    </div>
  );
}

function PickCard({ card }: { card: DeckCard }) {
  const slots = card.recommendation.commonSlots.length;
  const sub = [card.major, gradeLabel(card.grade)].filter(Boolean).join(' · ');
  // 共同空闲单独一行：卡片窄，和专业挤在一行时会被截掉
  const reason = slots ? `每周 ${slots} 段共同空闲` : card.recommendation.reasons[0];
  return (
    <Link to={`/match/u/${card.id}`} className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-[18px] bg-surface text-ink">
      <Plate nickname={card.nickname} photo={card.cover} className="h-28 w-full" fit="cover" pad="0" />
      <span className="flex flex-col gap-0.5 px-3 pt-2.5 pb-3">
        <span className="truncate text-[15px] font-semibold">{card.nickname}</span>
        <span className="truncate text-[12px] text-ink-3">{sub}</span>
        {reason && <span className="truncate text-[12px] text-brand-text">{reason}</span>}
      </span>
    </Link>
  );
}

function NoBuddy({ invites }: { invites: number }) {
  return (
    <div className="flex flex-col gap-3">
      <Link to="/buddy" className="flex items-center gap-3 text-ink">
        <MeAvatar className="size-11 shrink-0" />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-[13px] text-ink-3">我的搭子</span>
          <span className="text-[17px] font-semibold">{invites ? `${invites} 位同学邀请你成为搭子` : '还没有学习搭子'}</span>
        </span>
        <Chevron />
      </Link>
      <p className="text-[14px] leading-relaxed text-ink-3">在私聊或对方主页上点「邀请成为搭子」。绑定后，两人约好时间各自拍照打卡，就能一起累计积分、参与排名。</p>
    </div>
  );
}

function BuddyBlock({ status, today }: { status: BuddyStatus; today: ReturnType<typeof beijingNow> }) {
  const pair = status.pair!;
  const { week, rank, score } = status;
  const { config } = useActivityConfig();
  const weekNo = pair.started ? Math.floor((Date.parse(today.date) - Date.parse(pair.startsOn)) / (7 * DAY)) + 1 : 0;
  // 本周哪几天算了一次相同事件（服务器按计分规则判定，和积分一致）
  const both = new Set((week?.events ?? []).map((e) => (new Date(`${e.date}T00:00:00Z`).getUTCDay() + 6) % 7));
  const freeToday = status.today?.free ?? [];
  const partnerToday = status.today?.partner;
  const minutesAgo = partnerToday ? Math.floor((Date.now() - Date.parse(partnerToday.at)) / 60_000) : null;
  // 搭子刚打过卡（而且那次能计分）、我今天还没打卡：提醒现在去拍
  const nudge = pair.started && status.season.status === 'running' && !status.today?.mine && !!partnerToday?.counts
    && minutesAgo !== null && minutesAgo <= config.windowMinutes;

  return (
    <>
      <Link to="/buddy" className="flex items-center gap-3 text-ink">
        <span className="flex shrink-0">
          <MeAvatar className="size-11 border-2 border-surface" />
          <Plate nickname={pair.partner.nickname} photo={pair.partner.cover} className="-ml-3 size-11 overflow-hidden rounded-full border-2 border-surface bg-mat" pad="0" fit="cover" />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-[13px] text-ink-3">我的搭子{weekNo > 0 ? ` · 第 ${weekNo} 周` : ''}</span>
          <span className="truncate text-[17px] font-semibold">{pair.partner.nickname}</span>
        </span>
        <Chevron />
      </Link>

      {week ? (
        <div className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-[15px] font-semibold text-ink">本周同时打卡 <span className="text-brand-text tabular">{week.count}</span> 次</p>
            <Link to="/buddy" className="shrink-0 text-[13px] text-ink-3 tabular">
              {[score && score.through ? `累计 ${score.total} 分` : '', rank ? `第 ${rank.rank} 名` : ''].filter(Boolean).join(' · ') || '周一结算'}
            </Link>
          </div>
          <div className="grid grid-cols-7 gap-1.5">
            {WEEK_LABELS.map((label, i) => (
              <div key={label} className="flex flex-col items-center gap-[5px]">
                <span className={cx('h-1.5 w-full rounded-[3px]', both.has(i) ? 'bg-brand' : 'bg-paper-2')} />
                <span className={cx('text-[11px]', i === today.day ? 'font-bold text-ink' : 'text-ink-3')}>{label}</span>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <p className="text-[15px] text-ink-2">{status.season.status === 'ended' ? '本赛季已经结束。' : `从 ${shortDate(pair.startsOn)}（周一）开始计分。`}</p>
      )}
      {pair.ineligible && <p className="-mt-2 text-[13px] text-danger">{pair.ineligible}</p>}

      {nudge ? (
        <Link to="/community/checkin/new" className="flex items-center gap-2.5 rounded-[14px] bg-brand-soft px-3.5 py-3 text-[14px] text-ink">
          <CameraIcon size={18} className="shrink-0 text-brand-text" />
          <span className="min-w-0 flex-1">
            {splitNickname(pair.partner.nickname).word} {minutesAgo! < 1 ? '刚刚' : `${minutesAgo} 分钟前`}
            {config.distanceMeters > 0 ? `在${partnerToday!.place}打卡了，${config.distanceMeters} 米以内拍就能算一次` : '打卡了，现在拍就能算一次'}
          </span>
          <Chevron />
        </Link>
      ) : freeToday.length > 0 && (
        <div className="flex items-center gap-2.5 rounded-[14px] bg-accent-soft px-3.5 py-3">
          <ClockIcon size={18} width={2} className="shrink-0 text-accent" />
          <p className="min-w-0 flex-1 text-[14px] text-ink">
            <span className="font-semibold text-accent tabular">{slotTime(freeToday[0])}</span> 你们都有空
          </p>
          {pair.matchId && <Link to={`/messages/${pair.matchId}`} className="shrink-0 text-[14px] font-semibold text-accent">约一下</Link>}
        </div>
      )}
    </>
  );
}
