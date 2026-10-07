import { AnimatePresence, LayoutGroup } from 'motion/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useMatch, useNavigate, useSearchParams } from 'react-router';
import { ChevronRight, Info, RefreshCw, Sparkles } from 'lucide-react';
import type { DeckCard, DeckResponse, FeedbackItem, PublicProfile } from '../../shared/types';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useToast } from '../lib/toast';
import { Button, Empty, Segmented } from '../components/ui';
import { CardSkeleton, ProfileCard } from '../components/ProfileCard';
import { ProfileOverlay } from '../components/ProfileOverlay';
import { DECK_HEIGHT, SwipeDeck } from '../components/SwipeDeck';
import { MatchCelebration } from '../components/match/MatchCelebration';
import { MatchEmpty } from '../components/match/MatchEmpty';
import { useDeckQueue } from '../components/match/useDeckQueue';
import { Illustration } from '../components/brand';

type View = 'cards' | 'list';
const CARD_GRID = 'grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4';
const errorText = (cause: unknown) => (cause instanceof ApiError ? cause.message : '网络连接失败，请稍后重试');

export function Match() {
  const { user } = useAuth();
  // 未提交问卷时留在匹配页；推荐组件尚未挂载，不会请求卡组、列表或个人主页。
  return user?.questionnaireComplete ? <MatchResults /> : <QuestionnaireRequired />;
}

function QuestionnaireRequired() {
  return (
    <>
      <header className="mb-5 border-b border-ink pt-5 pb-4 sm:mb-6 sm:pt-10 sm:pb-5">
        <h1 className="font-display text-[30px] leading-[1.1] tracking-[-0.02em] text-ink sm:text-[46px]">匹配推荐</h1>
        <p className="mt-2 text-[13.5px] text-ink-2 sm:text-[15px]">让小树仁先了解你的学习习惯，再帮你找到合拍的搭子。</p>
      </header>
      <section aria-labelledby="questionnaire-required-title" className="mx-auto flex max-w-xl flex-col items-center py-7 text-center sm:py-10">
        <img
          src="/assets/mascot-questionnaire.png"
          alt="小树仁拿着问卷和铅笔，微笑着等你一起填写"
          width={1254}
          height={1254}
          className="mb-6 size-52 object-contain sm:size-64"
        />
        <p className="mb-2 text-[13px] font-semibold tracking-[0.12em] text-brand-text">小树仁的小提醒</p>
        <h2 id="questionnaire-required-title" className="font-display text-[27px] leading-snug text-ink sm:text-[32px]">请先完成问卷，才能看见匹配结果</h2>
        <p className="mt-3 max-w-sm text-[14px] leading-7 text-ink-2 sm:text-[15px]">告诉我你的学习时间、目标和偏好，我会帮你寻找更合拍的学习搭子。</p>
        <Link
          to="/me/edit?onboarding=1"
          className="mt-6 inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-brand px-6 text-[15px] font-semibold text-white transition-colors hover:bg-brand-2"
        >
          去完成我的问卷
          <ChevronRight size={17} aria-hidden />
        </Link>
        <p className="mt-3 text-[12.5px] leading-relaxed text-ink-3">问卷会自动保存，可以随时回来继续填写。</p>
      </section>
    </>
  );
}

