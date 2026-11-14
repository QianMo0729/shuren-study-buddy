import { AnimatePresence, motion } from 'motion/react';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation, useMatch, useNavigate } from 'react-router';
import type { DeckCard, FeedbackItem, PublicProfile } from '../../shared/types';
import { GRADES, STUDY_TYPES } from '../../shared/options';
import { speciesOfNickname } from '../../shared/species';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useToast } from '../lib/toast';
import { Button, CircleButton, Empty, GroupList, PageHeader, SegmentBar, Skeleton } from '../components/ui';
import { Plate } from '../components/brand';
import { ProfileOverlay } from '../components/ProfileOverlay';
import { MatchCelebration } from '../components/match/MatchCelebration';
import { MatchEmpty } from '../components/match/MatchEmpty';
import { useDeckQueue } from '../components/match/useDeckQueue';
import { Illustration } from '../components/brand';
import { BookIcon, BookmarkIcon, ClockIcon, HeartFill, PinIcon, SearchIcon, SlidersIcon, XIcon } from '../components/icons';

const errorText = (cause: unknown) => (cause instanceof ApiError ? cause.message : '网络连接失败，请稍后重试');
const gradeLabel = (v: string) => GRADES.find((g) => g.value === v)?.label ?? '';

/** 稍后再看的人数（分段控件上显示） */
function useLaterCount() {
  const [n, setN] = useState<number | null>(null);
  useEffect(() => {
    let live = true;
    api.match.feedbackList('skip').then((r) => { if (live) setN(r.items.length); }).catch(() => {});
    return () => { live = false; };
  }, []);
  return n;
}

function Header({ active, today, later }: { active: 'today' | 'later'; today: number | null; later: number | null }) {
  return (
    <>
      <PageHeader
        title="找搭子"
        className="mb-3.5!"
        actions={<>
          <CircleButton label="按 ID 或条件找同学" to="/match/search"><SearchIcon size={18} width={2.2} /></CircleButton>
          <CircleButton label="推荐偏好" to="/me/preferences"><SlidersIcon size={18} width={2.2} /></CircleButton>
        </>}
      />
      <SegmentBar
        label="推荐范围"
        value={active}
        items={[
          { value: 'today', to: '/match', label: `今日推荐${today !== null ? ` · ${today}` : ''}` },
          { value: 'later', to: '/match/later', label: `稍后再看${later !== null ? ` · ${later}` : ''}` },
        ]}
      />
    </>
  );
}

export function Match() {
  const { user } = useAuth();
  // 未提交问卷时留在匹配页；推荐组件尚未挂载，不会请求卡组、列表或个人主页。
  return user?.questionnaireComplete ? <MatchResults /> : <QuestionnaireRequired />;
}

function QuestionnaireRequired() {
  return (
    <div className="mx-auto max-w-[560px]">
      <PageHeader title="找搭子" />
      <section className="flex flex-col items-center rounded-[22px] bg-surface px-6 py-8 text-center">
        <img src="/assets/mascot-questionnaire.webp" alt="" width={512} height={512} className="mb-4 size-40 object-contain" />
        <h2 className="text-[20px] font-bold text-ink">先完成问卷，才能看见推荐</h2>
        <p className="mt-2 max-w-sm text-[15px] leading-relaxed text-ink-3">告诉小树仁你的学习时间、目标和偏好，再帮你找合拍的搭子。问卷会自动保存。</p>
        <Link to="/me/edit?onboarding=1" className="mt-5 flex h-[50px] w-full max-w-xs items-center justify-center rounded-[14px] bg-brand text-[17px] font-semibold text-white">去填写问卷</Link>
      </section>
    </div>
  );
}

