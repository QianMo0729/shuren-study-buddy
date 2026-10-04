import { motion } from 'motion/react';
import { useState } from 'react';
import { Lock, MapPin, MessageSquare } from 'lucide-react';
import type { Checkin } from '../../../shared/types';
import { fileUrl } from '../../lib/api';
import { cx } from '../../lib/format';
import { ease } from '../../lib/motion';
import { AuthorLine } from '../forum/AuthorLine';
import { LikeButton } from '../forum/LikeButton';

/** 照片的无障碍描述 */
export const checkinAlt = (c: Checkin) => `${c.author.nickname} 的打卡照片，水印：${c.placeLabel}，${c.stampText}`;

/** 打卡照片：保持原始比例完整显示（水印在右下角，不能裁掉） */
export function CheckinPhoto({ checkin, className, eager }: { checkin: Checkin; className?: string; eager?: boolean }) {
  const [loaded, setLoaded] = useState(false);
  return (
    <div className={cx('relative overflow-hidden rounded-[5px] bg-mat', !loaded && 'min-h-48', className)}>
      <img
        src={fileUrl(checkin.image)}
        alt={checkinAlt(checkin)}
        loading={eager ? 'eager' : 'lazy'}
        decoding="async"
        onLoad={() => setLoaded(true)}
        className={cx('block h-auto w-full transition-opacity duration-300', loaded ? 'opacity-100' : 'opacity-0')}
      />
      {!loaded && <div className="skeleton absolute inset-0" aria-hidden />}
    </div>
  );
}

/** 打卡流里的一条：作者、照片、说明、地点、点赞、评论数 → 详情 */
export function CheckinCard({ checkin, onOpen, onChange, index = 0 }: {
  checkin: Checkin;
  onOpen: () => void;
  onChange?: (patch: Partial<Checkin>) => void;
  index?: number;
}) {
  const c = checkin;
  return (
    <motion.article
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease, delay: Math.min(index, 6) * 0.03 }}
      className={cx('rounded-md border bg-surface p-4 transition-colors duration-150 hover:border-line-strong sm:p-5', c.takenDown ? 'border-danger/40' : 'border-line')}
      aria-labelledby={`checkin-${c.id}-title`}
    >
      <div className="flex items-start justify-between gap-3">
        <AuthorLine author={c.author} time={c.stampedAt} />
        <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
          {c.takenDown && <span className="rounded-[4px] bg-danger-soft px-2 py-0.5 text-[12px] text-danger">已被撤下，仅你可见</span>}
          {c.visibility === 'buddies' && (
            <span className="inline-flex items-center gap-1 rounded-[4px] bg-paper-2 px-2 py-0.5 text-[12px] text-ink-2">
              <Lock size={11} aria-hidden /> 仅搭子可见
            </span>
          )}
        </div>
      </div>

      <h3 id={`checkin-${c.id}-title`} className="sr-only">{`${c.author.nickname} 在 ${c.placeLabel} 的打卡`}</h3>
      <button type="button" onClick={onOpen} className="mt-3 block w-full cursor-pointer text-left" aria-label={`查看打卡详情：${c.placeLabel}`}>
        <CheckinPhoto checkin={c} />
      </button>

      {c.caption && <p className="mt-3 line-clamp-4 text-[15px] leading-relaxed whitespace-pre-wrap break-words text-ink">{c.caption}</p>}
      <p className="mt-2 flex items-center gap-1.5 text-[13px] text-ink-3">
        <MapPin size={14} className="shrink-0" aria-hidden />
        <span className="truncate">{c.placeLabel}</span>
        <span aria-hidden>·</span>
        <time dateTime={c.stampedAt} className="shrink-0 tabular">{c.stampText.replace(' 北京时间', '')}</time>
      </p>

      <div className="mt-3 -mb-1 flex items-center gap-1 border-t border-line pt-2">
        <LikeButton type="checkin" id={c.id} liked={c.liked} count={c.likeCount} onChange={(r) => onChange?.({ liked: r.liked, likeCount: r.likeCount })} />
        <span className="inline-flex h-8 items-center gap-1.5 px-2 text-[13px] text-ink-3">
          <MessageSquare size={16} aria-hidden />
          <span className="tabular">{c.commentCount > 0 ? c.commentCount : '评论'}</span>
          <span className="sr-only">条评论</span>
        </span>
        <button type="button" onClick={onOpen} className="ml-auto inline-flex h-8 items-center rounded-md px-2 text-[13px] text-ink-3 hover:bg-ink/[.05] hover:text-ink">
          查看详情
        </button>
      </div>
    </motion.article>
  );
}

export function CheckinSkeleton() {
  return (
    <div className="rounded-md border border-line bg-surface p-4 sm:p-5" aria-hidden>
      <div className="flex items-center gap-2.5">
        <div className="skeleton size-9 rounded-[5px]" />
        <div className="space-y-1.5">
          <div className="skeleton h-3.5 w-24 rounded" />
          <div className="skeleton h-3 w-14 rounded" />
        </div>
      </div>
      <div className="skeleton mt-4 aspect-[4/3] w-full rounded-[5px]" />
      <div className="skeleton mt-3 h-4 w-2/3 rounded" />
    </div>
  );
}
