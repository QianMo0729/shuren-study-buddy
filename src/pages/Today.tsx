import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Camera, ChevronRight, Clock, Search } from 'lucide-react';
import { DAYS, GRADES, PERIODS, overlapSlots, slotDay, slotPeriod } from '../../shared/options';
import { shortDate } from '../../shared/activity';
import type { BuddyStatus, CheckinStats, DeckResponse } from '../../shared/types';
import { api, ApiError } from '../lib/api';
import { cx } from '../lib/format';
import { Plate } from '../components/brand';
import { MeAvatar } from '../components/Shell';
import { Nickname } from '../components/ProfileCard';
import { Button, PageHeader, Skeleton } from '../components/ui';
import { InstallCard } from '../components/InstallCard';

/** 北京时间的今天：星期几（周一为 0）与「10月21日 星期三」 */
function beijingNow() {
  const d = new Date(Date.now() + 8 * 3_600_000);
  const day = (d.getUTCDay() + 6) % 7;
  return { day, label: `${d.getUTCMonth() + 1}月${d.getUTCDate()}日 ${DAYS[day].replace('周', '星期')}` };
}

const gradeLabel = (v: string) => GRADES.find((g) => g.value === v)?.label ?? '';
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
const errorText = (e: unknown) => (e instanceof ApiError ? e.message : '网络连接失败，请稍后重试');

/**
 * 今天：每天打开先看到的一页。我的搭子本周进度、今天两人都有空的时段、拍照打卡，以及今日推荐。
 * 最常用的操作（打卡、约搭子、看推荐）都在这一页一次点击完成。
 */
