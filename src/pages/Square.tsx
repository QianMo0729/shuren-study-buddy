import { AnimatePresence, LayoutGroup, motion } from 'motion/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useMatch, useNavigate } from 'react-router';
import { Compass, Search, SlidersHorizontal, X } from 'lucide-react';
import { optionLabel } from '../../shared/options';
import type { AdvancedQuery, MatchInfo, ProfileCard as Card, PublicProfile, RecommendationInfo, RecommendationResponse } from '../../shared/types';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { ease } from '../lib/motion';
import { useToast } from '../lib/toast';
import { Button, Empty, Modal, PageHeader, Segmented, useIsMobile } from '../components/ui';
import { CardSkeleton, ProfileCard } from '../components/ProfileCard';
import { ProfileDetail } from '../components/ProfileDetail';
import { AdvancedSearch, DEFAULT_QUERY, FIELDS, activeCount, fieldLabel } from '../components/AdvancedSearch';
import { TakedownDialog } from '../components/moderation';
import { Illustration } from '../components/brand';

type Mode = { kind: 'recommendations' } | { kind: 'all' } | { kind: 'keyword'; q: string } | { kind: 'advanced'; query: AdvancedQuery & { keyword?: string } };
type BrowseSort = 'recommended' | 'latest' | 'overlap';
const CARD_GRID = 'grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-2 xl:grid-cols-3';

