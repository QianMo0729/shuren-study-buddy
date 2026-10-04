import { motion } from 'motion/react';
import { Heart, ShieldX } from 'lucide-react';
import { POST_CATEGORIES } from '../../shared/options';
import type { Post } from '../../shared/types';
import { api, ApiError } from '../lib/api';
import { cx, timeAgo } from '../lib/format';
import { useToast } from '../lib/toast';
import { Seal } from './brand';
import { Cover, Nickname } from './ProfileCard';

export function categoryOf(v: string) {
  return POST_CATEGORIES.find((c) => c.value === v) ?? POST_CATEGORIES[POST_CATEGORIES.length - 1];
}

export function CategoryTag({ value, className }: { value: string; className?: string }) {
  const c = categoryOf(value);
  return (
    <span className={cx('inline-flex items-center gap-1.5 text-[13px] text-ink-2', className)}>
      <Seal char={c.glyph} tone={c.tone} size={20} />
      {c.label}
    </span>
  );
}

export function InterestButton({ post, onChange, size = 'md' }: { post: Post; onChange: (p: Partial<Post>) => void; size?: 'md' | 'lg' }) {
  const toast = useToast();
  const disabled = post.isMine || (post.status === 'closed' && !post.interested);
  return (
    <button
      disabled={disabled}
      aria-pressed={post.interested}
      onClick={async (e) => {
        e.stopPropagation();
        try {
          const r = await api.interest(post.id);
          onChange({ interested: r.interested, interestCount: r.interestCount });
          if (r.interested) toast.success('已告诉发起人你感兴趣', '也可以去 TA 的主页申请联系');
        } catch (err) {
          toast.error('操作失败', err instanceof ApiError ? err.message : undefined);
        }
      }}
      className={cx(
        'inline-flex shrink-0 items-center gap-1.5 rounded-md border font-semibold transition-colors disabled:opacity-50 active:scale-[.97]',
        size === 'lg' ? 'h-11 px-4 text-[15px]' : 'h-8 px-2.5 text-[13px]',
        post.interested ? 'border-brand bg-brand-soft text-brand-text' : 'border-line-strong bg-surface text-ink-2 hover:border-ink-4 hover:text-ink',
      )}
    >
      <motion.span key={String(post.interested)} initial={{ scale: 0.6 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 600, damping: 18 }}>
        <Heart size={size === 'lg' ? 16 : 14} className={post.interested ? 'fill-current' : ''} />
      </motion.span>
      {post.isMine ? '我发起的' : post.interested ? '已感兴趣' : '我感兴趣'}
      <span className="font-normal tabular">{post.interestCount}</span>
    </button>
  );
}

export function PostCard({ post, onOpen, onChange, isAdmin, onTakedown }: {
  post: Post;
  onOpen: () => void;
  onChange: (p: Partial<Post>) => void;
  isAdmin?: boolean;
  onTakedown?: () => void;
}) {
  const full = post.capacity > 0 && post.interestCount >= post.capacity;
  return (
    <article
      onClick={onOpen}
      className={cx(
        'group flex cursor-pointer flex-col rounded-md border border-line bg-surface p-5 transition-colors duration-150 hover:border-line-strong',
        post.status === 'closed' && 'opacity-65',
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <CategoryTag value={post.category} />
        <span className="text-[12.5px] text-ink-3">{post.status === 'closed' ? '已结束' : timeAgo(post.createdAt)}</span>
      </div>
      <h3 className="mt-3 font-display text-[20px] leading-snug text-ink">{post.title}</h3>
      <p className="mt-1.5 line-clamp-2 text-[14px] leading-relaxed text-ink-2">{post.description}</p>
      <dl className="mt-4 grid grid-cols-[3em_minmax(0,1fr)] gap-x-2 gap-y-1 text-[13.5px]">
        <dt className="text-ink-3">时间</dt>
        <dd className="truncate text-ink">{post.timeText}</dd>
        <dt className="text-ink-3">地点</dt>
        <dd className="truncate text-ink">{post.location}</dd>
        <dt className="text-ink-3">人数</dt>
        <dd className={cx('tabular', full ? 'text-accent-text' : 'text-ink')}>
          {post.capacity ? `${post.interestCount}/${post.capacity} 人感兴趣${full ? '，已满' : ''}` : `不限人数，${post.interestCount} 人感兴趣`}
        </dd>
      </dl>
      {post.tags.length > 0 && (
        <p className="mt-3 truncate text-[13px] text-ink-3">{post.tags.map((t) => `#${t}`).join('  ')}</p>
      )}
      <div className="min-h-4 flex-1" />
      <div className="flex items-center justify-between gap-2 border-t border-line pt-3.5">
        <div className="flex min-w-0 items-center gap-2">
          <span className="size-6 shrink-0 overflow-hidden rounded-md">
            <Cover id={post.author.id} nickname={post.author.nickname} cover={post.author.cover} studyType={post.author.studyType} className="h-full w-full" />
          </span>
          <Nickname name={post.author.nickname} size={13.5} />
        </div>
        {isAdmin ? (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onTakedown?.();
            }}
            className="inline-flex h-8 items-center gap-1 rounded-md border border-danger/40 px-2.5 text-[13px] text-danger transition-colors hover:bg-danger hover:text-white"
          >
            <ShieldX size={13} /> 撤下
          </button>
        ) : post.status === 'open' ? (
          <InterestButton post={post} onChange={onChange} />
        ) : null}
      </div>
    </article>
  );
}