function MatchResults() {
  const nav = useNavigate();
  const [params] = useSearchParams();
  const view: View = params.get('view') === 'list' ? 'list' : 'cards';
  const openMatch = useMatch('/match/u/:id');
  const openId = openMatch ? Number(openMatch.params.id) : null;
  const toast = useToast();
  const [celebration, setCelebration] = useState<{ matchId: number; nickname: string; cover: string | null } | null>(null);
  const [selected, setSelected] = useState<DeckCard | null>(null);
  const [profileHint, setProfileHint] = useState<{ text: string; to: string } | null>(null);
  const location = useLocation();

  // 刚提交完问卷：这是唯一会把主页公开出去的一步，给一个明确的回执（只显示一次）
  const announced = useRef(false);
  useEffect(() => {
    if (announced.current || !(location.state as { justMatched?: boolean } | null)?.justMatched) return;
    announced.current = true;
    toast.success('问卷已提交，主页已发布', '下面是为你推荐的同学。之后修改问卷，要重新提交才会更新主页。');
    nav({ pathname: location.pathname, search: location.search }, { replace: true, state: null });
  }, [location.state]);
  const changed = useRef<number | null>(null);

  const explained = useRef(false);
  const deck = useDeckQueue({
    limit: 5,
    onMatched: (card, result) => setCelebration({ matchId: result.matchId!, nickname: card.nickname, cover: card.cover }),
    // 与主页上的提示一致；规则只在第一次说明，之后每次只确认这一下生效了
    onLiked: (card) => {
      toast.success(`已对 ${card.nickname} 表示感兴趣`, explained.current ? undefined : '对方也感兴趣时，你们就可以私聊；在那之前对方不会知道。可以在「我的 → 推荐偏好」里查看和撤回。');
      explained.current = true;
    },
    onError: (title, desc) => toast.error(title, desc),
  });

  // 问卷里学习性格或具体科目没填时，提示补充
  useEffect(() => {
    let alive = true;
    api.myProfile().then(({ profile }) => {
      if (!alive) return;
      const noPersonality = !Object.values(profile.personality ?? {}).some((value) => value >= 1);
      const noSubjects = !profile.subjects?.length;
      // 只提示真正没填的那一项
      setProfileHint(noPersonality && noSubjects ? { text: '补充学习性格与具体科目，推荐更准', to: '/me/edit#personality' }
        : noPersonality ? { text: '补充 7 道学习性格小题，推荐更准', to: '/me/edit#personality' }
        : noSubjects ? { text: '补充想一起学的具体科目，推荐更准', to: '/me/edit#goals' } : null);
    }).catch(() => undefined);
    return () => { alive = false; };
  }, []);

  const search = view === 'list' ? '?view=list' : '';
  const setView = (next: View) => nav({ pathname: '/match', search: next === 'list' ? '?view=list' : '' }, { replace: true });
  const open = (card: DeckCard) => {
    setSelected(card);
    nav({ pathname: `/match/u/${card.id}`, search });
  };

  // 在浮层里做了选择：关闭时确认状态，已处理的同学从卡片中移除
  const onOverlayChanged = useCallback(() => { changed.current = openId; }, [openId]);
  const [listVersion, setListVersion] = useState(0);
  const closeOverlay = () => {
    const id = changed.current;
    changed.current = null;
    nav({ pathname: '/match', search });
    if (id === null) return;
    if (view === 'list') setListVersion((v) => v + 1);
    api.profile(id)
      .then(({ profile }: { profile: PublicProfile }) => { if (profile.matchState !== 'none') deck.remove(id); else void deck.reload(); })
      .catch(() => deck.remove(id));
  };

  const meta = deck.meta;
  const p = meta?.personalization;
  const recommendation = selected?.id === openId ? selected.recommendation : undefined;

  return (
    <LayoutGroup>
      <header className="mb-5 border-b border-ink pt-5 pb-4 sm:mb-6 sm:pt-10 sm:pb-5">
        <div className="flex items-center justify-between gap-4">
          <h1 className="font-display text-[30px] leading-[1.1] tracking-[-0.02em] text-ink sm:text-[46px]">匹配推荐</h1>
          <Segmented options={[{ value: 'cards', label: '卡片' }, { value: 'list', label: '列表' }]} value={view} onChange={(v) => setView(v as View)} />
        </div>
        <p className="mt-2 max-w-[40em] text-[13.5px] text-ink-2 sm:text-[15px]">每天最多推荐 5 位，北京时间零点更新。双方都选「感兴趣」后，就能私聊。</p>
        <MatchTabs active="today" />
      </header>

      {profileHint && (
        <Link to={profileHint.to} className="mb-4 flex items-center gap-3 rounded-md border border-brand/20 bg-brand-softer px-4 py-3 text-[14px] text-ink transition-colors hover:border-brand/40">
          <Sparkles size={17} className="shrink-0 text-brand-text" aria-hidden />
          <span className="min-w-0 flex-1">{profileHint.text}</span>
          <ChevronRight size={16} className="shrink-0 text-ink-3" aria-hidden />
        </Link>
      )}

      {view === 'cards' ? (
        <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_300px]">
          <section aria-label="推荐卡片" aria-busy={deck.loading}>
            {deck.loading ? (
              <DeckSkeleton />
            ) : deck.error ? (
              <Empty art={<Illustration name="mascot-empty" className="mb-4 size-24" />} title="推荐暂时没有加载成功" desc={deck.error} action={<Button variant="primary" onClick={() => void deck.reload()}>重新加载</Button>} />
            ) : meta && meta.state !== 'ready' ? (
              <MatchEmpty data={meta} state={meta.state} onReviewDisliked={() => nav('/me?tab=preferences')} />
            ) : deck.queue.length ? (
              <SwipeDeck
                cards={deck.queue}
                onDecide={(card, action) => void deck.decide(card, action)}
                onOpen={open}
                onUndo={() => void deck.undo()}
                canUndo={!!deck.last}
                undoing={deck.undoing}
                active={!openId && !celebration}
                header={p && <PersonalizationLine personalization={p} />}
              />
            ) : deck.exhausted ? (
              <MatchEmpty data={meta} state="exhausted" onRefresh={() => void deck.reload()} onReviewDisliked={() => nav('/me?tab=preferences')} />
            ) : (
              <DeckSkeleton />
            )}
            {!deck.queue.length && deck.last && <div className="mt-3 text-center"><Button loading={deck.undoing} onClick={() => void deck.undo()}>撤销上一步</Button></div>}
            <p className="sr-only" aria-live="polite">{deck.queue[0] ? `当前：${deck.queue[0].nickname}，契合度 ${deck.queue[0].recommendation.score}` : ''}</p>
          </section>
          <DeckAside meta={meta} remaining={deck.queue.length} onRefresh={() => void deck.reload()} />
        </div>
      ) : (
        <RankedList key={listVersion} onOpen={open} />
      )}

      <AnimatePresence onExitComplete={() => setSelected(null)}>
        {openId && (
          <ProfileOverlay
            key={openId}
            id={openId}
            shared={view === 'list' && selected?.id === openId}
            recommendation={recommendation}
            onClose={closeOverlay}
            onChanged={onOverlayChanged}
          />
        )}
      </AnimatePresence>
      <MatchCelebration match={celebration} onClose={() => setCelebration(null)} />
    </LayoutGroup>
  );
}

