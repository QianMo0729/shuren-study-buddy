import { Link } from 'react-router';
import type { ChatSummary } from '../../../shared/types';
import { cx } from '../../lib/format';
import { Button, Skeleton } from '../ui';
import { ChatAvatar } from './ChatAvatar';
import { listTime } from './format';

const CONTACT_HINT: Partial<Record<ChatSummary['contactState'], string>> = {
  pending_incoming: '想和你交换联系方式',
  pending_outgoing: '等待对方同意交换',
  accepted: '已交换联系方式',
};

function previewOf(item: ChatSummary) {
  const last = item.lastMessage;
  if (!last) return '你们互相感兴趣了，打个招呼吧';
  if (last.kind === 'system') return last.body;
  return last.senderId === item.other.id ? last.body : `我：${last.body}`;
}

/** 会话列表：每一项是一段配对聊天；当前打开的会话高亮 */
export function ConversationList({ items, activeId, error, onRetry }: {
  items: ChatSummary[] | null;
  activeId: number | null;
  error: string | null;
  onRetry: () => void;
}) {
  if (!items) {
    if (error) {
      return <div className="p-4" role="alert"><p className="text-[14px] text-danger">{error}</p><Button size="sm" className="mt-3" onClick={onRetry}>重试</Button></div>;
    }
    return <div className="space-y-2 p-3" aria-busy="true">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[68px]" />)}</div>;
  }
  return (
    <nav aria-label="私聊会话">
      {error && <p className="border-b border-line px-4 py-2 text-[12.5px] text-danger" role="alert">{error}</p>}
      <ul className="divide-y divide-line">
        {items.map((item) => {
          const active = item.matchId === activeId;
          const closed = item.status === 'closed';
          const hint = !closed ? CONTACT_HINT[item.contactState] : undefined;
          const time = listTime(item.lastMessage?.createdAt ?? item.createdAt);
          return (
            <li key={item.matchId}>
              <Link
                to={`/messages/${item.matchId}`}
                aria-current={active ? 'page' : undefined}
                className={cx(
                  'flex items-center gap-3 px-4 py-3 transition-colors',
                  active ? 'bg-brand-softer' : 'hover:bg-paper-2/60',
                )}
              >
                <span className="relative">
                  <ChatAvatar nickname={item.other.nickname} cover={item.other.cover} className={cx('size-11', closed && 'opacity-50 grayscale')} />
                  {item.unread > 0 && (
                    <span className="absolute -top-1.5 -right-1.5 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-accent px-1 text-[10.5px] font-semibold text-white tabular ring-2 ring-surface" aria-hidden>
                      {item.unread > 99 ? '99+' : item.unread}
                    </span>
                  )}
                  {item.unread > 0 && <span className="sr-only">{item.unread} 条未读，</span>}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className={cx('truncate font-display text-[16px]', closed ? 'text-ink-3' : 'text-ink')}>{item.other.privateNote?.remarkName || item.other.nickname}</span>
                    <span className="shrink-0 text-[11.5px] text-ink-4 tabular">{time}</span>
                  </span>
                  {item.other.privateNote?.remarkName && <span className="block truncate text-[11.5px] text-ink-3">原昵称：{item.other.nickname}</span>}
                  <span className="mt-0.5 flex items-center gap-1.5">
                    {closed ? (
                      <span className="shrink-0 rounded-[4px] bg-paper-2 px-1.5 text-[11px] text-ink-3">已解除</span>
                    ) : hint && (
                      <span className={cx('shrink-0 rounded-[4px] px-1.5 text-[11px]', item.contactState === 'pending_incoming' ? 'bg-brand-soft text-brand-text' : 'bg-paper-2 text-ink-3')}>{hint}</span>
                    )}
                    <span className={cx('truncate text-[13px]', item.unread ? 'font-semibold text-ink-2' : 'text-ink-3')}>{previewOf(item)}</span>
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
