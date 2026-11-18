import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { BellIcon, BubbleIcon, Chevron, HeartFill, SearchIcon } from '../components/icons';
import type { ChatSummary, IncomingInterest } from '../../shared/types';
import { api, ApiError } from '../lib/api';
import { cx, timeAgo } from '../lib/format';
import { Empty, GroupList, PageHeader } from '../components/ui';
import { useAuth } from '../lib/auth';
import { Illustration, Plate } from '../components/brand';
import { NavBar } from '../components/Shell';
import { ChatWindow } from '../components/chat/ChatWindow';
import { ConversationList } from '../components/chat/ConversationList';

/** 页面可见时每 15 秒刷新一次会话列表 */
const LIST_POLL_MS = 15_000;

/**
 * 私聊：桌面端左右分栏（会话列表 + 聊天窗）；手机端按路由切换（/messages 列表，/messages/:id 聊天）。
 * /messages/requests 是联系请求列表（对我感兴趣的同学、交换联系方式的申请），和聊天窗占同一个位置。只有互相感兴趣的两人才有会话。
 */
export function Messages() {
  const { matchId: param } = useParams();
  const nav = useNavigate();
  const { user } = useAuth();
  const matchId = param && /^\d{1,15}$/.test(param) ? Number(param) : null;
  const requestsOpen = param === 'requests';
  const chatOpen = param !== undefined;
  const [items, setItems] = useState<ChatSummary[] | null>(null);
  const [likes, setLikes] = useState<IncomingInterest[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const loading = useRef(false);
  const queued = useRef<number | undefined>(undefined);

  const load = useCallback(async () => {
    if (loading.current) return;
    loading.current = true;
    try {
      const [result, incoming] = await Promise.all([api.chat.list(), api.match.incoming()]);
      setItems(result.items);
      setLikes(incoming.items);
      setError(null);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : '会话列表加载失败，请稍后重试');
    } finally {
      loading.current = false;
    }
  }, []);

  // 聊天窗里有新消息、已读、解除等变化时，稍后合并刷新一次列表
  const scheduleReload = useCallback(() => {
    if (queued.current !== undefined) return;
    queued.current = window.setTimeout(() => {
      queued.current = undefined;
      void load();
    }, 600);
  }, [load]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void load(); }, LIST_POLL_MS);
    const onVisibility = () => { if (document.visibilityState === 'visible') void load(); };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
      if (queued.current !== undefined) window.clearTimeout(queued.current);
      queued.current = undefined;
    };
  }, [load]);

  const onGone = useCallback(() => {
    nav('/messages', { replace: true });
    void load();
  }, [nav, load]);

  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const shown = items && q
    ? items.filter((i) => [i.other.nickname, i.other.privateNote?.remarkName ?? '', i.lastMessage?.body ?? ''].some((t) => t.toLowerCase().includes(q)))
    : items;
  // 联系请求：对我选了「感兴趣」等我回应的同学，以及对方申请交换联系方式、还没回应的聊天
  const requests = items?.filter((i) => i.status === 'active' && i.contactState === 'pending_incoming') ?? [];
  const requestCount = requests.length + (likes?.length ?? 0);

  return (
    // 手机端：列表正常排版，聊天窗固定铺满（自带顶栏）；桌面端：左栏列表 + 右侧聊天，占满一屏
    <div className="md:-mx-10 md:-mb-12 md:flex md:h-dvh md:min-h-[540px]">
      <section aria-label="会话列表" className={cx('flex flex-col md:w-[340px] md:shrink-0 md:overflow-y-auto md:border-r-[0.5px] md:border-line md:px-3 md:pb-6', chatOpen && 'hidden md:flex')}>
        <PageHeader title="消息" className="mb-3! md:px-1" />
        <label className="flex h-[38px] items-center gap-1.5 rounded-[11px] bg-paper-2 px-2.5">
          <SearchIcon size={16} width={2.4} className="shrink-0 text-ink-3" />
          <span className="sr-only">搜索消息</span>
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索" className="min-w-0 flex-1 bg-transparent text-[17px] text-ink outline-none md:text-[15px]" />
        </label>

        <div className="mt-4 flex flex-col gap-4">
          <GroupList>
            <Link to="/messages/requests" aria-current={requestsOpen ? 'page' : undefined} className={cx('flex h-[52px] items-center gap-3 px-4 text-ink', requestsOpen && 'md:bg-brand-softer')}>
              <span className="grid size-[30px] place-items-center rounded-lg bg-brand text-white"><HeartFill size={18} /></span>
              <span className="flex-1 text-[17px]">联系请求</span>
              {requestCount > 0 && <span className="text-[15px] text-ink-3 tabular">{requestCount}</span>}
              <Chevron />
            </Link>
            <Link to="/me/notifications" className="flex h-[52px] items-center gap-3 px-4 text-ink">
              <span className="grid size-[30px] place-items-center rounded-lg bg-accent text-white"><BellIcon size={18} width={2} /></span>
              <span className="flex-1 text-[17px]">通知</span>
              {!!user?.unread && <span className="text-[15px] text-ink-3 tabular">{user.unread > 99 ? '99+' : user.unread}</span>}
              <Chevron />
            </Link>
          </GroupList>

          {items !== null && items.length === 0 ? (
            <Empty
              art={<Illustration name="mascot-empty" className="mb-4 size-24" />}
              title="还没有可以聊天的同学"
              desc="在「找搭子」里互相点了感兴趣，就能在这里聊天。"
              action={<Link to="/match" className="inline-flex h-10 items-center rounded-full bg-brand px-5 text-[15px] font-semibold text-white">去找搭子</Link>}
            />
          ) : (
            <>
              <div className="md:hidden"><ConversationList items={shown} activeId={matchId} error={error} onRetry={() => void load()} /></div>
              <div className="hidden md:block"><ConversationList compact items={shown} activeId={matchId} error={error} onRetry={() => void load()} /></div>
            </>
          )}
        </div>
      </section>

      <section className={cx('md:flex md:min-w-0 md:flex-1 md:flex-col md:bg-surface', !chatOpen && 'hidden md:flex')} aria-label="聊天">
        {chatOpen ? (
          <div className="fixed inset-0 z-30 flex flex-col bg-paper pt-[env(safe-area-inset-top)] md:static md:z-auto md:h-full md:min-h-0 md:flex-1 md:bg-surface md:pt-0">
            {requestsOpen
              ? <ContactRequestList likes={likes} items={items && requests} error={error} onRetry={() => void load()} />
              : matchId !== null
                ? <ChatWindow key={matchId} matchId={matchId} onActivity={scheduleReload} onGone={onGone} />
                : <NotFoundChat />}
          </div>
        ) : (
          <div className="grid flex-1 place-items-center p-8 text-center">
            <div>
              <BubbleIcon size={30} className="mx-auto text-ink-4" />
              <p className="mt-3 text-[17px] font-semibold text-ink-2">选择一段聊天</p>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

/**
 * 联系请求：对我选了「感兴趣」的同学（点开主页回应），以及对方申请交换联系方式、等我回应的聊天（点开进入聊天，在顶部同意或拒绝）
 */
function ContactRequestList({ likes, items, error, onRetry }: { likes: IncomingInterest[] | null; items: ChatSummary[] | null; error: string | null; onRetry: () => void }) {
  const loaded = likes !== null && items !== null;
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-[calc(env(safe-area-inset-bottom)+20px)] md:px-8 md:pb-8">
      <NavBar label="消息" to="/messages" className="md:hidden" />
      <h1 className="mt-1 text-[28px] leading-[34px] font-bold text-ink md:mt-10">联系请求</h1>
      <p className="mt-1.5 mb-4 text-[15px] text-ink-3">对你感兴趣的同学，和申请与你交换联系方式的同学，都在这里等你回应。</p>
      <div className="flex flex-col gap-5 md:max-w-[560px]">
        {!loaded ? (
          <ConversationList items={null} activeId={null} error={error} onRetry={onRetry} />
        ) : likes.length + items.length === 0 ? (
          <p className="rounded-2xl bg-surface px-4 py-6 text-center text-[15px] text-ink-3 md:bg-paper">现在没有等你回应的联系请求</p>
        ) : (
          <>
            {likes.length > 0 && (
              <section aria-labelledby="requests-likes">
                <h2 id="requests-likes" className="mb-2 px-1 text-[13px] font-semibold text-ink-3">对你感兴趣</h2>
                <ul className="overflow-hidden rounded-2xl bg-surface md:overflow-visible md:rounded-none md:bg-transparent [&>li+li]:border-t-[0.5px] [&>li+li]:border-line md:[&>li+li]:border-0">
                  {likes.map((item) => (
                    <li key={item.user.id}>
                      <Link to={`/u/${item.user.id}`} className="flex items-center gap-3 px-4 py-3 active:bg-paper md:rounded-xl md:p-2.5 md:hover:bg-ink/[.04]">
                        <Plate nickname={item.user.nickname} photo={item.user.cover} className="size-[50px] shrink-0 overflow-hidden rounded-full bg-mat md:size-[42px]" pad="0" fit="cover" />
                        <span className="flex min-w-0 flex-1 flex-col gap-[3px]">
                          <span className="truncate text-[17px] font-semibold text-ink md:text-[15px]">{item.user.nickname}</span>
                          <span className="truncate text-[15px] text-ink-3 md:text-[13px]">{timeAgo(item.createdAt)}对你表示感兴趣</span>
                        </span>
                        <Chevron />
                      </Link>
                    </li>
                  ))}
                </ul>
                <p className="mt-2 px-1 text-[13px] text-ink-3">点开主页看看 TA；你也选「感兴趣」就可以开始私聊，选「不感兴趣」对方不会收到提示。</p>
              </section>
            )}
            {items.length > 0 && (
              <section aria-labelledby="requests-contacts">
                <h2 id="requests-contacts" className="mb-2 px-1 text-[13px] font-semibold text-ink-3">申请交换联系方式</h2>
                <div className="md:hidden"><ConversationList items={items} activeId={null} error={error} onRetry={onRetry} /></div>
                <div className="hidden md:block"><ConversationList compact items={items} activeId={null} error={error} onRetry={onRetry} /></div>
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function NotFoundChat() {
  return (
    <div className="grid h-full place-items-center p-6 text-center">
      <div>
        <p className="font-display text-[20px] text-ink">这段聊天不存在</p>
        <Link to="/messages" className="mt-4 inline-block text-[14px] text-brand-text underline">返回私聊列表</Link>
      </div>
    </div>
  );
}