export function Square() {
  const { user } = useAuth();
  const toast = useToast();
  const mobile = useIsMobile(1024);
  const nav = useNavigate();
  const location = useLocation();
  const routeMatch = useMatch('/square/u/:id');
  const openId = routeMatch ? Number(routeMatch.params.id) : null;
  const [items, setItems] = useState<Card[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [recommendations, setRecommendations] = useState<RecommendationResponse | null>(null);
  const [input, setInput] = useState('');
  const [mode, setMode] = useState<Mode>({ kind: 'recommendations' });
  const [sort, setSort] = useState<BrowseSort>('recommended');
  const [advOpen, setAdvOpen] = useState(false);
  const [query, setQuery] = useState<AdvancedQuery>(DEFAULT_QUERY);
  const [takedown, setTakedown] = useState<Card | null>(null);
  const [justMatched] = useState(!!(location.state as { justMatched?: boolean; justPublished?: boolean } | null)?.justMatched || !!(location.state as { justPublished?: boolean } | null)?.justPublished);
  const [clickedCard, setClickedCard] = useState<Card | null>(null);
  const reqId = useRef(0);

  const load = useCallback(async (currentMode: Mode, currentSort: BrowseSort) => {
    const id = ++reqId.current;
    setLoading(true);
    setError(null);
    setItems([]);
    setTotal(0);
    setRecommendations(null);
    try {
      if (currentMode.kind === 'recommendations') {
        const result = await api.recommendations();
        if (id !== reqId.current) return;
        setRecommendations(result);
        setItems(result.items.filter((card) => !card.isMe));
        setTotal(result.total);
      } else {
        const result = currentMode.kind === 'advanced'
          ? await api.advancedSearch(currentMode.query)
          : await api.square(currentMode.kind === 'keyword' ? currentMode.q : '', currentSort === 'recommended' ? 'latest' : currentSort);
        if (id !== reqId.current) return;
        setItems(result.items);
        setTotal(result.total);
      }
    } catch (cause) {
      if (id !== reqId.current) return;
      setError(cause instanceof ApiError ? cause.message : '网络连接失败，请稍后重试');
      setItems([]);
      setRecommendations(null);
    } finally {
      if (id === reqId.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(mode, sort);
    return () => { reqId.current += 1; };
  }, [mode, sort, load]);

  const changeMode = useCallback((nextMode: Mode) => {
    // Invalidate immediately, including during the render before the next effect starts.
    reqId.current += 1;
    setItems([]);
    setRecommendations(null);
    setError(null);
    setTotal(0);
    setLoading(true);
    setMode(nextMode);
  }, []);

  const announced = useRef(false);
  useEffect(() => {
    if (!justMatched || announced.current) return;
    announced.current = true;
    toast.success('问卷已提交', '正在根据你的学习安排寻找合拍的同学');
    window.scrollTo({ top: 0 });
    nav(location.pathname, { replace: true, state: null });
    // The announcement is deliberately one-time; changing toasts must not reload results.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [justMatched]);

  useEffect(() => {
    const keyword = input.trim();
    const appliedKeyword = mode.kind === 'advanced' ? mode.query.keyword ?? '' : mode.kind === 'keyword' ? mode.q : '';
    if (appliedKeyword === keyword) return;
    const timer = setTimeout(() => {
      changeMode(mode.kind === 'advanced'
        ? { kind: 'advanced', query: { ...mode.query, keyword } }
        : keyword ? { kind: 'keyword', q: keyword } : sort === 'recommended' ? { kind: 'recommendations' } : { kind: 'all' });
    }, 300);
    return () => clearTimeout(timer);
  }, [input, mode, sort, changeMode]);

  const selectBrowse = (value: BrowseSort) => {
    setInput('');
    setQuery(DEFAULT_QUERY);
    setSort(value);
    setAdvOpen(false);
    changeMode(value === 'recommended' ? { kind: 'recommendations' } : { kind: 'all' });
  };
  const clear = () => selectBrowse('recommended');
  const runAdvanced = (nextQuery = query) => {
    const cleaned = { ...nextQuery, keyword: input.trim(), criteria: nextQuery.criteria.filter((criterion) => criterion.values.length) };
    if (!cleaned.criteria.length) {
      if (cleaned.keyword) changeMode({ kind: 'keyword', q: cleaned.keyword });
      else clear();
    } else changeMode({ kind: 'advanced', query: cleaned });
    setAdvOpen(false);
  };
  const removeCriterion = (field: string) => {
    const next = { ...query, criteria: query.criteria.map((criterion) => criterion.field === field ? { ...criterion, values: [] } : criterion) };
    setQuery(next);
    runAdvanced(next);
  };

  const isRecommended = mode.kind === 'recommendations';
  const isSearching = mode.kind === 'keyword' || mode.kind === 'advanced';
  const me = items.find((item) => item.isMe);
  const showCta = mode.kind === 'all' && !loading && !error && !me && !user?.published;
  const matchLabel = (key: string) => fieldLabel(key.split(':')[1] ?? key);
  const applied = mode.kind === 'advanced' ? mode.query.criteria.filter((criterion) => criterion.values.length) : [];
  const selectedCard = items.find((item) => item.id === openId) ?? (clickedCard?.id === openId ? clickedCard : null);

  return (
    <LayoutGroup>
      <PageHeader title="搭子广场" desc="先看看根据问卷推荐的同学，也可以按自己的想法检索。双方确认后，再交换联系方式。" actions={<Button variant="secondary" onClick={() => nav('/me/edit')}>{user?.published ? '调整问卷与偏好' : '完善我的问卷'}</Button>} />
      <div className="grid items-start gap-5 lg:grid-cols-[300px_minmax(0,1fr)]">
        <aside id="search-conditions" className="hidden max-h-[calc(100dvh-110px)] overflow-y-auto rounded-xl border border-line lg:sticky lg:top-24 lg:block" aria-label="搭子筛选条件">
          <AdvancedSearch query={query} onChange={setQuery} onSearch={() => runAdvanced()} busy={loading && mode.kind === 'advanced'} onReset={clear} />
        </aside>
        <section className="min-w-0" aria-label={isRecommended ? '为你推荐的学习搭子' : '搭子检索结果'} aria-busy={loading}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Segmented options={[{ value: 'recommended', label: '为你推荐' }, { value: 'latest', label: '最新上线' }, { value: 'overlap', label: '时间最合拍' }]} value={isSearching ? '' : sort} onChange={(value) => selectBrowse(value as BrowseSort)} />
            {isSearching && <button type="button" onClick={clear} className="text-[13px] text-brand-text underline">返回为你推荐</button>}
          </div>

          {isRecommended && <div className="mt-4 mb-5 flex items-start gap-3 rounded-xl border border-brand/20 bg-brand-softer p-4 sm:p-5">
            <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-full bg-brand-soft text-brand-text"><Compass size={19} aria-hidden /></span>
            <div className="min-w-0"><h2 className="font-display text-[22px] text-ink">从共同时间，找到同行的人</h2><p className="mt-1.5 text-[13px] leading-relaxed text-ink-2">综合共同时间、学习目标、相处方式等 7 项问卷信息排序。契合度分数用于比较学习安排，不代表匹配成功率。</p>{recommendations?.state === 'ready' && <p className="mt-2 text-[12px] text-brand-text">当前有 {recommendations.eligibleCount} 位同学可参与匹配，为你找到 {total} 位有共同时间的搭子。{total > items.length && `先展示契合度最高的 ${items.length} 位。`}</p>}</div>
          </div>}

          <div className={isRecommended ? 'flex gap-2' : 'mt-5 flex gap-2'}>
            <label className="flex h-11 flex-1 items-center gap-2.5 rounded-md border border-line-strong bg-surface px-3.5 transition-[border-color,box-shadow] focus-within:border-brand focus-within:shadow-[0_0_0_3px_var(--brand-soft)]">
              <Search size={17} className="shrink-0 text-ink-3" aria-hidden />
              <input value={input} onChange={(event) => setInput(event.target.value)} placeholder="搜索自我介绍，例如：雅思 图书馆" className="h-full min-w-0 flex-1 bg-transparent text-[16px] outline-none placeholder:text-ink-4 sm:text-[15px]" aria-label="搜索自我介绍" enterKeyHint="search" />
              {input && <button type="button" onClick={() => setInput('')} className="grid size-6 place-items-center rounded-full bg-paper-2 text-ink-3 hover:text-ink" aria-label="清空搜索"><X size={13} /></button>}
            </label>
            <Button variant={advOpen || mode.kind === 'advanced' ? 'dark' : 'secondary'} size="lg" icon={<SlidersHorizontal size={16} />} onClick={() => setAdvOpen((value) => !value)} aria-expanded={advOpen} aria-label="高级检索" className="lg:hidden"><span className="hidden sm:inline">高级检索</span>{activeCount(query) > 0 && <span className="tabular">{activeCount(query)}</span>}</Button>
          </div>
          <Modal open={advOpen && mobile} onClose={() => setAdvOpen(false)} title="筛选搭子" size="lg"><AdvancedSearch query={query} onChange={setQuery} onSearch={() => runAdvanced()} busy={loading && mode.kind === 'advanced'} onReset={clear} /></Modal>

          <div className="mt-4 mb-4 flex min-h-7 flex-wrap items-center justify-between gap-2 text-[13px] text-ink-3" aria-live="polite">
            {loading ? <span>{isRecommended ? '正在比较问卷与共同时间…' : '正在查找同学…'}</span> : error ? <span>本次加载未完成</span> : isSearching ? <span>找到 <b className="font-semibold text-ink tabular">{items.length}</b> 位同学，{mode.kind === 'advanced' ? `${mode.query.matchMode === 'fuzzy' ? '模糊匹配' : '精确匹配'} · 按符合条件数排序` : '按自我介绍相关度排序'}</span> : <span>{isRecommended ? '按问卷契合度排序' : sort === 'latest' ? '按最近上线排序' : '按每周共同时间排序'}{total > 0 && ` · ${total} 位`}</span>}
            {!loading && !error && isRecommended && recommendations?.state === 'ready' && <button type="button" onClick={() => void load(mode, sort)} className="text-brand-text hover:underline">刷新推荐</button>}
            {applied.map((criterion) => <span key={criterion.field} className="inline-flex min-h-7 items-center gap-1 rounded-md bg-surface pr-1 pl-2 text-[12px] text-ink-2">{criterion.mode === 'must' && '必须 '}{criterion.mode === 'not' && '排除 '}{fieldLabel(criterion.field)}：{describe(criterion.field, criterion.values)}<button type="button" onClick={() => removeCriterion(criterion.field)} className="grid size-5 place-items-center rounded text-ink-3 hover:bg-paper-2 hover:text-ink" aria-label={`移除${fieldLabel(criterion.field)}条件`}><X size={12} /></button></span>)}
          </div>

          {loading ? <div className={CARD_GRID}>{Array.from({ length: 6 }).map((_, index) => <CardSkeleton key={index} />)}</div>
            : error ? <Empty art={<Illustration name="mascot-empty" className="mb-4 size-24" />} title={isRecommended ? '推荐暂时没有加载成功' : '暂时无法加载主页'} desc={error} action={<Button variant="primary" onClick={() => void load(mode, sort)}>重新加载</Button>} />
              : isRecommended && (recommendations?.state !== 'ready' || !items.length) ? <RecommendationEmpty data={recommendations} onEdit={() => nav('/me/edit')} onBrowse={() => selectBrowse('latest')} />
                : items.length === 0 && !showCta ? <Empty art={<Illustration name={mode.kind === 'all' ? 'mascot-empty' : 'mascot-search'} className="mb-4 size-28" />} title={mode.kind === 'all' ? '广场上还没有主页' : '没有找到符合条件的同学'} desc={mode.kind === 'all' ? '上传你的主页，成为第一个。' : '减少一些条件、换个关键词，或切换到「模糊匹配」。'} action={mode.kind === 'all' ? <Button variant="primary" onClick={() => nav('/me/edit')}>上传我的主页</Button> : <div className="flex gap-2"><Button onClick={() => selectBrowse('latest')}>查看全部</Button><Button variant="primary" onClick={() => mobile ? setAdvOpen(true) : document.getElementById('search-conditions')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>调整条件</Button></div>} />
                  : <div className={CARD_GRID}>{showCta && <PublishCta published={!!user?.published} />}{items.map((card, index) => <ProfileCard key={card.id} index={index} card={card} onOpen={() => { setClickedCard(card); nav(`/square/u/${card.id}`); }} isAdmin={user?.role === 'admin'} onTakedown={() => setTakedown(card)} matchLabels={mode.kind === 'advanced' ? matchLabel : undefined} />)}</div>}
        </section>
      </div>
      <AnimatePresence onExitComplete={() => setClickedCard(null)}>{openId && <ProfileOverlay key={openId} id={openId} shared={clickedCard?.id === openId} match={selectedCard?.match} recommendation={selectedCard?.recommendation} searchQuery={mode.kind === 'advanced' ? mode.query : undefined} keyword={mode.kind === 'keyword' ? mode.q : mode.kind === 'advanced' ? mode.query.keyword : undefined} onClose={() => nav('/square')} onChanged={() => void load(mode, sort)} />}</AnimatePresence>
      {takedown && <TakedownDialog open onClose={() => setTakedown(null)} type="profile" id={takedown.id} label={takedown.nickname} onDone={() => void load(mode, sort)} />}
    </LayoutGroup>
  );
}

function RecommendationEmpty({ data, onEdit, onBrowse }: { data: RecommendationResponse | null; onEdit: () => void; onBrowse: () => void }) {
  const state = data?.state ?? 'empty';
  const messages = {
    incomplete: { title: '再补几项，就能为你推荐', description: data?.missing.length ? `请先完成：${data.missing.slice(0, 4).map((item) => item.label).join('、')}${data.missing.length > 4 ? `等 ${data.missing.length} 项` : ''}。` : '填写学习时间、目标和相处方式后，即可开始匹配。', action: '继续填写问卷' },
    unpublished: { title: '问卷已就绪，上传后开始匹配', description: '上传你的主页后，系统会根据问卷为你推荐合拍的同学。', action: '去上传我的主页' },
    unavailable: { title: '你的主页暂不参与推荐', description: '请检查是否处于暂忙状态，或是否需要修改后重新上传。调整后即可重新获取推荐。', action: '检查主页状态' },
    no_overlap: { title: '暂时还没有共同时间的搭子', description: `当前可参与匹配的 ${data?.eligibleCount ?? 0} 位同学与你没有共同空闲时段。可以调整时间安排，或先到广场认识同学。`, action: '调整我的空闲时间' },
    empty: { title: '还在等待与你合拍的同学', description: '当前还没有可推荐的其他同学。你的问卷已保留，可以先逛逛广场，稍后再来看看。', action: '查看我的问卷' },
    ready: { title: '暂时没有推荐结果', description: '可以先浏览广场，或调整自己的学习安排。', action: '调整我的问卷' },
  }[state];
  return <Empty art={<Illustration name="mascot-search" className="mb-4 size-28" />} title={messages.title} desc={messages.description} action={<div className="flex flex-wrap justify-center gap-2"><Button variant="primary" onClick={onEdit}>{messages.action}</Button><Button onClick={onBrowse}>浏览全部同学</Button></div>} />;
}

/** 已选条件的简短描述 */
function describe(field: string, values: string[]) {
  const def = FIELDS.find((f) => f.key === field);
  if (field === 'schedule') return `${values.length} 个时段`;
  if (field === 'expectations') return values.join('、');
  if (field === 'overlap') return `≥ ${values[0]} 小时/周`;
  if (field === 'major' || field === 'text' || field === 'college') return values.join('、');
  if (field === 'gender') return values[0] === 'male' ? '男' : values[0] === 'female' ? '女' : '其他';
  const labels = values.map((v) => optionLabel(def?.options ?? [], v) || v);
  return labels.length > 2 ? `${labels.slice(0, 2).join('、')} 等 ${labels.length} 项` : labels.join('、');
}

function PublishCta({ published }: { published: boolean }) {
  const nav = useNavigate();
  return (
    <button
      onClick={() => nav('/me/edit')}
      className="flex min-h-[300px] flex-col justify-end rounded-md border border-dashed border-line-strong bg-transparent p-4 text-left transition-colors hover:border-ink-3 hover:bg-surface"
    >
      <span className="flex w-full flex-1 items-center justify-center py-6"><Illustration name="mascot-cheer" className="w-full max-w-40 mix-blend-multiply sm:max-w-48" /></span>
      <span className="font-display text-[17px] text-ink sm:text-[20px]">{published ? '你的这一页已撤回' : '这里还缺你的一页'}</span>
      <span className="mt-1 text-[13px] leading-relaxed text-ink-3">填写学习时间和学习方式后上传，其他同学就能在这里看到你。</span>
      <span className="mt-3 text-[13.5px] font-semibold text-brand-text">去填写</span>
    </button>
  );
}

/** 主页浮层：桌面端卡片封面以共享元素展开；手机端从底部弹出 */
function ProfileOverlay({ id, shared, match, searchQuery, keyword, recommendation, onClose, onChanged }: { id: number; shared: boolean; match?: MatchInfo; searchQuery?: AdvancedQuery; keyword?: string; recommendation?: RecommendationInfo; onClose: () => void; onChanged: () => void }) {
  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mobile = useIsMobile(768);
  useEffect(() => {
    let active = true;
    setProfile(null);
    setError(null);
    api.profile(id).then((result) => { if (active) setProfile(result.profile); }).catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : '主页暂不可用'); });
    return () => { active = false; };
  }, [id]);
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const panel = useMemo(
    () =>
      mobile
        ? { initial: { y: '100%' }, animate: { y: 0 }, exit: { y: '100%' }, transition: { type: 'spring' as const, stiffness: 400, damping: 40 } }
        : { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 }, transition: { duration: 0.2, ease } },
    [mobile],
  );

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-end justify-center md:items-center md:p-8">
      <motion.div className="absolute inset-0 bg-[#0c1415]/45" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
      <motion.div
        {...panel}
        className="relative h-[94dvh] w-full max-w-[1000px] overflow-y-auto overscroll-contain rounded-t-xl bg-surface shadow-lg md:h-auto md:max-h-[90dvh] md:rounded-lg md:p-7"
        role="dialog"
        aria-modal="true"
      >
        {profile ? (
          <ProfileDetail profile={profile} recommendation={recommendation} match={match} searchQuery={searchQuery} keyword={keyword} onClose={onClose} onChanged={onChanged} inOverlay={!mobile && shared} />
        ) : error ? (
          <div className="grid h-80 place-items-center text-center">
            <div>
              <p className="text-[15px] text-ink-2">{error}</p>
              <Button className="mt-4" onClick={onClose}>
                返回广场
              </Button>
            </div>
          </div>
        ) : (
          <div className="grid gap-6 md:grid-cols-2">
            <div className="skeleton aspect-[4/3] md:rounded-xl" />
            <div className="space-y-4 p-5">
              <div className="skeleton h-7 w-1/2 rounded" />
              <div className="skeleton h-4 w-2/3 rounded" />
              <div className="skeleton h-24 rounded-lg" />
            </div>
          </div>
        )}
      </motion.div>
    </div>,
    document.body,
  );
}