function MatchResults() {
  const nav = useNavigate();
  const toast = useToast();
  const location = useLocation();
  const openMatch = useMatch('/match/u/:id');
  const openId = openMatch ? Number(openMatch.params.id) : null;
  const later = useLaterCount();
  const [laterDelta, setLaterDelta] = useState(0);
  const [celebration, setCelebration] = useState<{ matchId: number; nickname: string; cover: string | null } | null>(null);
  const changed = useRef<number | null>(null);

  // 刚提交完问卷：这是唯一会把主页公开出去的一步，给一个明确的回执（只显示一次）
  const announced = useRef(false);
  useEffect(() => {
    if (announced.current || !(location.state as { justMatched?: boolean } | null)?.justMatched) return;
    announced.current = true;
    toast.success('问卷已提交，主页已发布', '下面是为你推荐的同学。之后修改问卷，要重新提交才会更新主页。');
    nav({ pathname: location.pathname }, { replace: true, state: null });
  }, [location.state]); // eslint-disable-line react-hooks/exhaustive-deps

  const explained = useRef(false);
  const deck = useDeckQueue({
    limit: 5,
    onMatched: (card, result) => setCelebration({ matchId: result.matchId!, nickname: card.nickname, cover: card.cover }),
    onLiked: (card) => {
      toast.success(`已对 ${card.nickname} 表示感兴趣`, explained.current ? undefined : '对方也感兴趣时，你们就可以私聊；在那之前对方不会知道。');
      explained.current = true;
    },
    onError: (title, desc) => toast.error(title, desc),
  });

  const onOverlayChanged = useCallback(() => { changed.current = openId; }, [openId]);
  const closeOverlay = () => {
    const id = changed.current;
    changed.current = null;
    nav('/match');
    if (id === null) return;
    api.profile(id)
      .then(({ profile }: { profile: PublicProfile }) => { if (profile.matchState !== 'none') deck.remove(id); else void deck.reload(); })
      .catch(() => deck.remove(id));
  };

  const meta = deck.meta;
  const card = deck.queue[0];
  const decide = (action: 'like' | 'dislike' | 'skip') => {
    if (!card) return;
    if (action === 'skip') setLaterDelta((n) => n + 1);
    void deck.decide(card, action);
  };

  return (
    <div className="mx-auto max-w-[560px]">
      <Header active="today" today={meta ? deck.queue.length : null} later={later === null ? null : later + laterDelta} />

      <div className="mt-[18px]">
        {deck.loading ? (
          <Skeleton className="h-[470px] rounded-[26px]" />
        ) : deck.error ? (
          <Empty art={<Illustration name="mascot-empty" className="mb-4 size-24" />} title="推荐暂时没有加载成功" desc={deck.error} action={<Button variant="primary" onClick={() => void deck.reload()}>重新加载</Button>} />
        ) : meta && meta.state !== 'ready' ? (
          <MatchEmpty data={meta} state={meta.state} onReviewDisliked={() => nav('/me/preferences')} />
        ) : card ? (
          <>
            <div className="relative h-[470px]">
              {deck.queue.length > 1 && <div className="absolute inset-x-3.5 top-2.5 -bottom-2.5 rounded-[26px] bg-[#E9E6DD] dark:bg-paper-2" aria-hidden />}
              <AnimatePresence initial={false} mode="popLayout">
                <motion.div
                  key={card.id}
                  initial={{ opacity: 0, scale: 0.96, y: 10 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, x: -40, transition: { duration: 0.18 } }}
                  transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                  className="absolute inset-0"
                >
                  <MatchCard card={card} onOpen={() => nav(`/match/u/${card.id}`)} />
                </motion.div>
              </AnimatePresence>
            </div>
            <div className="mt-[22px] flex items-center justify-center gap-7">
              <button type="button" aria-label="不感兴趣" onClick={() => decide('dislike')} className="grid size-[60px] place-items-center rounded-full bg-surface text-ink-3 shadow-[0_4px_14px_rgba(28,35,32,0.10)] active:scale-95">
                <XIcon size={24} width={2.4} />
              </button>
              <button type="button" aria-label="稍后再看" onClick={() => decide('skip')} className="grid size-[46px] place-items-center rounded-full bg-surface text-ink-3 shadow-[0_4px_14px_rgba(28,35,32,0.10)] active:scale-95">
                <BookmarkIcon size={20} width={2.2} />
              </button>
              <button type="button" aria-label="感兴趣" onClick={() => decide('like')} className="grid size-[60px] place-items-center rounded-full bg-brand text-white shadow-[0_6px_18px_rgba(0,92,101,0.30)] active:scale-95">
                <HeartFill size={26} />
              </button>
            </div>
          </>
        ) : (
          <MatchEmpty data={meta} state="exhausted" onRefresh={() => void deck.reload()} onReviewDisliked={() => nav('/me/preferences')} />
        )}
      </div>

      <AnimatePresence>
        {openId && <ProfileOverlay key={openId} id={openId} recommendation={deck.queue.find((c) => c.id === openId)?.recommendation} onClose={closeOverlay} onChanged={onOverlayChanged} />}
      </AnimatePresence>
      <MatchCelebration match={celebration} onClose={() => setCelebration(null)} />
    </div>
  );
}

