import { Link } from 'react-router';
import type { ForumAuthor } from '../../../shared/types';
import { cx, fullDateTime, timeAgo } from '../../lib/format';
import { Plate } from '../brand';
import { Nickname } from '../ProfileCard';

/**
 * 作者行：物种小图版 + 系统昵称 + 相对时间。
 * 只有作者主页对我可见时，才能点进主页（/u/:id）；否则只显示昵称。
 */
export function AuthorLine({ author, time, className }: { author: ForumAuthor; time: string; className?: string }) {
  const body = (
    <>
      <Plate nickname={author.nickname} photo={author.cover} className="size-9 shrink-0 rounded-[5px]" pad="8%" />
      <span className="flex min-w-0 flex-col leading-tight">
        <Nickname name={author.nickname} size={15} />
        <time dateTime={time} title={fullDateTime(time)} className="mt-0.5 text-[12px] text-ink-3">{timeAgo(time)}</time>
      </span>
    </>
  );
  if (!author.profileVisible) return <div className={cx('flex min-w-0 items-center gap-2.5', className)}>{body}</div>;
  return (
    <Link
      to={`/u/${author.id}`}
      onClick={(e) => e.stopPropagation()}
      aria-label={`查看 ${author.nickname} 的主页`}
      className={cx('-m-1 flex min-w-0 items-center gap-2.5 rounded-md p-1 transition-colors hover:bg-ink/[.04]', className)}
    >
      {body}
    </Link>
  );
}