function PersonalizationLine({ personalization: p }: { personalization: DeckResponse['personalization'] }) {
  if (p.active) {
    return (
      <p className="flex items-start gap-2 text-[13px] leading-relaxed text-brand-text">
        <Sparkles size={15} className="mt-[3px] shrink-0" aria-hidden />
        <span>已学习你的 {p.samples} 次选择，将用于后续推荐{p.emphasis.length ? `：更看重 ${p.emphasis.join('、')}` : ''}</span>
      </p>
    );
  }
  return (
    <p className="flex items-start gap-2 text-[13px] leading-relaxed text-ink-3">
      <Sparkles size={15} className="mt-[3px] shrink-0" aria-hidden />
      <span>{p.samples ? `再做 ${Math.max(1, 5 - p.samples)} 次选择，后续推荐会开始贴合你的偏好` : '你的每次「感兴趣 / 不感兴趣」都会让推荐更贴合你'}</span>
    </p>
  );
}

function DeckAside({ meta, remaining, onRefresh }: { meta: Omit<DeckResponse, 'items'> | null; remaining: number; onRefresh: () => void }) {
  return (
    <aside className="hidden space-y-4 lg:sticky lg:top-24 lg:block" aria-label="关于推荐">
      <div className="rounded-md border border-line bg-surface p-5">
        <p className="text-[12px] text-ink-3">今日推荐</p>
        {meta?.daily ? (
          <>
            <p className="mt-1 font-display text-[28px] leading-tight text-ink tabular">{meta.daily.assigned}<span className="ml-1 font-sans text-[13px] font-normal text-ink-3">位今日搭子</span></p>
            <p className="mt-1 text-[13px] text-ink-3">当前剩 {remaining} 位 · 每天最多 {meta.daily.limit} 位</p>
          </>
        ) : (
          <p className="mt-1 text-[14px] text-ink-2">—</p>
        )}
        <button type="button" onClick={onRefresh} className="mt-3 inline-flex items-center gap-1.5 text-[13px] text-brand-text hover:underline">
          <RefreshCw size={13} aria-hidden />
          刷新今日名单
        </button>
      </div>
      <div className="rounded-md border border-line p-5 text-[13px] leading-relaxed text-ink-2">
        <p className="mb-2 flex items-center gap-1.5 font-semibold text-ink"><Info size={14} aria-hidden />契合度怎么算</p>
        <p>综合共同时间、学习内容、学习性格、学习方式、地点、节奏与兴趣 7 项，双方都满意才会高分；时间、内容、性格任一项明显不合适都会拉低总分。分数是问卷契合程度，不是成功概率。</p>
        <ul className="mt-3 space-y-1 text-ink-3">
          <li><b className="font-semibold text-ink-2">很合拍</b> 80 分以上，且共同时间、学习内容、学习性格都达标，问卷信息足够完整</li>
          <li><b className="font-semibold text-ink-2">较合拍</b> 65 分以上</li>
          <li><b className="font-semibold text-ink-2">可以聊聊</b> 65 分以下</li>
        </ul>
        <p className="mt-3">你的选择只有你自己知道；只有双方都选了「感兴趣」，才会互相通知。</p>
      </div>
    </aside>
  );
}

