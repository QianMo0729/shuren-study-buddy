import { useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router';
import { POST_CATEGORIES } from '../../shared/options';
import { useCached } from '../lib/cache';
import { cx } from '../lib/format';
import { ShareBadge } from '../components/forum/ShareBadge';
import type { Checkin, ForumPost, Post } from '../../shared/types';
import { api, ApiError, fileUrl } from '../lib/api';
import { timeAgo } from '../lib/format';
import { useToast } from '../lib/toast';
import { Button, Empty, Input, Modal, PageHeader, SegmentBar, Segmented, Skeleton } from '../components/ui';
import { Plate } from '../components/brand';
import { PostComposer } from '../components/forum/PostComposer';
import { BubbleIcon, CameraIcon, CommunityIcon, HeartIcon, PlusIcon, PeopleIcon, SearchIcon } from '../components/icons';

type Tab = 'all' | 'checkin' | 'share' | 'events';
const TABS: { value: Tab; label: string }[] = [
  { value: 'all', label: '全部' },
  { value: 'checkin', label: '打卡' },
  { value: 'share', label: '学习分享' },
  { value: 'events', label: '招募' },
];
type Scope = 'all' | 'partner' | 'mine';
const SCOPES: { value: Scope; label: string }[] = [
  { value: 'all', label: '全部' },
  { value: 'partner', label: '我的搭子' },
  { value: 'mine', label: '我的' },
];
// 旧链接 ?tab=talk 指向「全部」
const parseTab = (v: string | null): Tab => (TABS.some((t) => t.value === v) ? (v as Tab) : 'all');
const errorText = (e: unknown) => (e instanceof ApiError ? e.message : '网络连接失败，请稍后重试');

type Item =
  | { kind: 'post'; at: string; post: ForumPost }
  | { kind: 'checkin'; at: string; checkin: Checkin }
  | { kind: 'event'; at: string; event: Post };

/** 一个分区已经加载的内容：帖子和打卡分页加载，招募一次取完 */
interface FeedData {
  posts: ForumPost[];
  postsMore: boolean;
  checkins: Checkin[];
  checkinsMore: boolean;
  events: Post[];
}

/** 社区：帖子、打卡和招募按时间排成一条动态；打卡、学习分享、招募各有分区；右上角可以搜帖子 */
export function Community() {
  const [params, setParams] = useSearchParams();
  const rawTab = params.get('tab');
  const tab = parseTab(rawTab);
  const [composing, setComposing] = useState(false);
  const [searching, setSearching] = useState(false);
  const [scope, setScope] = useState<Scope>('all');
  const [category, setCategory] = useState('');
  // 搭子榜已经并入「我的搭子」：每个组合只能看到自己的积分和名次
  if (rawTab === 'board') return <Navigate to="/buddy" replace />;

  return (
    <div className="mx-auto max-w-[560px]">
      <PageHeader
        title="社区"
        className="mb-3.5!"
        actions={
          <div className="flex items-center gap-2">
            <button type="button" aria-label="搜索帖子" aria-pressed={searching} onClick={() => setSearching((v) => !v)} className={cx('grid size-9 place-items-center rounded-full', searching ? 'bg-ink text-white' : 'bg-surface text-ink')}>
              <SearchIcon size={17} width={2.2} />
            </button>
            <button type="button" aria-label="发布" onClick={() => setComposing(true)} className="grid size-9 place-items-center rounded-full bg-brand text-white">
              <PlusIcon size={16} width={2.4} />
            </button>
          </div>
        }
      />
      {searching ? (
        <PostSearch onClose={() => setSearching(false)} />
      ) : (
        <>
          <SegmentBar label="社区分区" value={tab} items={TABS} onChange={(v) => setParams({ tab: v }, { replace: true })} />
          {tab === 'checkin' && (
            <div className="mt-3">
              <Segmented options={SCOPES} value={scope} onChange={(v) => setScope(v as Scope)} />
            </div>
          )}
          {tab === 'events' && <CategoryChips value={category} onChange={setCategory} />}
          <div className="mt-3.5"><Feed key={`${tab}:${scope}:${category}`} tab={tab} scope={scope} category={category} /></div>
        </>
      )}
      <Compose open={composing} onClose={() => setComposing(false)} />
    </div>
  );
}

function CategoryChips({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const options = [{ value: '', label: '全部' }, ...POST_CATEGORIES.map((c) => ({ value: c.value, label: c.label }))];
  return (
    <div className="-mx-4 mt-3 overflow-x-auto px-4 no-scrollbar">
      <div className="flex w-max gap-2">
        {options.map((o) => (
          <button
            key={o.value || 'all'}
            type="button"
            aria-pressed={value === o.value}
            onClick={() => onChange(o.value)}
            className={cx('h-8 rounded-full px-3.5 text-[14px]', value === o.value ? 'bg-ink font-semibold text-white' : 'bg-surface text-ink-2')}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

async function firstPage(tab: Tab, scope: Scope, category: string): Promise<FeedData> {
  const none = { items: [] as never[], hasMore: false };
  const [posts, checkins, events] = await Promise.all([
    tab === 'all' ? api.forum.posts() : tab === 'share' ? api.forum.posts({ share: true }) : Promise.resolve(none),
    tab === 'all' ? api.checkins.list() : tab === 'checkin' ? api.checkins.list({ scope }) : Promise.resolve(none),
    tab === 'all' ? api.posts().then((r) => r.items.filter((e) => e.status === 'open')) : tab === 'events' ? api.posts({ category }).then((r) => r.items) : Promise.resolve([]),
  ]);
  return { posts: posts.items, postsMore: posts.hasMore, checkins: checkins.items, checkinsMore: checkins.hasMore, events };
}

/**
 * 把帖子、打卡、招募按时间合成一条。还有更早内容没加载的来源，只显示到它已加载的最早时间为止，
 * 免得「加载更多」之后旧内容插到已经看过的内容中间。
 */
function merge(data: FeedData, tab: Tab): Item[] {
  const items: Item[] = [
    ...data.posts.map((post): Item => ({ kind: 'post', at: post.createdAt, post })),
    ...data.checkins.map((checkin): Item => ({ kind: 'checkin', at: checkin.stampedAt, checkin })),
    ...data.events.map((event): Item => ({ kind: 'event', at: event.createdAt, event })),
  ];
  // 招募分区：进行中的在前，已结束的在后
  if (tab === 'events') return items;
  items.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  const cutoffs = [
    data.postsMore && data.posts.length ? Date.parse(data.posts.at(-1)!.createdAt) : -Infinity,
    data.checkinsMore && data.checkins.length ? Date.parse(data.checkins.at(-1)!.stampedAt) : -Infinity,
  ];
  const cutoff = Math.max(...cutoffs);
  return items.filter((it) => Date.parse(it.at) >= cutoff);
}

function Feed({ tab, scope, category }: { tab: Tab; scope: Scope; category: string }) {
  const toast = useToast();
  const { data, error, reload, setData } = useCached(`community:${tab}:${scope}:${category}`, () => firstPage(tab, scope, category));
  const [loadingMore, setLoadingMore] = useState(false);

  const more = async () => {
    if (!data || loadingMore) return;
    setLoadingMore(true);
    try {
      const [posts, checkins] = await Promise.all([
        data.postsMore ? api.forum.posts({ share: tab === 'share' || undefined, before: data.posts.at(-1)?.id }) : null,
        data.checkinsMore ? api.checkins.list({ scope: tab === 'checkin' ? scope : 'all', before: data.checkins.at(-1)?.id }) : null,
      ]);
      setData({
        ...data,
        posts: posts ? [...data.posts, ...posts.items] : data.posts,
        postsMore: posts ? posts.hasMore : data.postsMore,
        checkins: checkins ? [...data.checkins, ...checkins.items] : data.checkins,
        checkinsMore: checkins ? checkins.hasMore : data.checkinsMore,
      });
    } catch (e) {
      toast.error('没有加载成功', errorText(e));
    } finally {
      setLoadingMore(false);
    }
  };

  if (!data && error) return <Empty title="动态暂时没有加载成功" desc={errorText(error)} action={<Button onClick={reload}>重新加载</Button>} />;
  if (!data) return <div className="flex flex-col gap-3">{[0, 1].map((i) => <Skeleton key={i} className="h-56 rounded-[20px]" />)}</div>;
  const items = merge(data, tab);
  if (!items.length) {
    const empty = {
      all: '社区里还没有动态',
      checkin: scope === 'partner' ? '搭子还没有打卡' : scope === 'mine' ? '你还没有打卡' : '还没有打卡',
      share: '还没有学习分享',
      events: category ? '这个分类还没有招募' : '还没有招募',
    }[tab];
    const desc = tab === 'share' ? '已绑定搭子的同学发帖时打开「申请 Bonus」，帖子会带上「学习分享」标签。' : tab === 'checkin' && scope === 'partner' ? '绑定搭子后，这里只显示你搭子的打卡。' : '点右上角的「+」发布第一条。';
    return <Empty title={empty} desc={desc} />;
  }
  return (
    <div className="flex flex-col gap-3">
      {items.map((it) =>
        it.kind === 'post' ? <PostCard key={`p${it.post.id}`} post={it.post} />
          : it.kind === 'checkin' ? <CheckinCard key={`c${it.checkin.id}`} checkin={it.checkin} />
            : <EventCard key={`e${it.event.id}`} event={it.event} />,
      )}
      {(data.postsMore || data.checkinsMore) && (
        <Button className="mx-auto mt-1" loading={loadingMore} onClick={() => void more()}>加载更多</Button>
      )}
    </div>
  );
}

/** 搜索帖子：只检索帖子的标题和正文 */
function PostSearch({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<{ items: ForumPost[]; hasMore: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (q: string, before?: number) => {
    setBusy(true);
    try {
      const r = await api.forum.posts({ q, before });
      setResult((prev) => (before && prev ? { items: [...prev.items, ...r.items], hasMore: r.hasMore } : r));
      setQuery(q);
    } catch (e) {
      toast.error('搜索没有成功', errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <form
        role="search"
        className="flex items-center gap-2"
        onSubmit={(e) => { e.preventDefault(); if (text.trim()) void run(text.trim()); }}
      >
        <Input
          autoFocus
          aria-label="搜索帖子"
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={100}
          enterKeyHint="search"
          placeholder="搜索帖子的标题和正文"
          leading={<SearchIcon size={16} />}
        />
        <button type="button" onClick={onClose} className="h-10 shrink-0 px-1 text-[16px] text-brand-text">取消</button>
      </form>
      <div className="mt-3.5">
        {!result ? (
          <p className="px-1 text-[14px] text-ink-3">{busy ? '正在搜索…' : '输入关键词后按「搜索」。打卡和招募不在搜索范围内。'}</p>
        ) : !result.items.length ? (
          <Empty title="没有找到相关帖子" desc={`没有标题或正文包含「${query}」的帖子。`} />
        ) : (
          <div className="flex flex-col gap-3">
            <p className="px-1 text-[13px] text-ink-3">包含「{query}」的帖子</p>
            {result.items.map((post) => <PostCard key={post.id} post={post} />)}
            {result.hasMore && <Button className="mx-auto" loading={busy} onClick={() => void run(query, result.items.at(-1)?.id)}>加载更多</Button>}
          </div>
        )}
      </div>
    </div>
  );
}

function Author({ name, cover, meta }: { name: string; cover: string | null; meta: string }) {
  return (
    <div className="flex items-center gap-2.5 px-3.5 py-3">
      <Plate nickname={name} photo={cover} className="size-[34px] shrink-0 overflow-hidden rounded-full bg-mat" pad="0" fit="cover" />
      <div className="flex min-w-0 flex-col">
        <span className="truncate text-[15px] font-semibold text-ink">{name}</span>
        <span className="truncate text-[12px] text-ink-3">{meta}</span>
      </div>
    </div>
  );
}

function Counts({ likes, comments }: { likes: number; comments: number }) {
  return (
    <div className="flex items-center gap-[18px] px-3.5 py-2.5 text-[14px] text-ink-3">
      <span className="flex items-center gap-[5px]"><HeartIcon size={18} />{likes}</span>
      <span className="flex items-center gap-[5px]"><BubbleIcon size={18} />{comments}</span>
    </div>
  );
}

function CheckinCard({ checkin }: { checkin: Checkin }) {
  return (
    <Link to={`/community/checkins/${checkin.id}`} className="block overflow-hidden rounded-[20px] bg-surface">
      <Author name={checkin.author.nickname} cover={checkin.author.cover} meta={`打卡 · ${checkin.placeLabel} · ${timeAgo(checkin.stampedAt)}`} />
      <img src={fileUrl(checkin.image)} alt={checkin.caption || `${checkin.author.nickname} 的打卡照片`} loading="lazy" className="block h-[200px] w-full bg-mat object-cover" />
      {checkin.caption && <p className="px-3.5 pt-2.5 text-[15px] leading-relaxed text-ink">{checkin.caption}</p>}
      <Counts likes={checkin.likeCount} comments={checkin.commentCount} />
    </Link>
  );
}

function PostCard({ post }: { post: ForumPost }) {
  return (
    <Link to={`/community/posts/${post.id}`} className="block overflow-hidden rounded-[20px] bg-surface">
      <div className="flex items-center justify-between gap-2 pr-3.5">
        <Author name={post.author.nickname} cover={post.author.cover} meta={`${post.share ? '学习分享' : '帖子'} · ${timeAgo(post.createdAt)}`} />
        <ShareBadge post={post} />
      </div>
      {post.images[0] && <img src={fileUrl(post.images[0])} alt="" loading="lazy" className="block h-[200px] w-full bg-mat object-cover" />}
      <div className="px-3.5 pt-2.5">
        <p className="text-[17px] leading-[23px] font-semibold text-ink">{post.title}</p>
        {post.body && <p className="mt-1 line-clamp-3 text-[15px] leading-relaxed text-ink-2">{post.body}</p>}
      </div>
      <Counts likes={post.likeCount} comments={post.commentCount} />
    </Link>
  );
}

function EventCard({ event }: { event: Post }) {
  const toast = useToast();
  const nav = useNavigate();
  const [interested, setInterested] = useState(event.interested);
  const [count, setCount] = useState(event.interestCount);
  const [busy, setBusy] = useState(false);
  const toggle = async () => {
    setBusy(true);
    try {
      const r = await api.interest(event.id);
      setInterested(r.interested);
      setCount(r.interestCount);
    } catch (e) {
      toast.error('操作没有成功', errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <article className="flex flex-col gap-2.5 rounded-[20px] bg-surface p-3.5">
      <button type="button" onClick={() => nav(`/events/${event.id}`)} className="flex flex-col gap-2.5 text-left">
        <span className="flex items-center gap-2">
          <span className="rounded-md bg-brand-soft px-[7px] py-[3px] text-[12px] font-semibold text-brand-text">招募</span>
          {event.status !== 'open' && <span className="rounded-md bg-paper-2 px-[7px] py-[3px] text-[12px] font-semibold text-ink-3">已结束</span>}
          <span className="truncate text-[12px] text-ink-3">{[event.timeText, event.location].filter(Boolean).join(' · ')}</span>
        </span>
        <span className="text-[17px] leading-[23px] font-semibold text-ink">{event.title}</span>
      </button>
      <div className="flex items-center justify-between gap-3">
        <span className="flex min-w-0 items-center gap-2">
          <Plate nickname={event.author.nickname} photo={event.author.cover} className="size-6 shrink-0 overflow-hidden rounded-full bg-mat" pad="0" fit="cover" />
          <span className="truncate text-[13px] text-ink-3">{event.author.nickname} · {count} 人感兴趣{event.capacity ? ` · 计划 ${event.capacity} 人` : ''}</span>
        </span>
        {!event.isMine && event.status === 'open' && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void toggle()}
            className={interested ? 'h-8 shrink-0 rounded-full bg-paper-2 px-4 text-[14px] font-semibold text-ink-2' : 'h-8 shrink-0 rounded-full bg-brand px-4 text-[14px] font-semibold text-white'}
          >
            {interested ? '已感兴趣' : '感兴趣'}
          </button>
        )}
      </div>
    </article>
  );
}

/** 「+」：发帖子、拍照打卡、发起招募 */
function Compose({ open, onClose }: { open: boolean; onClose: () => void }) {
  const nav = useNavigate();
  const [writing, setWriting] = useState(false);
  const [busy, setBusy] = useState(false);
  const options = [
    { icon: <CommunityIcon size={22} />, label: '发帖子', desc: '分享校园生活、学习心得', run: () => { onClose(); setWriting(true); } },
    { icon: <CameraIcon size={22} />, label: '拍照打卡', desc: '现场拍摄，服务器盖章', run: () => { onClose(); nav('/community/checkin/new'); } },
    { icon: <PeopleIcon size={22} />, label: '发起招募', desc: '约同学一起学习', run: () => { onClose(); nav('/events/new'); } },
  ];
  return (
    <>
      <Modal open={open} onClose={onClose} title="发布" size="sm">
        <div className="px-4 pt-1 pb-5">
          <div className="overflow-hidden rounded-2xl bg-paper [&>*+*]:border-t-[0.5px] [&>*+*]:border-line">
            {options.map((o) => (
              <button key={o.label} type="button" onClick={o.run} className="flex w-full items-center gap-3 px-4 py-3 text-left">
                <span className="text-brand-text">{o.icon}</span>
                <span className="flex flex-col">
                  <span className="text-[17px] text-ink">{o.label}</span>
                  <span className="text-[13px] text-ink-3">{o.desc}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      </Modal>
      <Modal open={writing} onClose={() => !busy && setWriting(false)} dismissible={!busy} title="发帖子" size="lg">
        <div className="px-5 pt-2 pb-5 sm:px-6 sm:pb-6">
          <PostComposer onDone={(post) => { setWriting(false); nav(`/community/posts/${post.id}`); }} onCancel={() => setWriting(false)} onBusyChange={setBusy} />
        </div>
      </Modal>
    </>
  );
}
