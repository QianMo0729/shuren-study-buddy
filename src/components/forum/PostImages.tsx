import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { fileUrl } from '../../lib/api';
import { cx } from '../../lib/format';

/** 帖子图片网格：1 张横幅，2–4 张方格 */
export function ImageGrid({ images, onOpen, className }: { images: string[]; onOpen?: (index: number) => void; className?: string }) {
  if (!images.length) return null;
  const cols = images.length === 1 ? 'grid-cols-1' : images.length === 3 ? 'grid-cols-3' : 'grid-cols-2';
  return (
    <div className={cx('grid gap-1.5', cols, images.length === 1 ? 'max-w-[440px]' : 'max-w-[520px]', className)}>
      {images.map((name, i) => {
        const img = <img src={fileUrl(name)} alt={`图片 ${i + 1}`} loading="lazy" className="h-full w-full object-cover" />;
        const box = cx('overflow-hidden rounded-[5px] bg-mat', images.length === 1 ? 'aspect-[4/3]' : 'aspect-square');
        return onOpen ? (
          <button
            key={name}
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onOpen(i);
            }}
            className={cx(box, 'block cursor-zoom-in')}
            aria-label={`查看大图 ${i + 1} / ${images.length}`}
          >
            {img}
          </button>
        ) : (
          <div key={name} className={box}>{img}</div>
        );
      })}
    </div>
  );
}

/** 大图浏览：Esc 关闭，← → 切换 */
export function ImageLightbox({ images, index, onIndex, onClose }: { images: string[]; index: number | null; onIndex: (i: number) => void; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const open = index !== null && index >= 0 && index < images.length;
  useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const prevFocus = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    return () => {
      document.body.style.overflow = prevOverflow;
      prevFocus?.focus?.();
    };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft' && index! > 0) onIndex(index! - 1);
      if (e.key === 'ArrowRight' && index! < images.length - 1) onIndex(index! + 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, index, images.length, onClose, onIndex]);

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[90] flex items-center justify-center bg-[#0c1415]/90 p-3 sm:p-10"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          onClick={onClose}
          role="dialog"
          aria-modal="true"
          aria-label={`图片 ${index! + 1} / ${images.length}`}
        >
          <img
            src={fileUrl(images[index!])}
            alt={`图片 ${index! + 1}`}
            className="max-h-full max-w-full rounded-[4px] object-contain"
            onClick={(e) => e.stopPropagation()}
          />
          <button ref={closeRef} type="button" onClick={onClose} className="absolute top-3 right-3 grid size-10 place-items-center rounded-full bg-black/55 text-white ring-1 ring-white/25 hover:bg-black/75" aria-label="关闭大图">
            <X size={20} />
          </button>
          {images.length > 1 && (
            <>
              <span className="absolute top-5 left-1/2 -translate-x-1/2 text-[13px] text-white/80 tabular">{index! + 1} / {images.length}</span>
              <button
                type="button"
                disabled={index === 0}
                onClick={(e) => (e.stopPropagation(), onIndex(index! - 1))}
                className="absolute left-2 grid size-11 place-items-center rounded-full bg-black/55 text-white ring-1 ring-white/25 hover:bg-black/75 disabled:opacity-25 sm:left-5"
                aria-label="上一张"
              >
                <ChevronLeft size={22} />
              </button>
              <button
                type="button"
                disabled={index === images.length - 1}
                onClick={(e) => (e.stopPropagation(), onIndex(index! + 1))}
                className="absolute right-2 grid size-11 place-items-center rounded-full bg-black/55 text-white ring-1 ring-white/25 hover:bg-black/75 disabled:opacity-25 sm:right-5"
                aria-label="下一张"
              >
                <ChevronRight size={22} />
              </button>
            </>
          )}
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
