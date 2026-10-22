import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { DAYS, GRADES, PERIODS, overlapSlots, slotDay, slotPeriod } from '../../shared/options';
import { shortDate } from '../../shared/activity';
import type { BuddyStatus, Checkin, DeckCard, DeckResponse } from '../../shared/types';
import { api, ApiError } from '../lib/api';
import { cx } from '../lib/format';
import { Plate } from '../components/brand';
import { MeAvatar } from '../components/Shell';
import { Button, PageHeader, Skeleton } from '../components/ui';
import { CameraIcon, Chevron, ClockIcon } from '../components/icons';
import { InstallSheet } from '../components/InstallSheet';

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
  const [status, setStatus] = useState<BuddyStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deck, setDeck] = useState<DeckResponse | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let live = true;
    setError(null);
    api.activity.me().then((s) => { if (live) setStatus(s); }).catch((e) => { if (live) setError(errorText(e)); });
    api.match.deck(5).then((d) => { if (live) setDeck(d); }).catch(() => {});
    return () => { live = false; };
  }, [version]);

  const picks = deck?.state === 'ready' ? deck.items.slice(0, 2) : [];

  return (
    <div className="mx-auto max-w-[720px]">
      <PageHeader eyebrow={today.label} title="今天" />

      <div className="flex flex-col gap-[22px]">
        <section aria-label="我的搭子" className="flex flex-col gap-4 rounded-[22px] bg-surface px-[18px] pt-[18px] pb-4 shadow-[0_1px_2px_rgba(28,35,32,0.04)]">
          {error && !status ? (
            <p className="text-[15px] text-ink-2">
              搭子信息加载失败：{error}
              <Button size="sm" className="ml-2" onClick={() => setVersion((v) => v + 1)}>重试</Button>
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
          {!deck ? (
            <div className="flex gap-3">{[0, 1].map((i) => <Skeleton key={i} className="h-[166px] flex-1 rounded-[18px]" />)}</div>
          ) : picks.length ? (
            <div className="flex gap-3">{picks.map((card) => <PickCard key={card.id} card={card} />)}</div>
          ) : (
            <Link to="/match" className="flex items-center gap-3 rounded-[18px] bg-surface px-4 py-3.5 text-[15px] text-ink-2">
              <span className="flex-1">{PICKS_EMPTY[deck.state]}</span>
              <Chevron />
            </Link>
          )}
        </section>
      </div>

      <InstallSheet />
    </div>
  );
}

function PickCard({ card }: { card: DeckCard }) {
  const slots = card.recommendation.commonSlots.length;
  const sub = [card.major, gradeLabel(card.grade), slots ? `${slots} 段共同空闲` : card.recommendation.reasons[0]].filter(Boolean).join(' · ');
  return (
    <Link to={`/match/u/${card.id}`} className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-[18px] bg-surface text-ink">
      <Plate nickname={card.nickname} photo={card.cover} className="h-28 w-full" fit="cover" pad="0" />
      <span className="flex flex-col gap-0.5 px-3 pt-2.5 pb-3">
        <span className="truncate text-[15px] font-semibold">{card.nickname}</span>
        <span className="truncate text-[12px] text-ink-3">{sub}</span>
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
      <p className="text-[14px] leading-relaxed text-ink-3">在私聊或对方主页上点「邀请成为搭子」。绑定后，两人打卡同一件事就能一起计分、上搭子榜。</p>
    </div>
  );
}

function BuddyBlock({ status, today }: { status: BuddyStatus; today: ReturnType<typeof beijingNow> }) {
  const pair = status.pair!;
  const { week, rank } = status;
  const [freeToday, setFreeToday] = useState<number[]>([]);
  const [both, setBoth] = useState<Set<number>>(new Set());
  const weekNo = pair.started ? Math.floor((Date.parse(today.date) - Date.parse(pair.startsOn)) / (7 * DAY)) + 1 : 0;

  // 今天两人都有空的时段（来自双方问卷里的学习时间表）
  useEffect(() => {
    let live = true;
    Promise.all([api.myProfile(), api.profile(pair.partner.id)])
      .then(([mine, theirs]) => {
        if (live) setFreeToday(overlapSlots(mine.profile.schedule, theirs.profile.schedule).filter((s) => slotDay(s) === today.day).map(slotPeriod));
      })
      .catch(() => {});
    return () => { live = false; };
  }, [pair.partner.id, today.day]);

  // 本周哪几天两人都打了卡：用双方最近的打卡记录按北京时间日期对齐
  useEffect(() => {
    if (!week) return;
    let live = true;
    const days = (items: Checkin[]) => new Set(items.map((c) => bjDate(Date.parse(c.stampedAt))).filter((d) => d >= week.start && d <= week.end));
    Promise.all([api.checkins.list({ scope: 'mine' }), api.checkins.list({ scope: 'buddies' })])
      .then(([mine, buddies]) => {
        if (!live) return;
        const a = days(mine.items);
        const b = days(buddies.items.filter((c) => c.author.id === pair.partner.id));
        const out = new Set<number>();
        for (let i = 0; i < 7; i++) {
          const d = bjDate(Date.parse(week.start) + i * DAY);
          if (a.has(d) && b.has(d)) out.add(i);
        }
        setBoth(out);
      })
      .catch(() => {});
    return () => { live = false; };
  }, [week, pair.partner.id]);

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
          <div className="flex items-baseline justify-between">
            <p className="text-[15px] font-semibold text-ink">本周同时打卡 <span className="text-brand-text tabular">{week.count}</span> 次</p>
            {rank && <Link to="/community?tab=board" className="text-[13px] text-ink-3">搭子榜第 {rank.rank} 名</Link>}
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

      {freeToday.length > 0 && (
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
