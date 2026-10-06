import { PendingReviewBadge } from '../ReviewStatus';
import { motion } from 'motion/react';
import { useState } from 'react';
import { MessageSquare } from 'lucide-react';
import type { ForumPost } from '../../../shared/types';
import { cx } from '../../lib/format';
import { ease } from '../../lib/motion';
import { AuthorLine } from './AuthorLine';
import { LikeButton } from './LikeButton';
import { ImageGrid } from './PostImages';

/** 长文在列表里折叠显示 */
const isLong = (body: string) => body.length > 180 || body.split('\n').length > 6;

/** 聊天区的一条帖子：作者、时间、正文（长文折叠）、图片、点赞、评论数 → 详情 */
export function ForumPostCard({ post, onOpen, onChange, matchLabel, index = 0 }: {
  post: ForumPost;
  onOpen: () => void;
  onChange?: (p: Partial<ForumPost>) => void;
  /** 高级检索结果：把命中的条件 key 转成文字 */
  matchLabel?: (key: string) => string;
  index?: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const long = isLong(post.body);
  const matched = post.match && matchLabel ? post.match.matched.map(matchLabel) : [];

  return (
    <motion.article
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease, delay: Math.min(index, 6) * 0.03 }}
      onClick={onOpen}
      className={cx(
        'cursor-pointer rounded-md border bg-surface p-4 transition-colors duration-150 hover:border-line-strong sm:p-5',
        post.reviewPending ? 'border-accent/40' : post.takenDown ? 'border-danger/40' : 'border-line',
      )}
      aria-labelledby={`post-${post.id}-text`}
    >
      <div className="flex items-start justify-between gap-3">
        <AuthorLine author={post.author} time={post.createdAt} />
        {post.reviewPending ? <PendingReviewBadge /> : post.takenDown && <span className="shrink-0 rounded-[4px] bg-danger-soft px-2 py-0.5 text-[12px] text-danger">已被撤下，仅你可见</span>}
        {post.match && post.match.total > 0 && (
          <span className="shrink-0 rounded-sm px-1.5 py-0.5 font-display text-seal" title={`符合 ${post.match.score} 项，共 ${post.match.total} 项`}>
            <span className="text-[17px] leading-none">{post.match.score}</span>
            <span className="text-[12px] leading-none opacity-80">/{post.match.total}</span>
          </span>
        )}
      </div>

      <div id={`post-${post.id}-text`} className="mt-3">
        {post.title && <h3 className="font-display text-[18px] leading-snug text-ink">{post.title}</h3>}
        <p className={cx('mt-1 text-[15px] leading-relaxed whitespace-pre-wrap break-words text-ink', long && !expanded && 'line-clamp-5')}>{post.body}</p>
      </div>
      {long && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setExpanded((v) => !v);
          }}
          aria-expanded={expanded}
          className="mt-1 text-[13.5px] font-semibold text-brand-text hover:underline"
        >
          {expanded ? '收起' : '展开全文'}
        </button>
      )}

      {post.match?.snippet && long && !expanded && <p className="mt-2 rounded-[4px] bg-paper-2 px-2.5 py-1.5 text-[13px] text-ink-2">「{post.match.snippet}」</p>}
      {matched.length > 0 && <p className="mt-2 text-[12.5px] text-ink-3">符合 <span className="text-ink-2">{matched.join('、')}</span></p>}

      <ImageGrid images={post.images} onOpen={() => onOpen()} className="mt-3" />

      <div className="mt-3 -mb-1 flex items-center gap-1 border-t border-line pt-2">
        {/* 被撤下的帖子（只有作者自己看得到）不能点赞，与详情页一致 */}
        {!post.takenDown && !post.reviewPending && <LikeButton type="post" id={post.id} liked={post.liked} count={post.likeCount} onChange={(r) => onChange?.({ liked: r.liked, likeCount: r.likeCount })} />}
        <span className="inline-flex h-8 items-center gap-1.5 px-2 text-[13px] text-ink-3">
          <MessageSquare size={16} aria-hidden />
          <span className="tabular">{post.commentCount > 0 ? post.commentCount : '评论'}</span>
          <span className="sr-only">条评论</span>
        </span>
        <button type="button" onClick={(e) => (e.stopPropagation(), onOpen())} className="ml-auto inline-flex h-8 items-center rounded-md px-2 text-[13px] text-ink-3 hover:bg-ink/[.05] hover:text-ink">
          查看详情
        </button>
      </div>
    </motion.article>
  );
}

export function PostSkeleton() {
  return (
    <div className="rounded-md border border-line bg-surface p-4 sm:p-5" aria-hidden>
      <div className="flex items-center gap-2.5">
        <div className="skeleton size-9 rounded-[5px]" />
        <div className="space-y-1.5">
          <div className="skeleton h-3.5 w-24 rounded" />
          <div className="skeleton h-3 w-14 rounded" />
        </div>
      </div>
      <div className="skeleton mt-4 h-4 w-3/4 rounded" />
      <div className="skeleton mt-2 h-4 w-1/2 rounded" />
    </div>
  );
}
