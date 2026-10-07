import { AnimatePresence, motion } from 'motion/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Search, SlidersHorizontal, X } from 'lucide-react';
import type { AdvancedQuery, ForumPost, PostSearchQuery } from '../../../shared/types';
import { api, ApiError } from '../../lib/api';
import { cx } from '../../lib/format';
import { ease } from '../../lib/motion';
import { Button, Empty, Modal, useIsMobile } from '../ui';
import {
  AdvancedSearch, DEFAULT_POST_QUERY, POST_FIELDS, activeCount, describeValues, fieldLabel,
} from '../AdvancedSearch';
import { Illustration } from '../brand';
import { ForumPostCard, PostSkeleton } from './ForumPostCard';
import { PostComposerDialog } from './PostComposerDialog';
import { onAccountChanged, useAuth } from '../../lib/auth';

type Mode =
  | { kind: 'feed' }
  | { kind: 'keyword'; q: string }
  | { kind: 'posts'; query: PostSearchQuery };

// 返回社区时先显示上次的帖子流，再在后台刷新
let feedCache: { items: ForumPost[]; hasMore: boolean } | null = null;
// 换号或退出后丢弃上一位同学的帖子流缓存
onAccountChanged(() => { feedCache = null; });

/** 聊天区：发帖、帖子流与独立的帖子检索。找同学位于匹配分区。 */
export function TalkArea() {
  const nav = useNavigate();
  const { user } = useAuth();
  const mobile = useIsMobile(1024);
  const [mode, setMode] = useState<Mode>({ kind: 'feed' });
  const [input, setInput] = useState('');
  const [posts, setPosts] = useState<ForumPost[]>(() => feedCache?.items ?? []);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(feedCache?.hasMore ?? false);
  const [loading, setLoading] = useState(!feedCache);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [advOpen, setAdvOpen] = useState(false);
  const [postQuery, setPostQuery] = useState<AdvancedQuery>(DEFAULT_POST_QUERY);
  const reqId = useRef(0);

  const load = useCallback(async (m: Mode) => {
    const id = ++reqId.current;
    setLoading(true);
    setError(null);
    try {
      if (m.kind === 'posts') {
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
    setTotal(0);
    setHasMore(cached?.hasMore ?? false);
    setError(null);
    setLoading(true);
    setMode(next);
  }, []);

  // 关键词输入：防抖 300ms；帖子高级检索中修改关键词则带着关键词重新检索。
  useEffect(() => {
    const keyword = input.trim();
    const applied = mode.kind === 'keyword' ? mode.q : mode.kind === 'posts' ? mode.query.keyword ?? '' : '';
    if (keyword === applied) return;
    const timer = setTimeout(() => {
      if (mode.kind === 'posts') {
        if (!keyword && !mode.query.criteria.length) changeMode({ kind: 'feed' });
        else changeMode({ ...mode, query: { ...mode.query, keyword } });
      } else changeMode(keyword ? { kind: 'keyword', q: keyword } : { kind: 'feed' });
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

  const runAdvanced = (q: AdvancedQuery = postQuery) => {
    const criteria = q.criteria.filter((c) => c.values.length);
    const keyword = input.trim();
    setAdvOpen(false);
    changeMode(criteria.length ? { kind: 'posts', query: { ...q, criteria, keyword } }
      : keyword ? { kind: 'keyword', q: keyword } : { kind: 'feed' });
  };

  const reset = () => {
    setPostQuery(DEFAULT_POST_QUERY);
    if (mode.kind === 'posts') changeMode(input.trim() ? { kind: 'keyword', q: input.trim() } : { kind: 'feed' });
  };

  const removeCriterion = (field: string) => {
    const next = { ...postQuery, criteria: postQuery.criteria.map((c) => c.field === field ? { ...c, values: [] } : c) };
    setPostQuery(next);
    runAdvanced(next);
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

  const advancedKind = mode.kind === 'posts';
  const applied = mode.kind === 'posts' ? mode.query.criteria : [];
  const matchLabel = (key: string) => fieldLabel(key.split(':')[1] ?? key, POST_FIELDS);

  const panel = (
    <AdvancedSearch
      query={postQuery}
      onChange={setPostQuery}
      onSearch={() => runAdvanced()}
      onReset={reset}
      busy={loading && mode.kind === 'posts'}
      fields={POST_FIELDS}
      title={mobile ? null : '帖子高级检索'}
      desc="「标题或正文」检索帖子内容；作者条件只检索作者已公开的主页。精确匹配需符合过半加分条件；模糊匹配符合一项即可。"
    />
  );

  const statusText = loading ? '正在加载帖子…' : error ? '本次加载未完成' : mode.kind === 'feed' ? '最新帖子'
    : mode.kind === 'keyword' ? `找到 ${posts.length}${hasMore ? '+' : ''} 条帖子 · 按命中关键词数排序`
    : `找到 ${total} 条帖子${total > posts.length ? `（显示前 ${posts.length} 条）` : ''} · ${mode.query.matchMode === 'fuzzy' ? '模糊匹配' : '精确匹配'} · 按符合条件数排序`;

  return (
    <div className="pb-10">
      <div className="flex gap-2">
        <label className="flex h-11 min-w-0 flex-1 items-center gap-2.5 rounded-md border border-line-strong bg-surface px-3.5 transition-[border-color,box-shadow] focus-within:border-brand focus-within:shadow-[0_0_0_3px_var(--brand-soft)]">
          <Search size={17} className="shrink-0 text-ink-3" aria-hidden />
          <input
            value={input}
            onChange={(e) => setInput(e.target.value.slice(0, 100))}
            placeholder="搜索帖子，例如：晚霞 食堂 线代"
            className="h-full min-w-0 flex-1 bg-transparent text-[16px] outline-none placeholder:text-ink-4 sm:text-[15px]"
            aria-label="搜索帖子标题与正文"
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
          {activeCount(postQuery) > 0 && <span className="tabular">{activeCount(postQuery)}</span>}
        </Button>
      </div>

      <p className="mt-2 text-[13px] text-ink-3">想按专业、课程或时间找搭子？<Link to="/match/search" className="ml-1 text-brand-text underline underline-offset-2">去找同学</Link></p>

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
            <span className="inline-flex h-7 items-center rounded-md bg-ink px-2 text-[12px] text-surface">检索帖子</span>
            {applied.map((c) => (
              <span key={c.field} className="inline-flex min-h-7 items-center gap-1 rounded-md border border-line bg-surface pr-1 pl-2 text-[12px] text-ink-2">
                {c.mode === 'must' && <b className="font-semibold text-ink">必须</b>}
                {c.mode === 'not' && <b className="font-semibold text-danger">排除</b>}
                {fieldLabel(c.field, POST_FIELDS)}：{describeValues(c.field, c.values, POST_FIELDS)}
                <button type="button" onClick={() => removeCriterion(c.field)} className="grid size-5 place-items-center rounded text-ink-3 hover:bg-paper-2 hover:text-ink" aria-label={`移除条件：${fieldLabel(c.field, POST_FIELDS)}`}>
                  <X size={12} />
                </button>
              </span>
            ))}
          </div>
          <p className="mt-1.5 text-[12px] text-ink-4">精确匹配需符合过半加分条件；模糊匹配符合一项即可。</p>
        </div>
      )}

      {loading && !posts.length ? (
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
              matchLabel={mode.kind === 'posts' ? matchLabel : undefined}
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

      <PostComposerDialog key={user?.id ?? 'anon'} onDone={onCreated} />

    </div>
  );
}
