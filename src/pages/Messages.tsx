import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { MessageCircle } from 'lucide-react';
import type { ChatSummary } from '../../shared/types';
import { api, ApiError } from '../lib/api';
import { cx } from '../lib/format';
import { Empty } from '../components/ui';
import { Illustration } from '../components/brand';
import { ChatWindow } from '../components/chat/ChatWindow';
import { ConversationList } from '../components/chat/ConversationList';

/** 页面可见时每 15 秒刷新一次会话列表 */
const LIST_POLL_MS = 15_000;

/**
 * 私聊：桌面端左右分栏（会话列表 + 聊天窗）；手机端按路由切换（/messages 列表，/messages/:id 聊天）。
 * 只有互相感兴趣的两人才有会话。
 */
export function Messages() {
  const { matchId: param } = useParams();
  const nav = useNavigate();
  const matchId = param && /^\d{1,15}$/.test(param) ? Number(param) : null;
  const chatOpen = param !== undefined;
  const [items, setItems] = useState<ChatSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const loading = useRef(false);
  const queued = useRef<number | undefined>(undefined);

  const load = useCallback(async () => {
    if (loading.current) return;
    loading.current = true;
    try {
      const result = await api.chat.list();
      setItems(result.items);
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

  const empty = items !== null && items.length === 0 && !chatOpen;

  return (
    // 桌面端占满一屏（抵消外层底部留白），两栏各自滚动；手机端列表正常排版，聊天窗固定在顶栏与标签栏之间
    <div className="md:-mb-24 md:flex md:h-[calc(100dvh-57px)] md:min-h-[540px] md:flex-col">
      <header className={cx('mb-4 border-b border-ink pt-5 pb-4 sm:pt-10 sm:pb-5 md:mb-5 md:shrink-0 md:pt-8', chatOpen && 'hidden md:block')}>
        <h1 className="font-display text-[30px] leading-[1.1] tracking-[-0.02em] text-ink sm:text-[40px]">私聊</h1>
        <p className="mt-2 text-[14px] text-ink-2 sm:text-[15px]">只有互相感兴趣的同学才能私聊。聊得合适，再在聊天里决定是否交换联系方式。</p>
      </header>

      {empty ? (
        <Empty
          art={<Illustration name="mascot-empty" className="mb-4 size-24" />}
          title="还没有互相感兴趣的同学"
          desc="去匹配推荐看看：你们都点了「感兴趣」，就能在这里聊天。"
          action={<Link to="/match" className="inline-flex h-10 items-center rounded-md bg-brand px-4 text-[14px] font-semibold text-white hover:bg-brand-2">去匹配推荐</Link>}
        />
      ) : (
        <div className="md:flex md:min-h-0 md:flex-1 md:overflow-hidden md:rounded-md md:border md:border-line md:bg-surface md:mb-6">
          <aside className={cx('overflow-hidden rounded-md border border-line bg-surface md:w-[320px] md:shrink-0 md:overflow-y-auto md:rounded-none md:border-0 md:border-r lg:w-[360px]', chatOpen && 'hidden md:block')}>
            <ConversationList items={items} activeId={matchId} error={error} onRetry={() => void load()} />
          </aside>
          <section className={cx('md:flex md:min-w-0 md:flex-1 md:flex-col', !chatOpen && 'hidden md:flex')} aria-label="聊天">
            {chatOpen ? (
              <div className="fixed inset-x-0 top-[57px] bottom-[calc(58px+env(safe-area-inset-bottom))] z-30 flex flex-col bg-paper md:static md:z-auto md:h-full md:min-h-0 md:flex-1">
                {matchId !== null
                  ? <ChatWindow key={matchId} matchId={matchId} onActivity={scheduleReload} onGone={onGone} />
                  : <NotFoundChat />}
              </div>
            ) : (
              <div className="grid flex-1 place-items-center bg-paper p-8 text-center">
                <div>
                  <MessageCircle size={30} strokeWidth={1.5} className="mx-auto text-ink-4" aria-hidden />
                  <p className="mt-3 font-display text-[18px] text-ink-2">选择一段聊天</p>
                  <p className="mt-1 text-[13.5px] text-ink-3">左侧是和你互相感兴趣的同学。</p>
                </div>
              </div>
            )}
          </section>
        </div>
      )}
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
