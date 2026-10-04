import { motion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { Heart } from 'lucide-react';
import type { ForumTargetType } from '../../../shared/types';
import { api, ApiError } from '../../lib/api';
import { cx } from '../../lib/format';
import { useToast } from '../../lib/toast';

/** 点赞（再点一次取消）。先在界面上立即更新，失败时回退。帖子与打卡通用。 */
export function LikeButton({ type, id, liked, count, onChange, className }: {
  type: ForumTargetType;
  id: number;
  liked: boolean;
  count: number;
  onChange?: (next: { liked: boolean; likeCount: number }) => void;
  className?: string;
}) {
  const toast = useToast();
  const [state, setState] = useState({ liked, count });
  const busy = useRef(false);
  useEffect(() => setState({ liked, count }), [liked, count]);

  const toggle = async () => {
    if (busy.current) return;
    busy.current = true;
    const prev = state;
    setState({ liked: !prev.liked, count: Math.max(0, prev.count + (prev.liked ? -1 : 1)) });
    try {
      const r = await api.forum.like(type, id);
      setState({ liked: r.liked, count: r.likeCount });
      onChange?.({ liked: r.liked, likeCount: r.likeCount });
    } catch (e) {
      setState(prev);
      toast.error('操作失败', e instanceof ApiError ? e.message : undefined);
    } finally {
      busy.current = false;
    }
  };

  return (
    <button
      type="button"
      aria-pressed={state.liked}
      aria-label={state.liked ? `取消点赞，当前 ${state.count} 个赞` : `点赞，当前 ${state.count} 个赞`}
      onClick={(e) => {
        e.stopPropagation();
        void toggle();
      }}
      className={cx(
        'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2 text-[13px] transition-colors active:scale-[.97]',
        state.liked ? 'text-brand-text hover:bg-brand-softer' : 'text-ink-3 hover:bg-ink/[.05] hover:text-ink',
        className,
      )}
    >
      <motion.span key={String(state.liked)} initial={{ scale: 0.6 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 600, damping: 18 }} className="grid">
        <Heart size={16} className={state.liked ? 'fill-current' : ''} aria-hidden />
      </motion.span>
      <span className="tabular">{state.count > 0 ? state.count : '赞'}</span>
    </button>
  );
}
