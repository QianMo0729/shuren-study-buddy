import { useCallback, useEffect, useRef, useState } from 'react';
import type { DeckCard, DeckResponse, FeedbackAction, FeedbackResult } from '../../../shared/types';
import { api, ApiError } from '../../lib/api';

type Meta = Omit<DeckResponse, 'items'>;
export type LastAction = { card: DeckCard; action: FeedbackAction };

const message = (cause: unknown) => (cause instanceof ApiError ? cause.message : '网络连接失败，请稍后重试');

/**
 * 滑卡队列：首次加载、乐观提交反馈、撤销上一步，以及卡片快用完时自动拉取下一批。
 * 本轮已经处理过的同学不会因为请求尚未完成而再次出现。
 */
export function useDeckQueue({ limit = 20, onMatched, onLiked, onError }: {
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
  const fetching = useRef(false);
  const generation = useRef(0);
  const queueRef = useRef<DeckCard[]>([]);
  queueRef.current = queue;
  const callbacks = useRef({ onMatched, onLiked, onError });
  callbacks.current = { onMatched, onLiked, onError };

  const reload = useCallback(async () => {
    const gen = ++generation.current;
    fetching.current = true;
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
      setExhausted(items.length === 0);
    } catch (cause) {
      if (gen === generation.current) setError(message(cause));
    } finally {
      if (gen === generation.current) {
        fetching.current = false;
        setLoading(false);
      }
    }
  }, [limit]);

  const fetchMore = useCallback(async () => {
    if (fetching.current) return;
    const gen = generation.current;
    fetching.current = true;
    try {
      const { items, ...rest } = await api.match.deck(limit);
      if (gen !== generation.current) return;
      const have = new Set(queueRef.current.map((card) => card.id));
      const fresh = items.filter((card) => !have.has(card.id) && !decided.current.has(card.id));
      setMeta(rest);
      if (fresh.length) setQueue((current) => [...current, ...fresh.filter((card) => !current.some((c) => c.id === card.id))]);
      else setExhausted(true);
    } catch {
      // 预取失败不打断当前操作；用完后会显示“看完了”，可手动刷新
      if (gen === generation.current) setExhausted(true);
    } finally {
      if (gen === generation.current) fetching.current = false;
    }
  }, [limit]);

  useEffect(() => { void reload(); }, [reload]);

  // 剩 3 张时预取下一批
  useEffect(() => {
    if (loading || error || exhausted || meta?.state !== 'ready') return;
    if (queue.length <= 3) void fetchMore();
  }, [queue.length, loading, error, exhausted, meta?.state, fetchMore]);

  const decide = useCallback(async (card: DeckCard, action: FeedbackAction) => {
    decided.current.add(card.id);
    setQueue((current) => current.filter((c) => c.id !== card.id));
    setLast(null);
    try {
      const result = await api.match.feedback(card.id, action);
      // 每一种选择都能撤销上一步；只有已经互相感兴趣（配对已建立）时不能，那要到私聊里解除
      if (result.matched && result.matchId) callbacks.current.onMatched?.(card, result);
      else {
        setLast({ card, action });
        if (action === 'like') callbacks.current.onLiked?.(card);
      }
    } catch (cause) {
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
      decided.current.delete(last.card.id);
      setQueue((current) => [last.card, ...current.filter((c) => c.id !== last.card.id)]);
      setExhausted(false);
      setLast(null);
    } catch (cause) {
      callbacks.current.onError?.('撤销失败', message(cause));
    } finally {
      setUndoing(false);
    }
  }, [last, undoing]);

  /** 卡片在别处（如主页浮层）被处理后，从队列中移除 */
  const remove = useCallback((id: number) => {
    decided.current.add(id);
    setQueue((current) => current.filter((c) => c.id !== id));
    setLast((current) => (current?.card.id === id ? null : current));
  }, []);

  return { queue, meta, loading, error, exhausted, last, undoing, reload, decide, undo, remove };
}
