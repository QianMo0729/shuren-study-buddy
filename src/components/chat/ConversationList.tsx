import { Link } from 'react-router';
import type { ChatSummary } from '../../../shared/types';
import { cx } from '../../lib/format';
import { Button, Skeleton } from '../ui';
import { Plate } from '../brand';
import { listTime } from './format';

function previewOf(item: ChatSummary) {
  const last = item.lastMessage;
  if (!last) return '你们互相感兴趣，打个招呼吧';
  if (last.kind === 'system') return last.body;
  return last.senderId === item.other.id ? last.body : `我：${last.body}`;
}

/** 会话列表（白色分组卡片）：头像、昵称、时间、最后一条消息、未读圆点；当前打开的会话高亮 */
export function ConversationList({ items, activeId, error, onRetry, compact = false }: {
  items: ChatSummary[] | null;
  activeId: number | null;
  error: string | null;
  onRetry: () => void;
  /** 桌面端左栏：去掉外层卡片，头像小一号 */
  compact?: boolean;
}) {
  if (!items) {
    if (error) {
      return <div className="p-4" role="alert"><p className="text-[14px] text-danger">{error}</p><Button size="sm" className="mt-3" onClick={onRetry}>重试</Button></div>;
    }
    return <div className="flex flex-col gap-2" aria-busy="true">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-[74px] rounded-2xl" />)}</div>;
  }
  if (!items.length) return <p className="px-4 py-6 text-center text-[15px] text-ink-3">没有找到聊天</p>;
  return (
    <nav aria-label="私聊会话" className={cx(!compact && 'overflow-hidden rounded-2xl bg-surface')}>
      {error && <p className="px-4 py-2 text-[12.5px] text-danger" role="alert">{error}</p>}
      <ul className={cx(compact ? 'flex flex-col gap-0.5' : '[&>li+li]:border-t-[0.5px] [&>li+li]:border-line')}>
        {items.map((item) => {
          const active = item.matchId === activeId;
          const closed = item.status === 'closed';
          const unread = item.unread > 0;
          const name = item.other.privateNote?.remarkName || item.other.nickname;
          return (
            <li key={item.matchId} className={cx(!compact && '[&+li]:ml-0')}>
              <Link
                to={`/messages/${item.matchId}`}
                aria-current={active ? 'page' : undefined}
                className={cx('flex items-center gap-3', compact ? 'rounded-xl p-2.5' : 'px-4 py-3', active ? (compact ? 'bg-brand text-white' : 'bg-brand-softer') : compact ? 'hover:bg-ink/[.04]' : 'active:bg-paper')}
              >
                <Plate nickname={item.other.nickname} photo={item.other.cover} className={cx('shrink-0 overflow-hidden rounded-full bg-mat', compact ? 'size-[42px]' : 'size-[50px]', closed && 'opacity-50 grayscale')} pad="0" fit="cover" />
                <span className="flex min-w-0 flex-1 flex-col gap-[3px]">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className={cx('truncate font-semibold', compact ? 'text-[15px]' : 'text-[17px]', !active && (closed ? 'text-ink-3' : 'text-ink'))}>
                      {name}
                      {item.buddy.state === 'bound' && <span className={cx('ml-1.5 text-[12px] font-semibold', active && compact ? 'text-white/80' : 'text-brand-text')}>搭子</span>}
                      {closed && <span className="ml-1.5 text-[12px] font-normal text-ink-3">已解除</span>}
                    </span>
                    <span className={cx('shrink-0 tabular', compact ? 'text-[12px]' : 'text-[14px]', active && compact ? 'text-white/75' : 'text-ink-3')}>{listTime(item.lastMessage?.createdAt ?? item.createdAt)}</span>
                  </span>
                  <span className="flex items-center gap-2">
                    <span className={cx('min-w-0 flex-1 truncate', compact ? 'text-[13px]' : 'text-[15px]', active && compact ? 'text-white/85' : unread ? 'text-ink' : 'text-ink-3')}>{previewOf(item)}</span>
                    {unread && !active && <span className="size-2.5 shrink-0 rounded-full bg-brand" aria-label={`${item.unread} 条未读`} />}
                  </span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
