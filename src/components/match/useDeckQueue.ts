import { useCallback, useEffect, useRef, useState } from 'react';
import type { DeckCard, DeckResponse, FeedbackAction, FeedbackResult } from '../../../shared/types';
import { api, ApiError } from '../../lib/api';

type Meta = Omit<DeckResponse, 'items'>;
export type LastAction = { card: DeckCard; action: FeedbackAction };

const message = (cause: unknown) => (cause instanceof ApiError ? cause.message : '网络连接失败，请稍后重试');

/**
 * 滑卡队列：首次加载每日固定名单、乐观提交反馈和撤销上一步。
 * 本轮已经处理过的同学不会因为请求尚未完成而再次出现。
 */
export function useDeckQueue({ limit = 5, onMatched, onLiked, onError }: {
  limit?: number;
  onMatched?: (card: DeckCard, result: FeedbackResult) => void;
  /** 表示了感兴趣、对方还没有回应 */
  onLiked?: (card: DeckCard) => void;
  onError?: (title: string, desc?: string) => void;
} = {}) {
  const [queue, setQueue] = useState<DeckCard[]>([]);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exhausted, setExhausted] = useState(false);
  const [last, setLast] = useState<LastAction | null>(null);
  const [undoing, setUndoing] = useState(false);
  const decided = useRef(new Set<number>());
  const generation = useRef(0);
  const callbacks = useRef({ onMatched, onLiked, onError });
  callbacks.current = { onMatched, onLiked, onError };

  const reload = useCallback(async () => {
    const gen = ++generation.current;
    setLoading(true);
    setError(null);
    setExhausted(false);
    setLast(null);
    try {
      const { items, ...rest } = await api.match.deck(limit);
      if (gen !== generation.current) return;
      decided.current = new Set();
      setQueue(items);
      setMeta(rest);
      setExhausted(true);
    } catch (cause) {
      if (gen === generation.current) setError(message(cause));
    } finally {
      if (gen === generation.current) {
        setLoading(false);
      }
    }
  }, [limit]);

  useEffect(() => { void reload(); }, [reload]);

  // 北京时间零点更新；从其他设备处理或网页重新回到前台时刷新当前名单。
  useEffect(() => {
    const visible = () => { if (document.visibilityState === 'visible') void reload(); };
    document.addEventListener('visibilitychange', visible);
    return () => document.removeEventListener('visibilitychange', visible);
  }, [reload]);
  useEffect(() => {
    if (!meta?.daily.resetsAt) return;
    const timer = window.setTimeout(() => void reload(), Math.max(100, Date.parse(meta.daily.resetsAt) - Date.now() + 100));
    return () => window.clearTimeout(timer);
  }, [meta?.daily.resetsAt, reload]);

  const decide = useCallback(async (card: DeckCard, action: FeedbackAction) => {
    if (decided.current.has(card.id)) return;
    const gen = generation.current;
    decided.current.add(card.id);
    setQueue((current) => current.filter((c) => c.id !== card.id));
    setLast(null);
    try {
      const result = await api.match.feedback(card.id, action);
      if (gen !== generation.current) return;
      // 每一种选择都能撤销上一步；只有已经互相感兴趣（配对已建立）时不能，那要到私聊里解除
      if (result.matched && result.matchId) callbacks.current.onMatched?.(card, result);
      else {
        setLast({ card, action });
        if (action === 'like') callbacks.current.onLiked?.(card);
      }
    } catch (cause) {
      if (gen !== generation.current) return;
      decided.current.delete(card.id);
      // 放回最前面，方便重试；对方已不可见时（404）直接移除
      if (!(cause instanceof ApiError && cause.status === 404)) {
        setQueue((current) => (current.some((c) => c.id === card.id) ? current : [card, ...current]));
      }
      callbacks.current.onError?.('操作没有成功', message(cause));
    }
  }, []);

  const undo = useCallback(async () => {
    if (!last || undoing) return;
    setUndoing(true);
    try {
      await api.match.undoFeedback(last.card.id);
      // 从服务端重新读取，以免撤销时把已下线或昨日卡片放回前端。
      await reload();
    } catch (cause) {
      callbacks.current.onError?.('撤销失败', message(cause));
    } finally {
      setUndoing(false);
    }
  }, [last, undoing, reload]);

  /** 卡片在别处（如主页浮层）被处理后，从队列中移除 */
  const remove = useCallback((id: number) => {
    decided.current.add(id);
    setQueue((current) => current.filter((c) => c.id !== id));
    setLast((current) => (current?.card.id === id ? null : current));
  }, []);

  return { queue, meta, loading, error, exhausted, last, undoing, reload, decide, undo, remove };
}
