import { AnimatePresence } from 'motion/react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { ArrowDown, ChevronLeft, Copy, Flag, HeartOff, UserRound, UserRoundX } from 'lucide-react';
import type { ChatMessage, ChatSummary } from '../../../shared/types';
import { api, ApiError } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useToast } from '../../lib/toast';
import { Button, ConfirmDialog, Modal, Skeleton } from '../ui';
import { ReportDialog } from '../moderation';
import { ProfileOverlay } from '../ProfileOverlay';
import { ChatAvatar } from './ChatAvatar';
import { ChatMenu, type ChatMenuItem } from './ChatMenu';
import { Composer } from './Composer';
import { ContactCard } from './ContactCard';
import { MessageBubble, SystemNote } from './MessageBubble';
import { needsSeparator, separatorTime } from './format';

/** 页面可见时每 4 秒拉一次新消息 */
const POLL_MS = 4000;
const errorText = (cause: unknown) => (cause instanceof ApiError ? cause.message : '网络连接失败，请稍后重试');

type Pending = { key: number; body: string; createdAt: string };

/** 合并消息：按 id 去重并升序 */
function merge(list: ChatMessage[], incoming: ChatMessage[]) {
  if (!incoming.length) return list;
  const byId = new Map(list.map((m) => [m.id, m]));
  for (const m of incoming) byId.set(m.id, m);
  return [...byId.values()].sort((a, b) => a.id - b.id);
}

/**
 * 一段私聊：顶部对方昵称（点开主页）与更多菜单，交换联系方式卡片，消息列表（向上翻页、轮询新消息），输入框。
 * 父组件按 matchId 设置 key，切换会话时整体重建。
 */
