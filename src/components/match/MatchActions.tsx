import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Heart, MessageCircle, Undo2, X } from 'lucide-react';
import type { FeedbackAction, MatchState, PublicProfile } from '../../../shared/types';
import { api, ApiError } from '../../lib/api';
import { cx } from '../../lib/format';
import { useToast } from '../../lib/toast';
import { Button } from '../ui';
import { MatchCelebration } from './MatchCelebration';

export interface MatchActionsState {
  state: MatchState;
  matchId: number | null;
  busy: FeedbackAction | 'undo' | null;
  send: (action: FeedbackAction) => Promise<void>;
  undo: () => Promise<void>;
  celebration: { matchId: number; nickname: string; cover: string | null } | null;
  closeCelebration: () => void;
}

/** 主页上的「感兴趣 / 不感兴趣」：状态与请求 */
export function useMatchActions(profile: PublicProfile, onChanged?: () => void): MatchActionsState {
  const toast = useToast();
  const [state, setState] = useState<MatchState>(profile.matchState);
  const [matchId, setMatchId] = useState<number | null>(profile.matchId);
  const [busy, setBusy] = useState<MatchActionsState['busy']>(null);
  const [celebration, setCelebration] = useState<MatchActionsState['celebration']>(null);
  const cover = profile.photoVisibility === 'public' ? profile.photos[0] ?? null : null;

  const send = async (action: FeedbackAction) => {
    if (busy) return;
    setBusy(action);
    try {
      const result = await api.match.feedback(profile.id, action);
      if (result.matched && result.matchId) {
        setState('matched');
        setMatchId(result.matchId);
        setCelebration({ matchId: result.matchId, nickname: profile.nickname, cover });
      } else {
        setState(action === 'like' ? 'liked' : action === 'dislike' ? 'disliked' : 'skipped');
        setMatchId(null);
        if (action === 'like') toast.success('已表示感兴趣', '对方也感兴趣时，你们就可以私聊。对方不会知道你的选择，除非互相感兴趣。');
        else if (action === 'dislike') toast.success('已标记不感兴趣', 'TA 不会再出现在你的推荐里，可随时撤销。');
      }
      onChanged?.();
    } catch (cause) {
      toast.error('操作没有成功', cause instanceof ApiError ? cause.message : '网络连接失败，请稍后重试');
    } finally {
      setBusy(null);
    }
  };

  const undo = async () => {
    if (busy) return;
    setBusy('undo');
    try {
      await api.match.undoFeedback(profile.id);
      setState('none');
      toast.success('已撤销');
      onChanged?.();
    } catch (cause) {
      toast.error('撤销失败', cause instanceof ApiError ? cause.message : '网络连接失败，请稍后重试');
    } finally {
      setBusy(null);
    }
  };

  return { state, matchId, busy, send, undo, celebration, closeCelebration: () => setCelebration(null) };
}

/** 状态说明 + 操作按钮。compact 用于手机底部操作栏 */
export function MatchButtons({ actions, compact, className }: { actions: MatchActionsState; compact?: boolean; className?: string }) {
  const nav = useNavigate();
  const { state, matchId, busy, send, undo } = actions;
  const size = compact ? 'lg' : 'md';
  if (state === 'matched' && matchId) {
    return (
      <div className={cx('flex items-center gap-3', className)}>
        <span className={cx('text-[13.5px] text-ink-2', compact && 'flex-1')}>你们互相感兴趣</span>
        <Button variant="primary" size={size} icon={<MessageCircle size={16} />} onClick={() => nav(`/messages/${matchId}`)} className={compact ? 'flex-1' : undefined}>
          去私聊
        </Button>
      </div>
    );
  }
  if (state === 'liked' || state === 'disliked') {
    return (
      <div className={cx('flex items-center gap-3', className)} role="status">
        <span className={cx('inline-flex items-center gap-1.5 text-[14px]', state === 'liked' ? 'text-brand-text' : 'text-ink-2', compact && 'flex-1')}>
          {state === 'liked' ? <Heart size={15} className="fill-current" aria-hidden /> : <X size={15} aria-hidden />}
          {state === 'liked' ? '已感兴趣，等待对方' : '已标记不感兴趣'}
        </span>
        <Button variant="ghost" size={compact ? 'md' : 'sm'} icon={<Undo2 size={14} />} loading={busy === 'undo'} onClick={() => void undo()}>
          撤销
        </Button>
      </div>
    );
  }
  return (
    <div className={cx('flex items-center gap-2', className)}>
      <Button variant="primary" size={size} icon={<Heart size={16} />} loading={busy === 'like'} disabled={!!busy} onClick={() => void send('like')} className={compact ? 'flex-1' : undefined}>
        感兴趣
      </Button>
      <Button variant="secondary" size={size} icon={<X size={16} />} loading={busy === 'dislike'} disabled={!!busy} onClick={() => void send('dislike')} className={compact ? 'flex-1' : undefined}>
        不感兴趣
      </Button>
    </div>
  );
}

/** 手机端底部固定操作栏：在浮层里贴住浮层底部，在独立主页里避开底部标签栏 */
export function MatchBar({ actions, inOverlay }: { actions: MatchActionsState; inOverlay: boolean }) {
  return (
    <>
      <div
        className={cx(
          'z-30 border-t border-line bg-surface/95 px-4 pt-3 backdrop-blur-md md:hidden',
          inOverlay
            ? 'sticky bottom-0 -mx-5 mt-8 pb-[calc(0.75rem+env(safe-area-inset-bottom))]'
            : 'fixed inset-x-0 bottom-[calc(58px+env(safe-area-inset-bottom))] pb-3',
        )}
        aria-label="对这位同学的选择"
        role="group"
      >
        <MatchButtons actions={actions} compact />
      </div>
      {!inOverlay && <div className="h-20 md:hidden" aria-hidden />}
    </>
  );
}

export function MatchCelebrationFor({ actions }: { actions: MatchActionsState }) {
  return <MatchCelebration match={actions.celebration} onClose={actions.closeCelebration} />;
}