function DeckSkeleton() {
  return (
    <div className="mx-auto w-full max-w-[440px]" aria-hidden>
      <div className="mb-3 h-7" />
      <div className={`skeleton ${DECK_HEIGHT} rounded-md`} />
      <div className="mt-6 flex justify-center gap-8">
        <div className="skeleton size-14 rounded-full" />
        <div className="skeleton mt-1.5 size-11 rounded-full" />
        <div className="skeleton size-14 rounded-full" />
      </div>
    </div>
  );
}

/** 列表与卡片共用每日名单。 */
function RankedList({ onOpen }: { onOpen: (card: DeckCard) => void }) {
  const overlayOpen = !!useMatch('/match/u/:id');
  const [data, setData] = useState<DeckResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    // 打开主页期间冻结背景列表；关闭时重新取当前名单，并忽略打开前未完成的请求。
    if (overlayOpen) return;
    let alive = true;
    setError(null);
    api.match.ranked(5)
      .then((result) => { if (alive) setData(result); })
      .catch((cause) => { if (alive) setError(errorText(cause)); });
    return () => { alive = false; };
  }, [version, overlayOpen]);

  useEffect(() => {
    if (overlayOpen) return;
    const visible = () => {
      if (document.visibilityState === 'visible') setVersion((current) => current + 1);
    };
    document.addEventListener('visibilitychange', visible);
    return () => document.removeEventListener('visibilitychange', visible);
  }, [overlayOpen]);

  useEffect(() => {
    if (overlayOpen || !data?.daily.resetsAt) return;
    const timer = window.setTimeout(() => setVersion((current) => current + 1), Math.max(100, Date.parse(data.daily.resetsAt) - Date.now() + 100));
    return () => window.clearTimeout(timer);
  }, [data?.daily.resetsAt, overlayOpen]);

  if (error) {
    return <Empty art={<Illustration name="mascot-empty" className="mb-4 size-24" />} title="列表暂时没有加载成功" desc={error} action={<Button variant="primary" onClick={() => setVersion((v) => v + 1)}>重新加载</Button>} />;
  }
  if (!data) {
    return <div className={CARD_GRID} aria-busy>{Array.from({ length: 8 }).map((_, i) => <CardSkeleton key={i} />)}</div>;
  }
  if (data.state !== 'ready' || !data.items.length) return <MatchEmpty data={data} state={data.state === 'ready' ? 'exhausted' : data.state} onRefresh={() => setVersion((v) => v + 1)} />;
  return (
    <section aria-label="今日推荐同学">
      <p className="mb-4 text-[13px] text-ink-3" aria-live="polite">
        今日推荐 · 剩余 <b className="font-semibold text-ink tabular">{data.total}</b> 位 · 与卡片共用名单
      </p>
      <div className={CARD_GRID}>
        {data.items.map((card, index) => <ProfileCard key={card.id} index={index} card={card} onOpen={() => onOpen(card)} />)}
      </div>
    </section>
  );
}


export function MatchTabs({ active }: { active: 'today' | 'search' | 'later' }) {
  const links = [{ id: 'today', to: '/match', label: '今日推荐' }, { id: 'search', to: '/match/search', label: '找同学' }, { id: 'later', to: '/match/later', label: '稍后再看' }] as const;
  return <nav aria-label="匹配功能" className="mt-4 flex flex-wrap gap-2">{links.map((link) => <Link key={link.id} to={link.to} aria-current={active === link.id ? 'page' : undefined} className={`rounded-md px-4 py-2 text-[14px] font-semibold ${active === link.id ? 'bg-brand text-white' : 'bg-surface text-ink-2 hover:bg-surface-2'}`}>{link.label}</Link>)}</nav>;
}

