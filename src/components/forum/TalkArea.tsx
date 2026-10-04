import { AnimatePresence, motion } from 'motion/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { Search, SlidersHorizontal, X } from 'lucide-react';
import type { AdvancedQuery, ForumPost, ProfileCard as Card, PostSearchQuery } from '../../../shared/types';
import { api, ApiError } from '../../lib/api';
import { cx } from '../../lib/format';
import { ease } from '../../lib/motion';
import { Button, Empty, Modal, Segmented, useIsMobile } from '../ui';
import {
  AdvancedSearch, DEFAULT_POST_QUERY, DEFAULT_QUERY, POST_FIELDS, PROFILE_FIELDS, activeCount, describeValues, fieldLabel, type FieldDef,
} from '../AdvancedSearch';
import { CardSkeleton, ProfileCard } from '../ProfileCard';
import { ProfileOverlay } from '../ProfileOverlay';
import { Illustration } from '../brand';
import { ForumPostCard, PostSkeleton } from './ForumPostCard';
import { PostComposer } from './PostComposer';
import { onAccountChanged } from '../../lib/auth';

type Target = 'posts' | 'people';
type Mode =
  | { kind: 'feed' }
  | { kind: 'keyword'; q: string }
  | { kind: 'posts'; query: PostSearchQuery }
  | { kind: 'people'; query: AdvancedQuery & { keyword?: string }; box?: string };

const CARD_GRID = 'grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 xl:grid-cols-4';
const TARGETS = [{ value: 'posts', label: '帖子' }, { value: 'people', label: '同学' }];
const fieldsOf = (target: Target): FieldDef[] => (target === 'posts' ? POST_FIELDS : PROFILE_FIELDS);

// 返回社区时先显示上次的帖子流，再在后台刷新
let feedCache: { items: ForumPost[]; hasMore: boolean } | null = null;
// 换号或退出后丢弃上一位同学的帖子流缓存
onAccountChanged(() => { feedCache = null; });

