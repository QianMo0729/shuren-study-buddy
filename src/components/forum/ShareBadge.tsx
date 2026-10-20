import type { ForumPost } from '../../../shared/types';

/** 学习分享标签；作者与审核人员另外看到 Bonus 的审核状态 */
export function ShareBadge({ post }: { post: ForumPost }) {
  if (!post.share && !post.bonus) return null;
  const status = post.bonus
    ? { pending: 'Bonus 审核中', approved: '已获 Bonus', rejected: 'Bonus 未通过', withdrawn: '' }[post.bonus.status]
    : '';
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5">
      {post.share && <span className="rounded-[4px] bg-brand-soft px-2 py-0.5 text-[12px] text-brand-text">学习分享</span>}
      {status && <span className="rounded-[4px] bg-paper-2 px-2 py-0.5 text-[12px] text-ink-2">{status}</span>}
    </span>
  );
}

/** 详情页：Bonus 未通过时给作者看原因 */
export function BonusNotice({ post }: { post: ForumPost }) {
  if (post.bonus?.status !== 'rejected') return null;
  return (
    <p className="mb-4 rounded-md bg-paper-2 px-4 py-3 text-[14px] text-ink-2" role="status">
      这篇学习分享没有通过 Bonus 审核{post.bonus.reason ? `：${post.bonus.reason}` : ''}。帖子本身照常展示。
    </p>
  );
}
