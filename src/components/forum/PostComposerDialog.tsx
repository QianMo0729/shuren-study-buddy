import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ForumPost } from '../../../shared/types';
import { Modal } from '../ui';
import { PostComposer } from './PostComposer';
import { PostCreateIcon } from './PostCreateIcon';

const FOCUSABLE = 'button:not([disabled]), a[href], input:not([disabled]):not([type="hidden"]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** 聊天区的草木加号入口；草稿仍由 PostComposer 按账号保存。 */
export function PostComposerDialog({ onDone }: { onDone: (post: ForumPost) => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const id = useId();
  const dialogId = `${id}-dialog`;
  const headingId = `${id}-heading`;
  const descriptionId = `${id}-description`;
  const close = useCallback(() => {
    if (!busy) setOpen(false);
  }, [busy]);

  // Shared Modal supplies the sheet, backdrop and Escape handling. Keep keyboard
  // focus within this composer and restore it to the launcher when it closes.
  useEffect(() => {
    if (!open) return;
    const dialog = contentRef.current?.closest<HTMLElement>('[role="dialog"]');
    if (!dialog) return;
    const trigger = triggerRef.current;
    dialog.id = dialogId;
    dialog.setAttribute('aria-labelledby', headingId);
    dialog.setAttribute('aria-describedby', descriptionId);
    const elements = () => [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.getClientRects().length > 0);
    const focusFirst = () => (contentRef.current?.querySelector<HTMLElement>('input:not([type="file"])') ?? elements()[0])?.focus({ preventScroll: true });
    focusFirst();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const items = elements();
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    const onFocus = (event: FocusEvent) => {
      if (event.target instanceof Node && !dialog.contains(event.target)) focusFirst();
    };
    dialog.addEventListener('keydown', onKeyDown);
    document.addEventListener('focusin', onFocus);
    return () => {
      dialog.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('focusin', onFocus);
      if (trigger?.isConnected) trigger.focus({ preventScroll: true });
    };
  }, [open, dialogId, headingId, descriptionId]);

  return (
    <>
      {createPortal(
        <button
          ref={triggerRef}
          type="button"
          onClick={() => setOpen(true)}
          aria-label="发布帖子"
          title="发布帖子"
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={open ? dialogId : undefined}
          className="group fixed right-3 bottom-[calc(58px+env(safe-area-inset-bottom)+12px)] z-40 grid size-20 place-items-center rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-text sm:right-5 md:bottom-[calc(env(safe-area-inset-bottom)+24px)] md:size-[84px] lg:right-8 motion-safe:transition-transform motion-safe:hover:-translate-y-1 motion-safe:active:scale-95"
        >
          <PostCreateIcon />
        </button>,
        document.body,
      )}
      <Modal open={open} onClose={close} dismissible={!busy} title={<span id={headingId}>发布帖子</span>} size="lg">
        <div ref={contentRef} className="px-5 pt-2 pb-5 sm:px-6 sm:pb-6">
          <p id={descriptionId} className="mb-4 text-[14px] leading-relaxed text-ink-3">分享校园生活、学习心得，和同学聊聊今天。</p>
          <PostComposer
            onDone={(post) => {
              setOpen(false);
              onDone(post);
            }}
            onCancel={close}
            onBusyChange={setBusy}
          />
          <p className="mt-3 text-[12px] text-ink-4">未发布的内容会自动保存为草稿。</p>
        </div>
      </Modal>
    </>
  );
}