/** 聊天区：发帖、帖子流、关键词检索与高级检索（帖子 / 同学） */
export function TalkArea() {
  const nav = useNavigate();
  const mobile = useIsMobile(1024);
  const [mode, setMode] = useState<Mode>({ kind: 'feed' });
  const [input, setInput] = useState('');
  const [posts, setPosts] = useState<ForumPost[]>(() => feedCache?.items ?? []);
  const [people, setPeople] = useState<Card[]>([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(feedCache?.hasMore ?? false);
  const [loading, setLoading] = useState(!feedCache);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [advOpen, setAdvOpen] = useState(false);
  const [target, setTarget] = useState<Target>('posts');
  const [postQuery, setPostQuery] = useState<AdvancedQuery>(DEFAULT_POST_QUERY);
  const [peopleQuery, setPeopleQuery] = useState<AdvancedQuery>(DEFAULT_QUERY);
  const [openCard, setOpenCard] = useState<Card | null>(null);
  const reqId = useRef(0);

  const load = useCallback(async (m: Mode) => {
    const id = ++reqId.current;
    setLoading(true);
    setError(null);
    try {
      if (m.kind === 'people') {
        const r = await api.advancedSearch(m.query);
        if (id !== reqId.current) return;
        setPeople(r.items);
        setTotal(r.total);
      } else if (m.kind === 'posts') {
        const r = await api.forum.search(m.query);
        if (id !== reqId.current) return;
        setPosts(r.items);
        setTotal(r.total);
        setHasMore(false);
      } else {
        const r = await api.forum.posts(m.kind === 'keyword' ? { q: m.q } : {});
        if (id !== reqId.current) return;
        setPosts(r.items);
        setHasMore(r.hasMore);
        setTotal(r.items.length);
        if (m.kind === 'feed') feedCache = { items: r.items, hasMore: r.hasMore };
      }
    } catch (e) {
      if (id !== reqId.current) return;
      setError(e instanceof ApiError ? e.message : '网络连接失败，请稍后重试');
    } finally {
      if (id === reqId.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(mode);
  }, [mode, load]);

  const changeMode = useCallback((next: Mode) => {
    reqId.current += 1; // 立即作废进行中的请求
    const cached = next.kind === 'feed' ? feedCache : null;
    setPosts(cached?.items ?? []);
    setPeople([]);
    setTotal(0);
    setHasMore(cached?.hasMore ?? false);
    setError(null);
    setLoading(true);
    setMode(next);
  }, []);

  // 关键词输入：防抖 300ms；帖子高级检索中修改关键词则带着关键词重新检索。
  // 搜索框只检索帖子：「找同学」模式记下进入时搜索框里的文字（box），之后改动搜索框才切回帖子关键词检索
  useEffect(() => {
    const keyword = input.trim();
    const applied = mode.kind === 'keyword' ? mode.q : mode.kind === 'posts' ? mode.query.keyword ?? '' : mode.kind === 'people' ? mode.box ?? '' : '';
    if (keyword === applied) return;
    const timer = setTimeout(() => {
      if (mode.kind === 'posts') {
        if (!keyword && !mode.query.criteria.length) changeMode({ kind: 'feed' });
        else changeMode({ ...mode, query: { ...mode.query, keyword } });
      } else changeMode(keyword ? { kind: 'keyword', q: keyword } : mode.kind === 'people' ? { ...mode, box: '' } : { kind: 'feed' });
    }, 300);
    return () => clearTimeout(timer);
  }, [input, mode, changeMode]);

  const loadMore = async () => {
    if (loadingMore || !hasMore || !posts.length || (mode.kind !== 'feed' && mode.kind !== 'keyword')) return;
    const id = reqId.current;
    setLoadingMore(true);
    try {
      const r = await api.forum.posts({ q: mode.kind === 'keyword' ? mode.q : undefined, before: posts[posts.length - 1].id });
      if (id !== reqId.current) return;
      const seen = new Set(posts.map((p) => p.id));
      const next = [...posts, ...r.items.filter((p) => !seen.has(p.id))];
      setPosts(next);
      setHasMore(r.hasMore);
      if (mode.kind === 'feed') feedCache = { items: next, hasMore: r.hasMore };
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '加载失败，请稍后重试');
    } finally {
      setLoadingMore(false);
    }
  };

  const queryOf = (t: Target) => (t === 'posts' ? postQuery : peopleQuery);
  const setQueryOf = (t: Target, q: AdvancedQuery) => (t === 'posts' ? setPostQuery(q) : setPeopleQuery(q));

  const runAdvanced = (t: Target = target, q: AdvancedQuery = queryOf(t)) => {
    const criteria = q.criteria.filter((c) => c.values.length);
    // 搜索框是帖子关键词，只用于检索帖子；找同学时的自我介绍关键词在面板里的「自我介绍关键词」条件中单独填写
    const postKeyword = input.trim();
    setAdvOpen(false);
    if (!criteria.length) {
      changeMode(postKeyword ? { kind: 'keyword', q: postKeyword } : { kind: 'feed' });
      return;
    }
    changeMode(t === 'posts' ? { kind: 'posts', query: { ...q, criteria, keyword: postKeyword } } : { kind: 'people', query: { ...q, criteria, keyword: '' }, box: postKeyword });
  };

  const reset = () => {
    setQueryOf(target, target === 'posts' ? DEFAULT_POST_QUERY : DEFAULT_QUERY);
    if (mode.kind === target) changeMode(input.trim() ? { kind: 'keyword', q: input.trim() } : { kind: 'feed' });
  };

  const removeCriterion = (t: Target, field: string) => {
    const q = queryOf(t);
    const next = { ...q, criteria: q.criteria.map((c) => (c.field === field ? { ...c, values: [] } : c)) };
    setQueryOf(t, next);
    runAdvanced(t, next);
  };

  const clearAll = () => {
    setInput('');
    changeMode({ kind: 'feed' });
  };

  const patchPost = (id: number, p: Partial<ForumPost>) => {
    setPosts((xs) => {
      const next = xs.map((x) => (x.id === id ? { ...x, ...p } : x));
      if (mode.kind === 'feed' && feedCache) feedCache = { ...feedCache, items: next };
      return next;
    });
  };

  const onCreated = (post: ForumPost) => {
    if (mode.kind !== 'feed') {
      setInput('');
      changeMode({ kind: 'feed' });
      return;
    }
    setPosts((xs) => {
      const next = [post, ...xs.filter((x) => x.id !== post.id)];
      feedCache = { items: next, hasMore };
      return next;
    });
  };

  const advancedKind = mode.kind === 'posts' || mode.kind === 'people' ? mode.kind : null;
  const applied = advancedKind ? (mode as Extract<Mode, { kind: 'posts' | 'people' }>).query.criteria : [];
  const appliedFields = advancedKind ? fieldsOf(advancedKind) : [];
  const matchLabel = (fields: FieldDef[]) => (key: string) => fieldLabel(key.split(':')[1] ?? key, fields);
  const currentQuery = queryOf(target);

  const panel = (
    <AdvancedSearch
      query={currentQuery}
      onChange={(q) => setQueryOf(target, q)}
      onSearch={() => runAdvanced()}
      onReset={reset}
      busy={loading && mode.kind === target}
      fields={fieldsOf(target)}
      title={mobile ? null : '高级检索'}
      desc={target === 'posts'
        ? '「标题或正文」检索帖子内容；作者条件只检索作者已公开的主页。精确匹配需符合过半加分条件；模糊匹配符合一项即可。'
        : '按问卷资料检索同学。精确匹配需符合过半加分条件；模糊匹配符合一项即可。「必须」与「排除」始终生效。'}
      header={
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[13px] font-semibold text-ink">检索对象</span>
          <Segmented options={TARGETS} value={target} onChange={(v) => setTarget(v as Target)} />
        </div>
      }
    />
  );

  const statusText = loading
    ? mode.kind === 'people' ? '正在查找同学…' : '正在加载帖子…'
    : error
      ? '本次加载未完成'
      : mode.kind === 'feed'
        ? '最新帖子'
        : mode.kind === 'keyword'
          ? `找到 ${posts.length}${hasMore ? '+' : ''} 条帖子 · 按命中关键词数排序`
          : mode.kind === 'posts'
            ? `找到 ${total} 条帖子${total > posts.length ? `（显示前 ${posts.length} 条）` : ''} · ${mode.query.matchMode === 'fuzzy' ? '模糊匹配' : '精确匹配'} · 按符合条件数排序`
            : `找到 ${people.length} 位同学 · ${mode.query.matchMode === 'fuzzy' ? '模糊匹配' : '精确匹配'} · 按符合条件数排序`;

  return (
    <div>
      <div className="flex gap-2">
        <label className="flex h-11 min-w-0 flex-1 items-center gap-2.5 rounded-md border border-line-strong bg-surface px-3.5 transition-[border-color,box-shadow] focus-within:border-brand focus-within:shadow-[0_0_0_3px_var(--brand-soft)]">
          <Search size={17} className="shrink-0 text-ink-3" aria-hidden />
          <input
            value={input}
            onChange={(e) => setInput(e.target.value.slice(0, 100))}
            placeholder={mode.kind === 'people' ? '搜索同学的自我介绍' : '搜索帖子，例如：晚霞 食堂 线代'}
            className="h-full min-w-0 flex-1 bg-transparent text-[16px] outline-none placeholder:text-ink-4 sm:text-[15px]"
            aria-label={mode.kind === 'people' ? '搜索同学的自我介绍' : '搜索帖子标题与正文'}
            enterKeyHint="search"
          />
          {input && (
            <button type="button" onClick={() => setInput('')} className="grid size-6 place-items-center rounded-full bg-paper-2 text-ink-3 hover:text-ink" aria-label="清空搜索">
              <X size={13} />
            </button>
          )}
        </label>
        <Button
          variant={advOpen || advancedKind ? 'dark' : 'secondary'}
          size="lg"
          icon={<SlidersHorizontal size={16} />}
          onClick={() => setAdvOpen((v) => !v)}
          aria-expanded={advOpen}
          aria-controls={mobile ? undefined : 'community-advanced'}
          aria-label="高级检索"
          className="px-3.5 sm:px-5"
        >
          <span className="hidden sm:inline">高级检索</span>
          {activeCount(currentQuery) > 0 && <span className="tabular">{activeCount(currentQuery)}</span>}
        </Button>
      </div>

      {mobile ? (
        <Modal open={advOpen} onClose={() => setAdvOpen(false)} title="高级检索" size="lg">{panel}</Modal>
      ) : (
        <AnimatePresence initial={false}>
          {advOpen && (
            <motion.div
              id="community-advanced"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.28, ease }}
              className="overflow-hidden"
            >
              <div className="mt-3 rounded-xl border border-line">{panel}</div>
            </motion.div>
          )}
        </AnimatePresence>
      )}

      <div className="mt-4 mb-3 flex min-h-7 flex-wrap items-center gap-2 text-[13px] text-ink-3" aria-live="polite">
        <span>{statusText}</span>
        {mode.kind !== 'feed' && (
          <button type="button" onClick={clearAll} className="text-brand-text underline-offset-2 hover:underline">返回全部帖子</button>
        )}
      </div>
      {advancedKind && applied.length > 0 && (
        <div className="-mt-1 mb-4">
          <div className="flex flex-wrap gap-1.5">
            <span className="inline-flex h-7 items-center rounded-md bg-ink px-2 text-[12px] text-surface">{advancedKind === 'posts' ? '检索帖子' : '检索同学'}</span>
            {applied.map((c) => (
              <span key={c.field} className="inline-flex min-h-7 items-center gap-1 rounded-md border border-line bg-surface pr-1 pl-2 text-[12px] text-ink-2">
                {c.mode === 'must' && <b className="font-semibold text-ink">必须</b>}
                {c.mode === 'not' && <b className="font-semibold text-danger">排除</b>}
                {fieldLabel(c.field, appliedFields)}：{describeValues(c.field, c.values, appliedFields)}
                <button type="button" onClick={() => removeCriterion(advancedKind, c.field)} className="grid size-5 place-items-center rounded text-ink-3 hover:bg-paper-2 hover:text-ink" aria-label={`移除条件：${fieldLabel(c.field, appliedFields)}`}>
                  <X size={12} />
                </button>
              </span>
            ))}
          </div>
          <p className="mt-1.5 text-[12px] text-ink-4">精确匹配需符合过半加分条件；模糊匹配符合一项即可。</p>
        </div>
      )}

      {mode.kind === 'feed' && <div className="mb-4"><PostComposer collapsible onDone={onCreated} /></div>}

      {mode.kind === 'people' ? (
        loading ? (
          <div className={CARD_GRID}>{Array.from({ length: 4 }).map((_, i) => <CardSkeleton key={i} />)}</div>
        ) : error ? (
          <Empty art={<Illustration name="mascot-empty" className="mb-4 size-24" />} title="暂时无法检索同学" desc={error} action={<Button variant="primary" onClick={() => void load(mode)}>重新加载</Button>} />
        ) : people.length === 0 ? (
          <Empty art={<Illustration name="mascot-search" className="mb-4 size-28" />} title="没有找到符合条件的同学" desc="减少一些条件、换个关键词，或切换到「模糊匹配」。" action={<Button variant="primary" onClick={() => setAdvOpen(true)}>调整条件</Button>} />
        ) : (
          <div className={CARD_GRID}>
            {people.map((card, i) => (
              <ProfileCard key={card.id} index={i} card={card} onOpen={() => setOpenCard(card)} matchLabels={matchLabel(PROFILE_FIELDS)} />
            ))}
          </div>
        )
      ) : loading && !posts.length ? (
        <div className="space-y-3">{Array.from({ length: 3 }).map((_, i) => <PostSkeleton key={i} />)}</div>
      ) : error && !posts.length ? (
        <Empty art={<Illustration name="mascot-empty" className="mb-4 size-24" />} title="帖子暂时没有加载出来" desc={error} action={<Button variant="primary" onClick={() => void load(mode)}>重新加载</Button>} />
      ) : posts.length === 0 ? (
        mode.kind === 'feed' ? (
          <Empty art={<Illustration name="mascot-cheer" className="mb-4 size-28" />} title="聊天区还很安静" desc="发第一条帖子，分享你的校园生活吧。" />
        ) : (
          <Empty
            art={<Illustration name="mascot-search" className="mb-4 size-28" />}
            title="没有找到相关的帖子"
            desc={mode.kind === 'posts' ? '减少一些条件，或切换到「模糊匹配」。作者条件只会检索作者已公开的主页。' : '换个关键词试试，也可以用「高级检索」按作者或正文条件查找。'}
            action={<Button variant="primary" onClick={() => setAdvOpen(true)}>{mode.kind === 'posts' ? '调整条件' : '高级检索'}</Button>}
          />
        )
      ) : (
        <div className={cx('space-y-3 transition-opacity', loading && 'opacity-60')}>
          {posts.map((p, i) => (
            <ForumPostCard
              key={p.id}
              post={p}
              index={i}
              onOpen={() => nav(`/community/posts/${p.id}`)}
              onChange={(x) => patchPost(p.id, x)}
              matchLabel={mode.kind === 'posts' ? matchLabel(POST_FIELDS) : undefined}
            />
          ))}
          {hasMore && (
            <div className="pt-2 text-center">
              <Button onClick={() => void loadMore()} loading={loadingMore}>加载更多</Button>
            </div>
          )}
          {!hasMore && mode.kind === 'feed' && posts.length > 5 && <p className="py-4 text-center text-[13px] text-ink-4">已经到底了</p>}
          {error && <p className="text-center text-[13px] text-danger" role="alert">{error}</p>}
        </div>
      )}

      <AnimatePresence>
        {openCard && (
          <ProfileOverlay
            key={openCard.id}
            id={openCard.id}
            match={openCard.match}
            searchQuery={mode.kind === 'people' ? mode.query : undefined}
            keyword={mode.kind === 'people' ? mode.query.keyword : undefined}
            onClose={() => setOpenCard(null)}
            onChanged={() => void load(mode)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