/** 永久待办：这里只显示本人收藏为稍后再看且当前仍可访问的主页。 */
export function MatchLater() {
  const nav = useNavigate();
  const toast = useToast();
  const openMatch = useMatch('/match/later/u/:id');
  const openId = openMatch ? Number(openMatch.params.id) : null;
  const [items, setItems] = useState<FeedbackItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [shown, setShown] = useState(20);
  const requestId = useRef(0);
  const alive = useRef(true);
  const deciding = useRef(false);
  const load = useCallback(() => {
    if (deciding.current) return;
    const id = ++requestId.current;
    setError(null);
    api.match.feedbackList('skip').then((result) => {
      if (alive.current && id === requestId.current) setItems(result.items);
    }).catch((cause) => {
      if (alive.current && id === requestId.current) setError(errorText(cause));
    });
  }, []);
  useEffect(() => {
    alive.current = true;
    load();
    const visible = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', visible);
    return () => { alive.current = false; requestId.current += 1; document.removeEventListener('visibilitychange', visible); };
  }, [load]);
  const decide = async (item: FeedbackItem, action: 'like' | 'dislike' | 'remove') => {
    if (deciding.current) return;
    deciding.current = true;
    requestId.current += 1; // 旧列表响应不能把刚移出的同学重新放回来。
    setBusy(item.targetId);
    try {
      if (action === 'remove') await api.match.undoFeedback(item.targetId);
      else {
        const result = await api.match.feedback(item.targetId, action);
        if (!alive.current) return;
        if (result.matched && result.matchId) { nav(`/messages/${result.matchId}`); return; }
      }
      if (!alive.current) return;
      setItems((current) => current?.filter((candidate) => candidate.targetId !== item.targetId) ?? null);
      toast.success(action === 'like' ? '已表示感兴趣，等待对方回应' : action === 'dislike' ? '已标记不感兴趣' : '已移出稍后再看');
    } catch (cause) { if (alive.current) toast.error('操作没有成功', errorText(cause)); }
    finally { deciding.current = false; if (alive.current) setBusy(null); }
  };
  return <>
    <header className="mb-5 border-b border-ink pt-5 pb-4 sm:pt-10 sm:pb-5">
      <h1 className="font-display text-[30px] leading-[1.1] text-ink sm:text-[46px]">稍后再看{items?.length ? <span className="ml-3 text-[22px] text-ink-3">{items.length}</span> : null}</h1>
      <p className="mt-2 text-[14px] text-ink-2">同学会一直留在这里，直到你处理或移除。只有你能看到这份名单。</p>
      <MatchTabs active="later" />
    </header>
    {error ? <Empty title="列表暂时没有加载成功" desc={error} action={<Button onClick={load}>重新加载</Button>} /> : !items ? <div className="skeleton h-48 rounded-md" /> : !items.length ? <Empty title="还没有稍后再看的同学" desc="在每日推荐中点「稍后再看」，就能把同学留到这里，下次继续了解。" action={<Button onClick={() => nav('/match')}>查看今日推荐</Button>} /> :
      <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface">{items.slice(0, shown).map((item) => <li key={item.targetId} className="flex flex-wrap items-center justify-between gap-3 p-4">
        <Link className="min-w-0 truncate text-[16px] font-semibold text-ink hover:underline" to={`/match/later/u/${item.targetId}`}>{item.remarkName || item.nickname}{item.remarkName && <span className="ml-2 text-[13px] font-normal text-ink-3">{item.nickname}</span>}</Link>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="primary" disabled={busy !== null} onClick={() => void decide(item, 'like')}>感兴趣</Button>
          <Button size="sm" disabled={busy !== null} onClick={() => void decide(item, 'dislike')}>不感兴趣</Button>
          <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => void decide(item, 'remove')}>移出列表</Button>
        </div>
      </li>)}</ul>}
    {items && items.length > shown && <div className="mt-4 text-center"><Button onClick={() => setShown((count) => count + 20)}>显示更多（还有 {items.length - shown} 位）</Button></div>}
    <AnimatePresence>{openId && <ProfileOverlay key={openId} id={openId} onClose={() => { nav('/match/later'); load(); }} onChanged={load} />}</AnimatePresence>
  </>;
}
