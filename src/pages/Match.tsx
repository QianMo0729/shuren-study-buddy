import { AnimatePresence, LayoutGroup } from 'motion/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useMatch, useNavigate, useSearchParams } from 'react-router';
import { ChevronRight, Info, RefreshCw, Sparkles } from 'lucide-react';
import type { DeckCard, DeckResponse, PublicProfile } from '../../shared/types';
import { api, ApiError } from '../lib/api';
import { useToast } from '../lib/toast';
import { Button, Empty, Segmented } from '../components/ui';
import { CardSkeleton, ProfileCard } from '../components/ProfileCard';
import { ProfileOverlay } from '../components/ProfileOverlay';
import { SwipeDeck } from '../components/SwipeDeck';
import { MatchCelebration } from '../components/match/MatchCelebration';
import { MatchEmpty } from '../components/match/MatchEmpty';
import { useDeckQueue } from '../components/match/useDeckQueue';
import { Illustration } from '../components/brand';

type View = 'cards' | 'list';
const CARD_GRID = 'grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4';
const errorText = (cause: unknown) => (cause instanceof ApiError ? cause.message : '网络连接失败，请稍后重试');

export function Match() {
  const nav = useNavigate();
  const [params] = useSearchParams();
  const view: View = params.get('view') === 'list' ? 'list' : 'cards';
  const openMatch = useMatch('/match/u/:id');
  const openId = openMatch ? Number(openMatch.params.id) : null;
  const toast = useToast();
  const [celebration, setCelebration] = useState<{ matchId: number; nickname: string; cover: string | null } | null>(null);
  const [selected, setSelected] = useState<DeckCard | null>(null);
  const [profileHint, setProfileHint] = useState(false);
  const changed = useRef<number | null>(null);

  const deck = useDeckQueue({
    limit: 20,
    onMatched: (card, result) => setCelebration({ matchId: result.matchId!, nickname: card.nickname, cover: card.cover }),
    onError: (title, desc) => toast.error(title, desc),
  });

  // 问卷里学习性格或具体科目没填时，提示补充
  useEffect(() => {
    let alive = true;
    api.myProfile().then(({ profile }) => {
      if (!alive) return;
      const noPersonality = !Object.values(profile.personality ?? {}).some((value) => value >= 1);
      setProfileHint(noPersonality || !profile.subjects?.length);
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
      .then(({ profile }: { profile: PublicProfile }) => { if (profile.matchState !== 'none') deck.remove(id); })
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
        <p className="mt-2 max-w-[40em] text-[13.5px] text-ink-2 sm:text-[15px]">按学习时间、内容和性格的契合度推荐。双方都选「感兴趣」后，就能私聊。</p>
      </header>

      {profileHint && (
        <Link to="/me/edit#personality" className="mb-4 flex items-center gap-3 rounded-md border border-brand/20 bg-brand-softer px-4 py-3 text-[14px] text-ink transition-colors hover:border-brand/40">
          <Sparkles size={17} className="shrink-0 text-brand-text" aria-hidden />
          <span className="min-w-0 flex-1">补充学习性格与具体科目，推荐更准</span>
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
        <span>已根据你的 {p.samples} 次选择调整{p.emphasis.length ? `：更看重 ${p.emphasis.join('、')}` : ''}</span>
      </p>
    );
  }
  return (
    <p className="flex items-start gap-2 text-[13px] leading-relaxed text-ink-3">
      <Sparkles size={15} className="mt-[3px] shrink-0" aria-hidden />
      <span>{p.samples ? `再做 ${Math.max(1, 5 - p.samples)} 次选择，推荐会开始贴合你的偏好` : '你的每次「感兴趣 / 不感兴趣」都会让推荐更贴合你'}</span>
    </p>
  );
}

function DeckAside({ meta, remaining, onRefresh }: { meta: Omit<DeckResponse, 'items'> | null; remaining: number; onRefresh: () => void }) {
  return (
    <aside className="hidden space-y-4 lg:sticky lg:top-24 lg:block" aria-label="关于推荐">
      <div className="rounded-md border border-line bg-surface p-5">
        <p className="text-[12px] text-ink-3">本轮推荐</p>
        {meta?.state === 'ready' ? (
          <>
            <p className="mt-1 font-display text-[28px] leading-tight text-ink tabular">{meta.total}<span className="ml-1 font-sans text-[13px] font-normal text-ink-3">位有共同时间</span></p>
            <p className="mt-1 text-[13px] text-ink-3">可参与匹配 {meta.eligibleCount} 位 · 当前卡组剩 {remaining} 张</p>
          </>
        ) : (
          <p className="mt-1 text-[14px] text-ink-2">—</p>
        )}
        <button type="button" onClick={onRefresh} className="mt-3 inline-flex items-center gap-1.5 text-[13px] text-brand-text hover:underline">
          <RefreshCw size={13} aria-hidden />
          重新获取推荐
        </button>
      </div>
      <div className="rounded-md border border-line p-5 text-[13px] leading-relaxed text-ink-2">
        <p className="mb-2 flex items-center gap-1.5 font-semibold text-ink"><Info size={14} aria-hidden />契合度怎么算</p>
        <p>综合共同时间、学习内容、学习性格、学习方式、地点、节奏与兴趣 7 项，双方都满意才会高分。分数是问卷契合程度，不是成功概率。</p>
        <ul className="mt-3 space-y-1 text-ink-3">
          <li><b className="font-semibold text-ink-2">很合拍</b> 80 分以上</li>
          <li><b className="font-semibold text-ink-2">较合拍</b> 65–79 分</li>
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
      <div className="skeleton h-[clamp(360px,calc(100dvh-430px),540px)] rounded-md" />
      <div className="mt-6 flex justify-center gap-8">
        <div className="skeleton size-14 rounded-full" />
        <div className="skeleton mt-1.5 size-11 rounded-full" />
        <div className="skeleton size-14 rounded-full" />
      </div>
    </div>
  );
}

/** 列表：按双向契合度排序，不含个性化调整 */
function RankedList({ onOpen }: { onOpen: (card: DeckCard) => void }) {
  const [data, setData] = useState<DeckResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let alive = true;
    setError(null);
    api.match.ranked(60)
      .then((result) => { if (alive) setData(result); })
      .catch((cause) => { if (alive) setError(errorText(cause)); });
    return () => { alive = false; };
  }, [version]);

  if (error) {
    return <Empty art={<Illustration name="mascot-empty" className="mb-4 size-24" />} title="列表暂时没有加载成功" desc={error} action={<Button variant="primary" onClick={() => setVersion((v) => v + 1)}>重新加载</Button>} />;
  }
  if (!data) {
    return <div className={CARD_GRID} aria-busy>{Array.from({ length: 8 }).map((_, i) => <CardSkeleton key={i} />)}</div>;
  }
  if (data.state !== 'ready' || !data.items.length) return <MatchEmpty data={data} state={data.state === 'ready' ? 'exhausted' : data.state} onRefresh={() => setVersion((v) => v + 1)} />;
  return (
    <section aria-label="按契合度排序的同学">
      <p className="mb-4 text-[13px] text-ink-3" aria-live="polite">
        按双向契合度排序 · 共 <b className="font-semibold text-ink tabular">{data.total}</b> 位{data.total > data.items.length && `，先展示前 ${data.items.length} 位`}
      </p>
      <div className={CARD_GRID}>
        {data.items.map((card, index) => <ProfileCard key={card.id} index={index} card={card} onOpen={() => onOpen(card)} />)}
      </div>
    </section>
  );
}