/** 推荐卡：上半是图版与学习类型印章，下半是昵称、学名和三条推荐理由 */
function MatchCard({ card, onOpen }: { card: DeckCard; onOpen: () => void }) {
  const type = STUDY_TYPES.find((t) => t.value === card.studyType);
  const latin = speciesOfNickname(card.nickname)?.latin;
  const slots = card.recommendation.commonSlots.length;
  // 第一行已经写了共同空闲，理由里讲时间的就不再重复
  const reasons = slots ? card.recommendation.reasons.filter((r) => !/共同时间|空闲/.test(r)) : card.recommendation.reasons;
  const rows = [
    slots ? { icon: <ClockIcon size={18} width={2} className="shrink-0 text-accent" />, text: <>每周 <b className="font-semibold text-accent">{slots} 段</b>共同空闲</> } : null,
    reasons[0] ? { icon: <BookIcon size={18} width={2} className="shrink-0 text-brand-text" />, text: reasons[0] } : null,
    reasons[1] ? { icon: <PinIcon size={18} width={2} className="shrink-0 text-brand-text" />, text: reasons[1] } : null,
  ].filter(Boolean) as { icon: ReactNode; text: ReactNode }[];

  return (
    <button type="button" onClick={onOpen} aria-label={`查看 ${card.nickname} 的主页`} className="flex h-full w-full flex-col overflow-hidden rounded-[26px] bg-surface text-left shadow-[0_12px_32px_rgba(28,35,32,0.12)]">
      <div className="relative h-[236px] w-full shrink-0">
        <Plate nickname={card.nickname} photo={card.cover} className="h-full w-full" fit="cover" pad="0" />
        {type && (
          <span className="absolute top-3.5 right-3.5 grid size-10 -rotate-6 place-items-center rounded-md border-2 border-accent bg-white/55 text-[20px] font-bold text-accent">{type.glyph}</span>
        )}
      </div>
      <div className="flex flex-col gap-3 px-[18px] pt-4 pb-[18px]">
        <div className="flex flex-col gap-0.5">
          <div className="flex min-w-0 items-baseline gap-2">
            <span className="truncate text-[24px] font-bold text-ink">{card.nickname}</span>
            {latin && <span className="latin shrink-0 text-[13px] text-ink-3">{latin}</span>}
          </div>
          <span className="truncate text-[15px] text-ink-3">{[card.major, gradeLabel(card.grade), type?.desc].filter(Boolean).join(' · ')}</span>
        </div>
        <div className="flex flex-col gap-2">
          {rows.map((r, i) => (
            <span key={i} className="flex items-center gap-2.5 text-[15px] text-ink">
              {r.icon}
              <span className="min-w-0 truncate">{r.text}</span>
            </span>
          ))}
        </div>
      </div>
    </button>
  );
}

/** 稍后再看：一直留在这里，直到处理或移除。只有本人能看到这份名单。 */
export function MatchLater() {
  const nav = useNavigate();
  const toast = useToast();
  const openMatch = useMatch('/match/later/u/:id');
  const openId = openMatch ? Number(openMatch.params.id) : null;
  const [items, setItems] = useState<FeedbackItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [today, setToday] = useState<number | null>(null);
  const alive = useRef(true);
  const load = useCallback(() => {
    setError(null);
    api.match.feedbackList('skip').then((r) => { if (alive.current) setItems(r.items); }).catch((cause) => { if (alive.current) setError(errorText(cause)); });
  }, []);
  useEffect(() => {
    alive.current = true;
    load();
    api.match.deck(5).then((d) => { if (alive.current) setToday(d.items.length); }).catch(() => {});
    return () => { alive.current = false; };
  }, [load]);

  const decide = async (item: FeedbackItem, action: 'like' | 'dislike' | 'remove') => {
    setBusy(item.targetId);
    try {
      if (action === 'remove') await api.match.undoFeedback(item.targetId);
      else {
        const result = await api.match.feedback(item.targetId, action);
        if (result.matched && result.matchId) { nav(`/messages/${result.matchId}`); return; }
      }
      if (!alive.current) return;
      setItems((current) => current?.filter((c) => c.targetId !== item.targetId) ?? null);
      toast.success(action === 'like' ? '已表示感兴趣，等待对方回应' : action === 'dislike' ? '已标记不感兴趣' : '已移出稍后再看');
    } catch (cause) {
      toast.error('操作没有成功', errorText(cause));
    } finally {
      if (alive.current) setBusy(null);
    }
  };

  return (
    <div className="mx-auto max-w-[560px]">
      <Header active="later" today={today} later={items?.length ?? null} />
      <div className="mt-[18px]">
        {error ? (
          <Empty title="列表暂时没有加载成功" desc={error} action={<Button onClick={load}>重新加载</Button>} />
        ) : !items ? (
          <Skeleton className="h-40 rounded-2xl" />
        ) : !items.length ? (
          <Empty title="还没有稍后再看的同学" desc="在今日推荐里点书签按钮，就能把同学留到这里。" action={<Button onClick={() => nav('/match')}>查看今日推荐</Button>} />
        ) : (
          <GroupList>
            {items.map((item) => (
              <div key={item.targetId} className="flex items-center gap-3 px-4 py-3">
                <Plate nickname={item.nickname} className="size-11 shrink-0 overflow-hidden rounded-full bg-mat" pad="0" fit="cover" />
                <Link to={`/match/later/u/${item.targetId}`} className="min-w-0 flex-1 truncate text-[17px] font-semibold text-ink">{item.remarkName || item.nickname}</Link>
                <button type="button" aria-label="不感兴趣" disabled={busy !== null} onClick={() => void decide(item, 'dislike')} className="grid size-9 place-items-center rounded-full bg-paper-2 text-ink-3"><XIcon size={16} width={2.4} /></button>
                <button type="button" aria-label="感兴趣" disabled={busy !== null} onClick={() => void decide(item, 'like')} className="grid size-9 place-items-center rounded-full bg-brand text-white"><HeartFill size={18} /></button>
              </div>
            ))}
          </GroupList>
        )}
      </div>
      <AnimatePresence>{openId && <ProfileOverlay key={openId} id={openId} onClose={() => { nav('/match/later'); load(); }} onChanged={load} />}</AnimatePresence>
    </div>
  );
}
