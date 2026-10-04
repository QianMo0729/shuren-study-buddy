import { useEffect, useRef, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type TouchEvent as ReactTouchEvent } from 'react';
import { Flag } from 'lucide-react';
import type { ChatMessage } from '../../../shared/types';
import { cx } from '../../lib/format';
import { Spinner } from '../ui';
import { fullTime } from './format';

/** 触屏长按（以及安卓长按触发的 contextmenu）打开操作面板；鼠标右键保留浏览器原生菜单 */
function useLongPress(onLongPress: () => void, ms = 480) {
  const timer = useRef<number | undefined>(undefined);
  const start = useRef<{ x: number; y: number } | null>(null);
  const pointer = useRef<string>('mouse');
  // 长按已经打开面板：松手时要吞掉浏览器随后补发的 click，否则会立刻点到面板背景把它关掉
  const fired = useRef(false);
  const clear = () => {
    if (timer.current !== undefined) window.clearTimeout(timer.current);
    timer.current = undefined;
  };
  useEffect(() => clear, []);
  return {
    onPointerDown: (e: ReactPointerEvent) => {
      pointer.current = e.pointerType;
      if (e.pointerType === 'mouse') return;
      start.current = { x: e.clientX, y: e.clientY };
      fired.current = false;
      clear();
      timer.current = window.setTimeout(() => { timer.current = undefined; fired.current = true; onLongPress(); }, ms);
    },
    onPointerMove: (e: ReactPointerEvent) => {
      if (timer.current !== undefined && start.current && Math.hypot(e.clientX - start.current.x, e.clientY - start.current.y) > 10) clear();
    },
    onPointerUp: clear,
    onTouchEnd: (e: ReactTouchEvent) => {
      if (!fired.current) return;
      fired.current = false;
      // touchend 不是被动监听，preventDefault 可以阻止随后合成的 mouse 事件与 click
      e.preventDefault();
    },
    onPointerCancel: clear,
    onPointerLeave: clear,
    onContextMenu: (e: ReactMouseEvent) => {
      if (pointer.current === 'mouse') return;
      e.preventDefault();
      if (timer.current !== undefined) { clear(); fired.current = true; onLongPress(); }
    },
  };
}

/** 系统消息：居中灰字 */
export function SystemNote({ message }: { message: ChatMessage }) {
  return (
    <li className="flex justify-center px-2 py-1.5">
      <p className="max-w-[88%] rounded-md bg-paper-2 px-3 py-1.5 text-center text-[12.5px] leading-relaxed text-ink-3" title={fullTime(message.createdAt)}>
        {message.body}
      </p>
    </li>
  );
}

/** 文字消息气泡：自己在右侧（墨色），对方在左侧；对方的消息可悬停 / 长按举报 */
export function MessageBubble({ message, pending, onActions, onReport }: {
  message: Pick<ChatMessage, 'body' | 'mine' | 'createdAt'> & { id?: number };
  pending?: boolean;
  /** 长按：打开操作面板（复制 / 举报） */
  onActions?: () => void;
  /** 悬停出现的举报按钮（仅对方的消息） */
  onReport?: () => void;
}) {
  const press = useLongPress(() => onActions?.());
  const mine = message.mine;
  return (
    <li className={cx('group flex items-end gap-1.5 px-1 py-[3px]', mine ? 'justify-end' : 'justify-start')}>
      {mine && pending && <Spinner className="mb-2 size-3.5 text-ink-4" />}
      <div
        {...(onActions ? press : {})}
        title={pending ? '发送中' : fullTime(message.createdAt)}
        className={cx(
          'max-w-[80%] rounded-lg px-3 py-2 text-[15px] leading-relaxed break-words whitespace-pre-wrap sm:max-w-[68%]',
          '[@media(pointer:coarse)]:select-none [@media(pointer:coarse)]:[-webkit-touch-callout:none]',
          mine ? 'rounded-br-[3px] bg-ink text-surface' : 'rounded-bl-[3px] border border-line bg-surface text-ink',
          pending && 'opacity-60',
        )}
      >
        {message.body}
        {pending && <span className="sr-only">（发送中）</span>}
      </div>
      {!mine && onReport && (
        <button
          type="button"
          onClick={onReport}
          aria-label="举报这条消息"
          title="举报这条消息"
          className="mb-1 grid size-7 shrink-0 place-items-center rounded-md text-ink-4 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-paper-2 hover:text-danger focus-visible:opacity-100 [@media(pointer:coarse)]:hidden"
        >
          <Flag size={14} />
        </button>
      )}
    </li>
  );
}
