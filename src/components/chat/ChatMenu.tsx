import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { Ellipsis, type LucideIcon } from 'lucide-react';
import { cx } from '../../lib/format';
import { ease } from '../../lib/motion';

export interface ChatMenuItem {
  label: string;
  icon: LucideIcon;
  onSelect: () => void;
  danger?: boolean;
}

/** 聊天窗右上角的“更多”菜单：键盘可用（↑ ↓ 移动、Esc 关闭），点外面关闭 */
export function ChatMenu({ items }: { items: ChatMenuItem[] }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    list.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    const onPointer = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    window.addEventListener('pointerdown', onPointer);
    return () => window.removeEventListener('pointerdown', onPointer);
  }, [open]);

  const close = (refocus = true) => {
    setOpen(false);
    if (refocus) button.current?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const entries = [...(list.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])];
    const index = entries.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); entries[(index + 1) % entries.length]?.focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); entries[(index - 1 + entries.length) % entries.length]?.focus(); }
    else if (e.key === 'Home') { e.preventDefault(); entries[0]?.focus(); }
    else if (e.key === 'End') { e.preventDefault(); entries.at(-1)?.focus(); }
    else if (e.key === 'Tab') close(false);
  };

  return (
    <div ref={root} className="relative">
      <button
        ref={button}
        type="button"
        aria-label="更多操作"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((v) => !v)}
        className="grid size-10 place-items-center rounded-lg text-ink-2 transition-colors hover:bg-ink/[.06] hover:text-ink"
      >
        <Ellipsis size={20} />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            ref={list}
            id={menuId}
            role="menu"
            aria-label="更多操作"
            onKeyDown={onKeyDown}
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4, transition: { duration: 0.12 } }}
            transition={{ duration: 0.16, ease }}
            className="absolute top-11 right-0 z-20 w-52 overflow-hidden rounded-lg border border-line bg-surface p-1.5 shadow-lg"
          >
            {items.map((item) => (
              <button
                key={item.label}
                type="button"
                role="menuitem"
                tabIndex={-1}
                onClick={() => { close(false); item.onSelect(); }}
                className={cx(
                  'flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-[14px] outline-none',
                  item.danger ? 'text-danger hover:bg-danger-soft focus-visible:bg-danger-soft' : 'text-ink-2 hover:bg-paper-2 hover:text-ink focus-visible:bg-paper-2',
                )}
              >
                <item.icon size={16} strokeWidth={1.8} aria-hidden />
                {item.label}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
