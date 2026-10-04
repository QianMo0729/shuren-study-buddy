import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { SendHorizontal } from 'lucide-react';
import { cx } from '../../lib/format';
import { MESSAGE_MAX } from './format';

/**
 * 输入框：有实体键盘时 Enter 发送、Shift+Enter 换行（中文输入法选词时的 Enter 不会误发）；
 * 触屏设备的虚拟键盘没有 Shift，Enter 只换行，用发送按钮发送。
 * onSend 返回 false 表示发送失败，已清空的文字会放回输入框。
 */
export function Composer({ onSend, autoFocus }: { onSend: (body: string) => Promise<boolean>; autoFocus?: boolean }) {
  const [text, setText] = useState('');
  const ref = useRef<HTMLTextAreaElement>(null);
  const id = useId();
  const hintId = useId();
  const length = text.length;
  const trimmed = text.trim();
  const canSend = trimmed.length > 0 && trimmed.length <= MESSAGE_MAX;

  // 随内容自动增高，最多约 6 行
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 168)}px`;
  }, [text]);

  useEffect(() => {
    // 手机上自动弹出键盘会挡住聊天内容，只在有实体键盘的设备上自动聚焦
    if (autoFocus && window.matchMedia('(pointer: fine)').matches) ref.current?.focus({ preventScroll: true });
  }, [autoFocus]);

  // 触屏为主的设备：Enter 换行
  const touchFirst = typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;

  const submit = async () => {
    if (!canSend) return;
    const body = trimmed;
    setText('');
    const ok = await onSend(body);
    if (!ok) setText((current) => (current ? current : body));
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (touchFirst || e.key !== 'Enter' || e.shiftKey || e.altKey || e.ctrlKey || e.metaKey) return;
    // 输入法组字中（keyCode 229）按 Enter 是确认候选词，不是发送
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    e.preventDefault();
    void submit();
  };

  return (
    <form
      className="flex items-end gap-2 border-t border-line bg-surface px-3 py-2.5"
      onSubmit={(e) => { e.preventDefault(); void submit(); }}
    >
      <label htmlFor={id} className="sr-only">输入消息</label>
      <div className="relative min-w-0 flex-1">
        <textarea
          id={id}
          ref={ref}
          rows={1}
          value={text}
          maxLength={MESSAGE_MAX}
          enterKeyHint={touchFirst ? 'enter' : 'send'}
          aria-describedby={hintId}
          placeholder="说点什么…"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          className="block max-h-[168px] min-h-11 w-full resize-none rounded-md border border-line-strong bg-paper px-3.5 py-[9px] text-[16px] leading-[1.55] text-ink outline-none transition-[border-color,box-shadow] duration-150 focus:border-brand focus:shadow-[0_0_0_3px_var(--brand-soft)] sm:text-[15px]"
        />
        {length > MESSAGE_MAX - 200 && (
          <span className={cx('pointer-events-none absolute right-2.5 bottom-1 text-[11px] tabular', length >= MESSAGE_MAX ? 'text-danger' : 'text-ink-4')} aria-live="polite">
            {length}/{MESSAGE_MAX}
          </span>
        )}
      </div>
      <button
        type="submit"
        disabled={!canSend}
        aria-label="发送"
        title={touchFirst ? '发送' : '发送（Enter）'}
        className="grid size-11 shrink-0 place-items-center rounded-md bg-brand text-white transition-colors hover:bg-brand-2 disabled:bg-paper-2 disabled:text-ink-4"
      >
        <SendHorizontal size={19} />
      </button>
      <p id={hintId} className="sr-only">{touchFirst ? '点发送按钮发送，回车换行' : '按 Enter 发送，Shift 加 Enter 换行'}，每条最多 {MESSAGE_MAX} 字</p>
    </form>
  );
}