export function ChatWindow({ matchId, onActivity, onGone }: {
  matchId: number;
  /** 会话有变化（新消息、已读、解除）时通知父组件刷新会话列表 */
  onActivity: () => void;
  /** 排除对方后，这段聊天不再可见 */
  onGone: () => void;
}) {
  const { refresh } = useAuth();
  const toast = useToast();
  const [summary, setSummary] = useState<ChatSummary | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [hasOlder, setHasOlder] = useState(false);
  const [phase, setPhase] = useState<'loading' | 'ready' | 'missing' | 'error'>('loading');
  const [loadError, setLoadError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [pending, setPending] = useState<Pending[]>([]);
  const [olderBusy, setOlderBusy] = useState(false);
  const [newBelow, setNewBelow] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [report, setReport] = useState<{ type: 'message' | 'profile'; id: number }>({ type: 'profile', id: 0 });
  const [reportOpen, setReportOpen] = useState(false);
  const [sheet, setSheet] = useState<ChatMessage | null>(null);
  const [confirm, setConfirm] = useState<'close' | 'exclude' | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);

  const scroller = useRef<HTMLDivElement>(null);
  /** 下一次渲染后如何调整滚动位置：贴底，或在顶部插入旧消息后保持原位 */
  const anchor = useRef<'bottom' | { height: number; top: number } | null>(null);
  /** 用户是否停在底部附近（容器尺寸变化时保持贴底） */
  const stick = useRef(true);
  /** 已从服务器连续取到的最大消息 id；轮询从这里继续，避免漏掉发送期间对方发来的消息 */
  const cursor = useRef(0);
  /** 已上报为已读的最大消息 id */
  const readUpTo = useRef(0);
  const sending = useRef(0);
  const polling = useRef(false);
  const olderLoading = useRef(false);
  const alive = useRef(true);
  const tempKey = useRef(0);
  const messagesRef = useRef<ChatMessage[]>([]);
  const onActivityRef = useRef(onActivity);
  useLayoutEffect(() => { messagesRef.current = messages; }, [messages]);
  useEffect(() => { onActivityRef.current = onActivity; }, [onActivity]);
  const closeProfile = useCallback(() => setProfileOpen(false), []);

  const nearBottom = () => {
    const el = scroller.current;
    return !el || el.scrollHeight - el.scrollTop - el.clientHeight < 96;
  };

  // ---------- 首次加载 ----------
  useEffect(() => {
    alive.current = true;
    api.chat.messages(matchId).then((r) => {
      if (!alive.current) return;
      anchor.current = 'bottom';
      stick.current = true;
      cursor.current = r.messages.at(-1)?.id ?? 0;
      // 没有未读时不必再上报已读
      if (r.summary.unread === 0) readUpTo.current = cursor.current;
      setSummary(r.summary);
      setMessages(r.messages);
      setHasOlder(r.hasMore);
      setPhase('ready');
    }).catch((cause) => {
      if (!alive.current) return;
      if (cause instanceof ApiError && cause.status === 404) setPhase('missing');
      else { setLoadError(errorText(cause)); setPhase('error'); }
    });
    return () => { alive.current = false; };
  }, [matchId, attempt]);

  // ---------- 轮询新消息 ----------
  const poll = useCallback(async () => {
    if (polling.current || sending.current > 0 || !alive.current) return;
    polling.current = true;
    try {
      for (let round = 0; round < 5; round++) {
        const r = await api.chat.messages(matchId, { after: cursor.current });
        if (!alive.current) return;
        // 摘要没变时保持原对象，避免每次轮询都重新渲染
        setSummary((prev) => (prev && JSON.stringify(prev) === JSON.stringify(r.summary) ? prev : r.summary));
        if (r.messages.length) {
          cursor.current = r.messages.at(-1)!.id;
          const known = new Set(messagesRef.current.map((m) => m.id));
          const fresh = r.messages.filter((m) => !known.has(m.id));
          if (fresh.length) {
            if (nearBottom()) anchor.current = 'bottom';
            else if (fresh.some((m) => !m.mine)) setNewBelow(true);
            setMessages((list) => merge(list, r.messages));
            onActivityRef.current();
          }
        }
        if (!r.hasMore) break;
      }
    } catch (cause) {
      // 被对方排除等情况：会话不再可见。网络错误则等下一轮重试
      if (alive.current && cause instanceof ApiError && cause.status === 404) {
        setPhase('missing');
        onActivityRef.current();
      }
    } finally {
      polling.current = false;
    }
  }, [matchId]);

  // ---------- 已读 ----------
  const markRead = useCallback(() => {
    if (document.visibilityState !== 'visible') return;
    const list = messagesRef.current;
    const lastIncoming = list.reduce((max, m) => (!m.mine && m.kind === 'text' && m.id > max ? m.id : max), 0);
    if (lastIncoming <= readUpTo.current) return;
    const lastId = list.at(-1)!.id;
    readUpTo.current = lastId;
    api.chat.read(matchId, lastId).then(() => {
      if (!alive.current) return;
      void refresh();
      onActivityRef.current();
    }).catch(() => { readUpTo.current = 0; });
  }, [matchId, refresh]);

  useEffect(() => { if (phase === 'ready') markRead(); }, [phase, messages, markRead]);

  useEffect(() => {
    if (phase !== 'ready') return;
    let stopped = false;
    let timer = 0;
    const loop = () => {
      timer = window.setTimeout(async () => {
        if (document.visibilityState === 'visible') await poll();
        if (!stopped) loop();
      }, POLL_MS);
    };
    loop();
    const onVisibility = () => {
      if (document.visibilityState !== 'visible') return;
      markRead();
      void poll();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [phase, poll, markRead]);

  // ---------- 滚动 ----------
  useLayoutEffect(() => {
    const el = scroller.current;
    const a = anchor.current;
    if (!el || !a) return;
    anchor.current = null;
    el.scrollTop = a === 'bottom' ? el.scrollHeight : el.scrollHeight - a.height + a.top;
  }, [messages, pending, phase]);

  // 键盘弹出、联系方式卡片展开等改变可视高度时，停在底部的用户继续贴底
  useEffect(() => {
    const el = scroller.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => { if (stick.current) el.scrollTop = el.scrollHeight; });
    observer.observe(el);
    return () => observer.disconnect();
  }, [phase]);

  const loadOlder = useCallback(async () => {
    const first = messagesRef.current[0];
    if (!first || olderLoading.current) return;
    olderLoading.current = true;
    setOlderBusy(true);
    try {
      const r = await api.chat.messages(matchId, { before: first.id });
      if (!alive.current) return;
      const el = scroller.current;
      if (el) anchor.current = { height: el.scrollHeight, top: el.scrollTop };
      setMessages((list) => merge(list, r.messages));
      setHasOlder(r.hasMore);
    } catch (cause) {
      if (alive.current) toast.error('加载失败', errorText(cause));
    } finally {
      olderLoading.current = false;
      if (alive.current) setOlderBusy(false);
    }
  }, [matchId, toast]);

  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    stick.current = nearBottom();
    if (stick.current) setNewBelow(false);
    if (el.scrollTop < 60 && hasOlder) void loadOlder();
  };

  const scrollToBottom = () => {
    const el = scroller.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    stick.current = true;
    setNewBelow(false);
  };

  // ---------- 发送 ----------
  const send = async (body: string): Promise<boolean> => {
    const key = ++tempKey.current;
    anchor.current = 'bottom';
    stick.current = true;
    setNewBelow(false);
    setPending((list) => [...list, { key, body, createdAt: new Date().toISOString() }]);
    sending.current += 1;
    let ok = false;
    try {
      const r = await api.chat.send(matchId, body);
      if (alive.current) {
        anchor.current = 'bottom';
        setMessages((list) => merge(list, [r.message]));
      }
      ok = true;
    } catch (cause) {
      if (alive.current) toast.error('发送失败', errorText(cause));
    } finally {
      sending.current -= 1;
      if (alive.current) {
        setPending((list) => list.filter((item) => item.key !== key));
        // 补上发送期间对方发来的消息，并刷新配对状态（例如已被解除）
        void poll();
        onActivityRef.current();
      }
    }
    return ok;
  };

  const openReport = (type: 'message' | 'profile', id: number) => {
    setReport({ type, id });
    setReportOpen(true);
  };

  const copy = async (text: string) => {
    try {
      if (!navigator.clipboard) throw new Error('clipboard unavailable');
      await navigator.clipboard.writeText(text);
      toast.success('已复制');
    } catch {
      toast.error('复制失败', '请在电脑上选中文字复制');
    }
  };

  const closeMatch = async () => {
    setConfirmBusy(true);
    try {
      await api.chat.close(matchId);
      if (!alive.current) return;
      setSummary((s) => (s ? { ...s, status: 'closed' } : s));
      setConfirm(null);
      toast.success('已解除配对');
      void poll();
      onActivityRef.current();
    } catch (cause) {
      toast.error('操作失败', errorText(cause));
    } finally {
      if (alive.current) setConfirmBusy(false);
    }
  };

  const exclude = async () => {
    if (!summary) return;
    setConfirmBusy(true);
    try {
      await api.excludeConnection(summary.other.id);
      if (!alive.current) return;
      setConfirm(null);
      toast.success('已排除这位同学', '对方不会收到提示，可以在「我的」中取消排除');
      onGone();
    } catch (cause) {
      toast.error('操作失败', errorText(cause));
    } finally {
      if (alive.current) setConfirmBusy(false);
    }
  };

  // ---------- 渲染 ----------
  if (phase === 'loading') {
    return (
      <div className="flex h-full min-h-0 flex-col" aria-busy="true">
        <div className="flex h-14 shrink-0 items-center gap-3 border-b border-line bg-surface px-4"><Skeleton className="size-9" /><Skeleton className="h-4 w-32" /></div>
        <div className="flex-1 space-y-3 bg-paper p-4">
          <Skeleton className="h-10 w-2/5" /><Skeleton className="ml-auto h-10 w-1/2" /><Skeleton className="h-14 w-3/5" />
        </div>
      </div>
    );
  }
  if (phase === 'missing' || phase === 'error' || !summary) {
    return (
      <div className="grid h-full place-items-center bg-paper p-6 text-center">
        <div>
          <p className="font-display text-[20px] text-ink">{phase === 'error' ? '聊天加载失败' : '这段聊天已不可见'}</p>
          <p className="mt-1 text-[14px] text-ink-3">{phase === 'error' ? loadError : '可能已被排除，或者链接有误。'}</p>
          <div className="mt-5 flex justify-center gap-2">
            {phase === 'error' && <Button variant="primary" onClick={() => { setPhase('loading'); setAttempt((n) => n + 1); }}>重试</Button>}
            <Link to="/messages" className="inline-flex h-10 items-center rounded-md border border-line-strong bg-surface px-4 text-[14px] font-semibold text-ink hover:bg-surface-2">返回私聊列表</Link>
          </div>
        </div>
      </div>
    );
  }

  const other = summary.other;
  const closed = summary.status === 'closed';
  const menu: ChatMenuItem[] = [
    { label: '查看主页', icon: UserRound, onSelect: () => setProfileOpen(true) },
    ...(closed ? [] : [{ label: '解除配对', icon: HeartOff, onSelect: () => setConfirm('close') }]),
    { label: '排除这位同学', icon: UserRoundX, onSelect: () => setConfirm('exclude'), danger: true },
    { label: '举报这位同学', icon: Flag, onSelect: () => openReport('profile', other.id), danger: true },
  ];

  const rows: ReactNode[] = [];
  let prevTime: string | undefined;
  const timeline = [
    ...messages.map((m) => ({ m, pending: false as const })),
    ...pending.map((p) => ({ m: { id: -p.key, matchId, senderId: null, kind: 'text' as const, body: p.body, createdAt: p.createdAt, mine: true }, pending: true as const })),
  ];
  for (const { m, pending: isPending } of timeline) {
    if (needsSeparator(prevTime, m.createdAt)) {
      rows.push(<li key={`t${m.id}`} className="pt-3 pb-1 text-center text-[11.5px] text-ink-4 tabular">{separatorTime(m.createdAt)}</li>);
    }
    prevTime = m.createdAt;
    if (m.kind === 'system') rows.push(<SystemNote key={m.id} message={m} />);
    else if (isPending) rows.push(<MessageBubble key={`p${-m.id}`} message={m} pending />);
    else {
      rows.push(
        <MessageBubble
          key={m.id}
          message={m}
          onActions={() => setSheet(m)}
          onReport={m.mine ? undefined : () => openReport('message', m.id)}
        />,
      );
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex h-14 shrink-0 items-center gap-1 border-b border-line bg-surface px-2 sm:px-3">
        <Link to="/messages" aria-label="返回私聊列表" className="grid size-10 shrink-0 place-items-center rounded-lg text-ink-2 hover:bg-ink/[.06] md:hidden">
          <ChevronLeft size={22} />
        </Link>
        <button
          type="button"
          onClick={() => setProfileOpen(true)}
          className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg px-1.5 py-1 text-left transition-colors hover:bg-ink/[.04]"
          aria-label={`查看 ${other.nickname} 的主页`}
        >
          <ChatAvatar nickname={other.nickname} cover={other.cover} className="size-9" />
          <span className="min-w-0">
            <span className="block truncate font-display text-[17px] leading-tight text-ink">{other.nickname}</span>
            <span className="block text-[12px] text-ink-3">{closed ? '配对已解除' : '你们互相感兴趣'}</span>
          </span>
        </button>
        <ChatMenu items={menu} />
      </header>

      {!closed && <ContactCard other={other} contactState={summary.contactState} onChanged={() => void poll()} />}

      <div className="relative min-h-0 flex-1">
        <div ref={scroller} onScroll={onScroll} className="h-full overflow-y-auto overscroll-contain bg-paper px-2 py-3 sm:px-4">
          {hasOlder && (
            <div className="flex justify-center pb-2">
              <Button size="sm" variant="ghost" loading={olderBusy} onClick={() => void loadOlder()}>查看更早的消息</Button>
            </div>
          )}
          <div role="log" aria-live="polite" aria-relevant="additions" aria-label={`与 ${other.nickname} 的聊天记录`}>
            <ol>{rows}</ol>
          </div>
        </div>
        {newBelow && (
          <button
            type="button"
            onClick={scrollToBottom}
            className="absolute bottom-3 left-1/2 inline-flex h-8 -translate-x-1/2 items-center gap-1 rounded-full bg-ink px-3.5 text-[12.5px] font-semibold text-surface shadow-md"
          >
            <ArrowDown size={14} aria-hidden />有新消息
          </button>
        )}
      </div>

      {closed
        ? <p className="shrink-0 border-t border-line bg-surface px-4 py-3.5 text-center text-[13.5px] text-ink-3">配对已解除，不能再发送消息。</p>
        : <Composer onSend={send} autoFocus />}

      {/* 长按消息的操作面板（手机） */}
      <Modal open={!!sheet} onClose={() => setSheet(null)} size="sm">
        <div className="p-2 pb-3">
          {sheet && <p className="mx-3 mt-2 mb-2 line-clamp-3 text-[13px] text-ink-3">{sheet.body}</p>}
          <button type="button" className="flex w-full items-center gap-3 rounded-md px-4 py-3 text-left text-[15px] text-ink hover:bg-paper-2" onClick={() => { const text = sheet?.body ?? ''; setSheet(null); void copy(text); }}>
            <Copy size={17} aria-hidden />复制文字
          </button>
          {sheet && !sheet.mine && (
            <button type="button" className="flex w-full items-center gap-3 rounded-md px-4 py-3 text-left text-[15px] text-danger hover:bg-danger-soft" onClick={() => { const id = sheet.id; setSheet(null); openReport('message', id); }}>
              <Flag size={17} aria-hidden />举报这条消息
            </button>
          )}
          <button type="button" className="mt-1 w-full rounded-md px-4 py-3 text-[15px] text-ink-3 hover:bg-paper-2" onClick={() => setSheet(null)}>取消</button>
        </div>
      </Modal>

      <ReportDialog open={reportOpen} onClose={() => setReportOpen(false)} targetType={report.type} targetId={report.id} />

      <ConfirmDialog
        open={confirm === 'close'}
        title="解除配对？"
        desc="解除后聊天会关闭，双方都不能再发送消息，也不再互相展示联系方式；之后不会再向你推荐这位同学。对方不会收到通知，但会在聊天里看到「配对已解除」。"
        confirmText="解除配对"
        tone="danger"
        loading={confirmBusy}
        onCancel={() => { if (!confirmBusy) setConfirm(null); }}
        onConfirm={() => void closeMatch()}
      />
      <ConfirmDialog
        open={confirm === 'exclude'}
        title="排除这位同学？"
        desc="排除后，双方将不再出现在彼此的匹配结果中，联系方式交换也会停止，这段聊天会关闭并从双方的私聊列表中隐藏。对方不会收到提示；你可以在「我的」中取消排除。"
        confirmText="确认排除"
        tone="danger"
        loading={confirmBusy}
        onCancel={() => { if (!confirmBusy) setConfirm(null); }}
        onConfirm={() => void exclude()}
      />

      <AnimatePresence>
        {profileOpen && (
          <ProfileOverlay
            id={other.id}
            onClose={closeProfile}
            onChanged={() => { void poll(); onActivityRef.current(); }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
