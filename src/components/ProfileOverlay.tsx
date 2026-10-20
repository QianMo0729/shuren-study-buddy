import { motion } from 'motion/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { AdvancedQuery, MatchInfo, PublicProfile, RecommendationInfo } from '../../shared/types';
import { api } from '../lib/api';
import { ease } from '../lib/motion';
import { Button, useIsMobile, useLockBody } from './ui';
import { ProfileDetail } from './ProfileDetail';

/** 主页浮层：桌面端居中展开；手机端从底部弹出。匹配、找同学与聊天共用。 */
export function ProfileOverlay({ id, shared = false, match, searchQuery, keyword, recommendation, onClose, onChanged }: {
  id: number;
  /** 与卡片封面做共享元素动画（仅桌面端且卡片可见时） */
  shared?: boolean;
  match?: MatchInfo;
  searchQuery?: AdvancedQuery;
  keyword?: string;
  recommendation?: RecommendationInfo;
  onClose: () => void;
  onChanged?: () => void;
}) {
  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mobile = useIsMobile(768);
  const dialog = useRef<HTMLDivElement>(null);
  useLockBody(true);
  useEffect(() => {
    let active = true;
    setProfile(null);
    setError(null);
    api.profile(id).then((result) => { if (active) setProfile(result.profile); }).catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : '主页暂不可用'); });
    return () => { active = false; };
  }, [id]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      // 备注、举报等弹窗在上层时，Escape 只交给上层，保存中也不能关掉父浮层。
      const dialogs = document.querySelectorAll('[role="dialog"][aria-modal="true"]');
      if (dialogs.item(dialogs.length - 1) === dialog.current) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const panel = useMemo(
    () =>
      mobile
        ? { initial: { y: '100%' }, animate: { y: 0 }, exit: { y: '100%' }, transition: { type: 'spring' as const, stiffness: 400, damping: 40 } }
        : { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 }, transition: { duration: 0.2, ease } },
    [mobile],
  );

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-end justify-center md:items-center md:p-8">
      <motion.div className="absolute inset-0 bg-[#0c1415]/45" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
      <motion.div
        ref={dialog}
        {...panel}
        className="relative h-[94dvh] w-full max-w-[1000px] overflow-y-auto overscroll-contain rounded-t-xl bg-surface shadow-lg md:h-auto md:max-h-[90dvh] md:rounded-lg md:p-7"
        role="dialog"
        aria-modal="true"
      >
        {profile ? (
          <ProfileDetail profile={profile} recommendation={recommendation} match={match} searchQuery={searchQuery} keyword={keyword} onClose={onClose} onChanged={onChanged} inOverlay={!mobile && shared} />
        ) : error ? (
          <div className="grid h-80 place-items-center text-center">
            <div>
              <p className="text-[15px] text-ink-2">{error}</p>
              <Button className="mt-4" onClick={onClose}>
                返回
              </Button>
            </div>
          </div>
        ) : (
          <div className="grid gap-6 md:grid-cols-2">
            <div className="skeleton aspect-[4/3] md:rounded-xl" />
            <div className="space-y-4 p-5">
              <div className="skeleton h-7 w-1/2 rounded" />
              <div className="skeleton h-4 w-2/3 rounded" />
              <div className="skeleton h-24 rounded-lg" />
            </div>
          </div>
        )}
      </motion.div>
    </div>,
    document.body,
  );
}
