import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import type { Checkin, ForumPost, Post } from '../../shared/types';
import { api, ApiError, fileUrl } from '../lib/api';
import { timeAgo } from '../lib/format';
import { useToast } from '../lib/toast';
import { Button, Empty, Modal, PageHeader, SegmentBar, Skeleton } from '../components/ui';
import { Plate } from '../components/brand';
import { Leaderboard } from '../components/buddy/Leaderboard';
import { PostComposer } from '../components/forum/PostComposer';
import { BubbleIcon, CameraIcon, CommunityIcon, HeartIcon, PlusIcon, PeopleIcon } from '../components/icons';

type Tab = 'all' | 'checkin' | 'events' | 'board';
const TABS: { value: Tab; label: string }[] = [
  { value: 'all', label: '全部' },
  { value: 'checkin', label: '打卡' },
  { value: 'events', label: '招募' },
  { value: 'board', label: '搭子榜' },
];
// 旧链接 ?tab=talk 指向「全部」
const parseTab = (v: string | null): Tab => (TABS.some((t) => t.value === v) ? (v as Tab) : 'all');
const errorText = (e: unknown) => (e instanceof ApiError ? e.message : '网络连接失败，请稍后重试');

type Item =
  | { kind: 'post'; at: string; post: ForumPost }
  | { kind: 'checkin'; at: string; checkin: Checkin }
  | { kind: 'event'; at: string; event: Post };

/** 社区：帖子、打卡和招募按时间排成一条动态，另有搭子榜 */
export function Community() {
  const [params, setParams] = useSearchParams();
  const tab = parseTab(params.get('tab'));
  const [composing, setComposing] = useState(false);

  return (
    <div className="mx-auto max-w-[560px]">
      <PageHeader
        title="社区"
        className="mb-3.5!"
        actions={
          <button type="button" aria-label="发布" onClick={() => setComposing(true)} className="grid size-9 place-items-center rounded-full bg-brand text-white">
            <PlusIcon size={16} width={2.4} />
          </button>
        }
      />
      <SegmentBar label="社区分区" value={tab} items={TABS} onChange={(v) => setParams({ tab: v }, { replace: true })} />
      <div className="mt-3.5">{tab === 'board' ? <Leaderboard /> : <Feed key={tab} tab={tab} />}</div>
      <Compose open={composing} onClose={() => setComposing(false)} />
    </div>
  );
}

function Feed({ tab }: { tab: Exclude<Tab, 'board'> }) {
  const [items, setItems] = useState<Item[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let live = true;
    setError(null);
    const posts = tab === 'all' ? api.forum.posts().then((r) => r.items.map((post): Item => ({ kind: 'post', at: post.createdAt, post }))) : Promise.resolve([]);
    const checkins = tab !== 'events' ? api.checkins.list().then((r) => r.items.map((checkin): Item => ({ kind: 'checkin', at: checkin.stampedAt, checkin }))) : Promise.resolve([]);
    const events = tab !== 'checkin' ? api.posts().then((r) => r.items.filter((e) => e.status === 'open').map((event): Item => ({ kind: 'event', at: event.createdAt, event }))) : Promise.resolve([]);
    Promise.all([posts, checkins, events])
      .then((groups) => { if (live) setItems(groups.flat().sort((a, b) => Date.parse(b.at) - Date.parse(a.at))); })
      .catch((e) => { if (live) setError(errorText(e)); });
    return () => { live = false; };
  }, [tab, version]);

  if (error) return <Empty title="动态暂时没有加载成功" desc={error} action={<Button onClick={() => setVersion((v) => v + 1)}>重新加载</Button>} />;
  if (!items) return <div className="flex flex-col gap-3">{[0, 1].map((i) => <Skeleton key={i} className="h-56 rounded-[20px]" />)}</div>;
  if (!items.length) {
    return <Empty title={tab === 'checkin' ? '还没有打卡' : tab === 'events' ? '还没有进行中的招募' : '社区里还没有动态'} desc="点右上角的「+」发布第一条。" />;
  }
  return (
    <div className="flex flex-col gap-3">
      {items.map((it) =>
        it.kind === 'post' ? <PostCard key={`p${it.post.id}`} post={it.post} />
          : it.kind === 'checkin' ? <CheckinCard key={`c${it.checkin.id}`} checkin={it.checkin} />
            : <EventCard key={`e${it.event.id}`} event={it.event} />,
      )}
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
      <Author name={post.author.nickname} cover={post.author.cover} meta={`帖子 · ${timeAgo(post.createdAt)}`} />
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
          <span className="truncate text-[12px] text-ink-3">{[event.timeText, event.location].filter(Boolean).join(' · ')}</span>
        </span>
        <span className="text-[17px] leading-[23px] font-semibold text-ink">{event.title}</span>
      </button>
      <div className="flex items-center justify-between gap-3">
        <span className="flex min-w-0 items-center gap-2">
          <Plate nickname={event.author.nickname} photo={event.author.cover} className="size-6 shrink-0 overflow-hidden rounded-full bg-mat" pad="0" fit="cover" />
          <span className="truncate text-[13px] text-ink-3">{event.author.nickname} · 已报名 {count}{event.capacity ? ` / ${event.capacity}` : ''}</span>
        </span>
        {!event.isMine && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void toggle()}
            className={interested ? 'h-8 shrink-0 rounded-full bg-paper-2 px-4 text-[14px] font-semibold text-ink-2' : 'h-8 shrink-0 rounded-full bg-brand px-4 text-[14px] font-semibold text-white'}
          >
            {interested ? '已报名' : '报名'}
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