export function Today() {
  const today = beijingNow();
  const [status, setStatus] = useState<BuddyStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<CheckinStats | null>(null);
  const [deck, setDeck] = useState<DeckResponse | null>(null);
  const [freeToday, setFreeToday] = useState<number[] | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let live = true;
    setError(null);
    api.activity.me().then((s) => { if (live) setStatus(s); }).catch((e) => { if (live) setError(errorText(e)); });
    api.checkins.stats().then((s) => { if (live) setStats(s); }).catch(() => {});
    api.match.deck(5).then((d) => { if (live) setDeck(d); }).catch(() => {});
    return () => { live = false; };
  }, [version]);

  // 今天两人都填了「有空」的时段（来自双方问卷里的学习时间表）
  const partnerId = status?.pair?.partner.id;
  useEffect(() => {
    if (!partnerId) return;
    let live = true;
    Promise.all([api.myProfile(), api.profile(partnerId)])
      .then(([mine, theirs]) => {
        if (!live) return;
        setFreeToday(overlapSlots(mine.profile.schedule, theirs.profile.schedule).filter((s) => slotDay(s) === today.day).map(slotPeriod));
      })
      .catch(() => { if (live) setFreeToday([]); });
    return () => { live = false; };
  }, [partnerId, today.day]);

  const incoming = status?.invites.filter((i) => i.direction === 'incoming').length ?? 0;
  const picks = deck?.state === 'ready' ? deck.items.slice(0, 4) : [];

  return (
    <div>
      <PageHeader eyebrow={today.label} title="今天" />

      <InstallCard />

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <section aria-label="我的搭子" className="rounded-[22px] bg-surface p-5 shadow-sm sm:p-6">
          {error && !status ? (
            <div className="text-[14px] text-ink-2">
              搭子信息加载失败：{error}
              <Button size="sm" className="ml-2" onClick={() => setVersion((v) => v + 1)}>重试</Button>
            </div>
          ) : !status ? (
            <Skeleton className="h-44 rounded-2xl" />
          ) : status.pair ? (
            <BuddyCard status={status} freeToday={freeToday} />
          ) : (
            <div>
              <h2 className="text-[19px] font-bold text-ink">还没有学习搭子</h2>
              <p className="mt-1.5 text-[14.5px] leading-relaxed text-ink-2">
                在私聊或对方主页上点「邀请成为搭子」。绑定后，两人打卡同一件事就能一起计分、上搭子榜。
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Link to="/match" className="inline-flex h-10 items-center rounded-full bg-brand-soft px-4 text-[14.5px] font-semibold text-brand-text hover:bg-brand-soft/70">去找搭子</Link>
                <Link to="/match/search" className="inline-flex h-10 items-center gap-1.5 rounded-full bg-paper-2 px-4 text-[14.5px] font-semibold text-ink hover:bg-paper-2/70">
                  <Search size={15} aria-hidden />按 ID 找同学
                </Link>
              </div>
            </div>
          )}

          {incoming > 0 && (
            <Link to="/me" className="mt-4 flex h-12 items-center gap-3 rounded-[14px] bg-brand-softer px-4 text-[15px] text-ink hover:bg-brand-soft">
              <span className="flex-1">有 <b className="text-brand-text tabular">{incoming}</b> 位同学邀请你成为搭子</span>
              <ChevronRight size={18} className="text-ink-3" aria-hidden />
            </Link>
          )}

          <Link
            to="/community/checkin/new"
            className="mt-5 flex h-[52px] items-center justify-center gap-2 rounded-[14px] bg-brand text-[17px] font-semibold text-white hover:bg-brand-2 active:scale-[0.99] motion-safe:transition-transform"
          >
            <Camera size={20} strokeWidth={2} aria-hidden />
            拍照打卡
          </Link>
          {stats && (stats.checkedInToday || stats.streak > 0) && (
            <p className="mt-2 text-center text-[13px] text-ink-3">
              {stats.checkedInToday ? '今天已经打过卡' : '今天还没打卡'}{stats.streak > 0 && <> · 已连续 <b className="font-semibold text-ink tabular">{stats.streak}</b> 天</>}
            </p>
          )}
        </section>

        <section aria-labelledby="picks-title" className="min-w-0">
          <div className="mb-3 flex items-baseline justify-between px-1">
            <h2 id="picks-title" className="text-[21px] font-bold text-ink">今日推荐</h2>
            <Link to="/match" className="text-[15px] text-brand-text hover:underline">全部</Link>
          </div>
          {!deck ? (
            <div className="grid grid-cols-2 gap-3">{[0, 1].map((i) => <Skeleton key={i} className="h-48 rounded-[18px]" />)}</div>
          ) : picks.length ? (
            <div className="grid grid-cols-2 gap-3">
              {picks.map((card) => (
                <Link key={card.id} to={`/match/u/${card.id}`} className="group min-w-0 overflow-hidden rounded-[18px] bg-surface shadow-sm">
                  <Plate nickname={card.nickname} photo={card.cover} className="aspect-[4/3] w-full" fit="cover" pad="0" />
                  <div className="px-3 pt-2.5 pb-3">
                    <Nickname name={card.nickname} size={15} className="max-w-full font-sans! font-semibold" />
                    <p className="mt-0.5 truncate text-[12.5px] text-ink-3">
                      {[card.major, gradeLabel(card.grade), card.recommendation.reasons[0]].filter(Boolean).join(' · ')}
                    </p>
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <Link to="/match" className="flex items-center gap-3 rounded-[18px] bg-surface p-4 text-[14.5px] text-ink-2 hover:bg-surface-2">
              <span className="flex-1">{PICKS_EMPTY[deck.state]}</span>
              <ChevronRight size={18} className="text-ink-3" aria-hidden />
            </Link>
          )}
        </section>
      </div>
    </div>
  );
}

function BuddyCard({ status, freeToday }: { status: BuddyStatus; freeToday: number[] | null }) {
  const pair = status.pair!;
  const { week, rank, season } = status;
  const ended = season.status === 'ended';

  return (
    <div>
      <Link to={`/u/${pair.partner.id}`} className="-m-1.5 flex items-center gap-3 rounded-2xl p-1.5 hover:bg-paper-2/60">
        <span className="flex shrink-0">
          <MeAvatar className="size-12 ring-2 ring-surface" />
          <Plate nickname={pair.partner.nickname} photo={pair.partner.cover} className="-ml-3 size-12 overflow-hidden rounded-full bg-mat ring-2 ring-surface" pad="8%" />
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="text-[13px] text-ink-3">我的搭子</span>
          <Nickname name={pair.partner.nickname} size={19} className="font-sans! font-semibold" />
        </span>
        <ChevronRight size={20} className="shrink-0 text-ink-4" aria-hidden />
      </Link>

      <div className="mt-5">
        {ended ? (
          <p className="text-[14.5px] text-ink-2">本赛季已经结束。</p>
        ) : !pair.started ? (
          <p className="text-[14.5px] text-ink-2">从 {shortDate(pair.startsOn)}（周一）开始计分。</p>
        ) : week ? (
          <>
            <div className="flex items-baseline justify-between gap-3">
              <p className="text-[15px] font-semibold text-ink">本周一起打卡 <span className="text-brand-text tabular">{week.count}</span> / {week.cap} 次</p>
              {rank ? (
                <Link to="/community?tab=board" className="shrink-0 text-[13px] text-ink-3 hover:text-ink">搭子榜第 <b className="text-ink tabular">{rank.rank}</b> 名{rank.tied ? '（并列）' : ''}</Link>
              ) : (
                <span className="shrink-0 text-[13px] text-ink-3">完成一周后显示名次</span>
              )}
            </div>
            <div className="mt-2.5 flex gap-1.5" role="img" aria-label={`本周 ${week.count} / ${week.cap} 次`}>
              {Array.from({ length: week.cap }).map((_, i) => (
                <span key={i} className={cx('h-1.5 flex-1 rounded-full', i < week.count ? 'bg-brand' : 'bg-paper-2')} />
              ))}
            </div>
          </>
        ) : null}
        {pair.ineligible && <p className="mt-2 text-[13px] text-danger">{pair.ineligible}</p>}
      </div>

      {freeToday && freeToday.length > 0 && (
        <div className="mt-4 flex items-center gap-2.5 rounded-[14px] bg-accent-soft px-3.5 py-3">
          <Clock size={18} className="shrink-0 text-accent-text" aria-hidden />
          <p className="min-w-0 flex-1 text-[14.5px] text-ink">
            <b className="font-semibold text-accent-text tabular">{freeToday.map((p) => PERIODS[p].time).join('、')}</b> 你们都有空
          </p>
          {pair.matchId && <Link to={`/messages/${pair.matchId}`} className="shrink-0 text-[14.5px] font-semibold text-accent-text">约一下</Link>}
        </div>
      )}
      {freeToday && freeToday.length === 0 && pair.matchId && (
        <Link to={`/messages/${pair.matchId}`} className="mt-4 flex h-11 items-center gap-2 rounded-[14px] bg-paper-2/70 px-3.5 text-[14.5px] text-ink hover:bg-paper-2">
          <span className="flex-1">今天空闲时间没有重合，约别的时间</span>
          <ChevronRight size={18} className="text-ink-3" aria-hidden />
        </Link>
      )}
    </div>
  );
}
