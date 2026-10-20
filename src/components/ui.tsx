import { AnimatePresence, motion, useDragControls, type HTMLMotionProps } from 'motion/react';
import {
  forwardRef, useEffect, useId, useState, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes,
} from 'react';
import { createPortal } from 'react-dom';
import { Check, Lock, X } from 'lucide-react';
import { cx } from '../lib/format';
import { ease, spring } from '../lib/motion';

// ---------------- Button ----------------

type Variant = 'primary' | 'secondary' | 'ghost' | 'soft' | 'danger' | 'dangerOutline' | 'dark';
type Size = 'sm' | 'md' | 'lg';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-brand text-white hover:bg-brand-2 active:bg-brand-2',
  secondary: 'bg-surface text-ink border border-line-strong hover:border-ink-4 hover:bg-surface-2',
  ghost: 'text-ink-2 hover:bg-ink/[.05] hover:text-ink',
  soft: 'bg-brand-soft text-brand-text hover:bg-brand-soft/70',
  danger: 'bg-danger text-white hover:opacity-90',
  dangerOutline: 'bg-surface text-danger border border-danger/40 hover:bg-danger hover:text-white',
  dark: 'bg-ink text-surface hover:opacity-90',
};
const SIZES: Record<Size, string> = {
  sm: 'h-8 px-3 text-[13px] gap-1.5 rounded-[5px]',
  md: 'h-10 px-4 text-[14px] gap-1.5 rounded-md',
  lg: 'h-11 px-5 text-[15px] gap-2 rounded-md',
};

export interface ButtonProps extends Omit<HTMLMotionProps<'button'>, 'children'> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: ReactNode;
  iconRight?: ReactNode;
  children?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', loading, icon, iconRight, children, className, disabled, ...rest },
  ref,
) {
  return (
    <motion.button
      ref={ref}
      whileTap={disabled || loading ? undefined : { scale: 0.97 }}
      transition={{ duration: 0.12 }}
      disabled={disabled || loading}
      className={cx(
        'relative inline-flex shrink-0 items-center justify-center font-semibold whitespace-nowrap transition-colors duration-150 select-none disabled:opacity-45',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...rest}
    >
      {loading ? <Spinner /> : icon}
      {children}
      {!loading && iconRight}
    </motion.button>
  );
});

export function IconButton({ className, label, children, ...rest }: HTMLMotionProps<'button'> & { label: string; children: ReactNode }) {
  return (
    <motion.button
      whileTap={{ scale: 0.94 }}
      transition={{ duration: 0.12 }}
      aria-label={label}
      title={label}
      className={cx('grid size-9 place-items-center rounded-lg text-ink-2 transition-colors hover:bg-ink/[.06] hover:text-ink', className)}
      {...rest}
    >
      {children}
    </motion.button>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <svg className={cx('size-4 animate-spin', className)} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity=".25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

// ---------------- Layout ----------------

/** 页面标题：一行标题 + 一句说明，右侧放操作 */
export function PageHeader({ title, desc, actions, className }: { title: ReactNode; desc?: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <header className={cx('flex flex-wrap items-end justify-between gap-x-6 gap-y-3 border-b border-ink pt-7 pb-5 mb-6 sm:pt-12', className)}>
      <div className="min-w-0">
        <h1 className="font-display text-[34px] leading-[1.1] tracking-[-0.02em] text-ink sm:text-[46px]">{title}</h1>
        {desc && <p className="mt-2.5 max-w-[40em] text-[15px] text-ink-2">{desc}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </header>
  );
}

/** 白色内容面板（放在浅灰页面上） */
export function Panel({ children, className, id }: { children: ReactNode; className?: string; id?: string }) {
  return (
    <section id={id} className={cx('rounded-md border border-line bg-surface p-5 sm:p-6', className)}>
      {children}
    </section>
  );
}

export function SectionTitle({ title, desc, aside, className }: { title: ReactNode; desc?: ReactNode; aside?: ReactNode; className?: string }) {
  return (
    <div className={cx('mb-4 flex items-start justify-between gap-4', className)}>
      <div>
        <h2 className="font-display text-[20px] text-ink">{title}</h2>
        {desc && <p className="mt-0.5 text-[13.5px] text-ink-3">{desc}</p>}
      </div>
      {aside}
    </div>
  );
}

// ---------------- Form ----------------

export function Field({
  label, required, optional, privateNote, hint, error, children, className, id, aside,
}: {
  label: ReactNode;
  required?: boolean;
  optional?: boolean;
  privateNote?: string;
  hint?: ReactNode;
  error?: string | null;
  children: ReactNode;
  className?: string;
  id?: string;
  aside?: ReactNode;
}) {
  return (
    <div className={cx('scroll-mt-28', className)} id={id}>
      <div className="mb-2 flex items-center gap-2">
        <label className="text-[14px] font-semibold text-ink">
          {label}
          {required && (
            <span className="ml-0.5 text-danger" aria-label="必填">
              *
            </span>
          )}
        </label>
        {optional && <span className="text-[12.5px] text-ink-4">选填</span>}
        {privateNote && (
          <span className="inline-flex items-center gap-1 text-[12.5px] text-ink-3">
            <Lock size={11} strokeWidth={2} />
            {privateNote}
          </span>
        )}
        {aside && <div className="ml-auto">{aside}</div>}
      </div>
      {children}
      {error ? (
        <p className="mt-1.5 text-[13px] text-danger" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="mt-1.5 text-[13px] leading-relaxed text-ink-3">{hint}</p>
      ) : null}
    </div>
  );
}

const inputBase =
  'w-full rounded-md border border-line-strong bg-surface px-3.5 text-[16px] text-ink outline-none transition-[border-color,box-shadow] duration-150 hover:border-ink-4 focus:border-brand focus:shadow-[0_0_0_3px_var(--brand-soft)] disabled:opacity-60 sm:text-[15px]';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean; leading?: ReactNode; trailing?: ReactNode }>(
  function Input({ className, invalid, leading, trailing, ...rest }, ref) {
    if (leading || trailing) {
      return (
        <div className="relative">
          {leading && <span className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-ink-3">{leading}</span>}
          <input
            ref={ref}
            className={cx(inputBase, 'h-11', leading && 'pl-10', trailing && 'pr-11', invalid && 'border-danger!', className)}
            aria-invalid={invalid || undefined}
            {...rest}
          />
          {trailing && <span className="absolute top-1/2 right-2 -translate-y-1/2">{trailing}</span>}
        </div>
      );
    }
    return <input ref={ref} className={cx(inputBase, 'h-11', invalid && 'border-danger!', className)} aria-invalid={invalid || undefined} {...rest} />;
  },
);

export function Textarea({ className, maxLength, value, invalid, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }) {
  const len = String(value ?? '').length;
  return (
    <div className="relative">
      <textarea
        className={cx(inputBase, 'min-h-28 resize-y py-2.5 leading-relaxed', maxLength && 'pb-7', invalid && 'border-danger!', className)}
        maxLength={maxLength}
        value={value}
        {...rest}
      />
      {maxLength && (
        <span className={cx('pointer-events-none absolute right-3 bottom-2 text-[12px] tabular', len >= maxLength ? 'text-danger' : 'text-ink-4')}>
          {len}/{maxLength}
        </span>
      )}
    </div>
  );
}

// ---------------- Chips ----------------

export function Chip({
  selected, onClick, children, size = 'md', className, disabled,
}: {
  selected?: boolean;
  onClick?: () => void;
  children: ReactNode;
  size?: 'sm' | 'md';
  className?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={selected}
      className={cx(
        'inline-flex items-center gap-1 rounded-md border transition-colors duration-150 active:scale-[.97]',
        size === 'sm' ? 'h-8 px-2.5 text-[13px]' : 'h-9 px-3 text-[14px]',
        selected ? 'border-brand bg-brand text-white' : 'border-line-strong bg-surface text-ink-2 hover:border-ink-4 hover:text-ink',
        className,
      )}
    >
      {selected && <Check size={13} strokeWidth={2.6} className="-ml-0.5" />}
      {children}
    </button>
  );
}

export function ChipGroup<T extends { value: string; label: string }>({
  options, value, onChange, multi, size,
}: {
  options: T[];
  value: string[];
  onChange: (v: string[]) => void;
  multi?: boolean;
  size?: 'sm' | 'md';
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => {
        const on = value.includes(o.value);
        return (
          <Chip
            key={o.value}
            size={size}
            selected={on}
            onClick={() => onChange(multi ? (on ? value.filter((v) => v !== o.value) : [...value, o.value]) : on ? [] : [o.value])}
          >
            {o.label}
          </Chip>
        );
      })}
    </div>
  );
}

/** 分段控件（参考 iOS），指示块平滑滑动 */
export function Segmented({
  options, value, onChange, className,
}: {
  options: { value: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
  className?: string;
}) {
  const id = useId();
  return (
    <div className={cx('inline-flex rounded-lg bg-paper-2 p-[3px]', className)} role="radiogroup">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.value)}
            className={cx('relative h-8 min-w-16 rounded-md px-3.5 text-[14px] transition-colors', on ? 'font-semibold text-ink' : 'text-ink-3 hover:text-ink-2')}
          >
            {on && <motion.span layoutId={`seg-${id}`} transition={spring} className="absolute inset-0 rounded-md bg-surface shadow-[0_1px_3px_rgba(23,32,34,.12),0_0_0_.5px_rgba(23,32,34,.06)]" />}
            <span className="relative">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode }) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-2.5 select-none">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cx('relative h-[26px] w-[44px] shrink-0 rounded-full transition-colors duration-200', checked ? 'bg-brand' : 'bg-ink/15')}
      >
        <motion.span layout transition={spring} className={cx('absolute top-[3px] size-5 rounded-full bg-white shadow-sm', checked ? 'right-[3px]' : 'left-[3px]')} />
      </button>
      {label && <span className="text-[14px] text-ink-2">{label}</span>}
    </label>
  );
}

export function Tag({ children, tone = 'neutral', className }: { children: ReactNode; tone?: 'neutral' | 'brand' | 'accent' | 'danger' | 'gold'; className?: string }) {
  const tones = {
    neutral: 'bg-paper-2 text-ink-2',
    brand: 'bg-brand-soft text-brand-text',
    accent: 'bg-accent-soft text-accent-text',
    danger: 'bg-danger-soft text-danger',
    gold: 'bg-[color-mix(in_oklab,var(--gold)_14%,transparent)] text-gold',
  };
  return <span className={cx('inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[12.5px] whitespace-nowrap', tones[tone], className)}>{children}</span>;
}

// ---------------- Modal / Sheet ----------------

let bodyLockCount = 0;
let bodyOverflowBeforeLock = '';

/** 嵌套弹窗与资料浮层共用计数，任意顺序卸载都不会留下滚动锁。 */
export function useLockBody(open: boolean) {
  useEffect(() => {
    if (!open) return;
    if (bodyLockCount === 0) bodyOverflowBeforeLock = document.body.style.overflow;
    bodyLockCount += 1;
    document.body.style.overflow = 'hidden';
    return () => {
      bodyLockCount -= 1;
      if (bodyLockCount === 0) document.body.style.overflow = bodyOverflowBeforeLock;
    };
  }, [open]);
}

export function useIsMobile(bp = 640) {
  const [m, setM] = useState(() => typeof window !== 'undefined' && window.innerWidth < bp);
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${bp - 1}px)`);
    const on = () => setM(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [bp]);
  return m;
}

/** 桌面端居中弹窗、移动端底部抽屉（可下拉关闭） */
export function Modal({
  open, onClose, children, title, size = 'md', dismissible = true,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  title?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
  dismissible?: boolean;
}) {
  useLockBody(open);
  const mobile = useIsMobile();
  const dragControls = useDragControls();
  useEffect(() => {
    if (!open || !dismissible) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, dismissible, onClose]);
  const widths = { sm: 'sm:max-w-[400px]', md: 'sm:max-w-[480px]', lg: 'sm:max-w-2xl' };
  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[80] flex items-end justify-center sm:items-center sm:p-6">
          <motion.div
            className="absolute inset-0 bg-[#0c1415]/40"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={() => dismissible && onClose()}
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            className={cx('relative flex max-h-[90dvh] w-full flex-col overflow-hidden rounded-t-2xl bg-surface shadow-lg sm:rounded-2xl', widths[size])}
            initial={mobile ? { y: '100%' } : { opacity: 0, scale: 0.98 }}
            animate={mobile ? { y: 0 } : { opacity: 1, scale: 1 }}
            exit={mobile ? { y: '100%' } : { opacity: 0, scale: 0.98 }}
            transition={mobile ? { type: 'spring', stiffness: 420, damping: 40 } : { duration: 0.18, ease }}
            drag={mobile && dismissible ? 'y' : false}
            // Let the content scroll natively; only the handle starts a sheet drag.
            dragListener={false}
            dragControls={dragControls}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.6 }}
            onDragEnd={(_, info) => {
              if (info.offset.y > 120 || info.velocity.y > 600) onClose();
            }}
          >
            {mobile && (
              <div
                aria-hidden="true"
                className={cx('flex shrink-0 justify-center pt-2 pb-3', dismissible && 'touch-none cursor-grab')}
                onPointerDown={(event) => dismissible && dragControls.start(event)}
              >
                <div className="h-1 w-9 rounded-full bg-ink/15" />
              </div>
            )}
            {title !== undefined && (
              <div className="flex shrink-0 items-center justify-between px-5 pt-1 sm:px-6 sm:pt-5">
                <h3 className="font-display text-[20px] text-ink">{title}</h3>
                {dismissible && (
                  <IconButton label="关闭" onClick={onClose} className="-mr-2">
                    <X size={18} />
                  </IconButton>
                )}
              </div>
            )}
            <div className="safe-bottom min-h-0 overflow-y-auto overscroll-contain">{children}</div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

export function ConfirmDialog({
  open, title, desc, confirmText = '确认', cancelText = '取消', onConfirm, onCancel, loading, tone = 'primary',
}: {
  open: boolean;
  title: ReactNode;
  desc?: ReactNode;
  confirmText?: string;
  cancelText?: string;
  onConfirm: () => void;
  onCancel: () => void;
  loading?: boolean;
  tone?: 'primary' | 'danger';
}) {
  return (
    <Modal open={open} onClose={onCancel} size="sm">
      <div className="px-6 pt-6 pb-5">
        <h3 className="font-display text-[21px] text-ink">{title}</h3>
        {desc && <div className="mt-2 text-[14px] leading-relaxed text-ink-2">{desc}</div>}
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="secondary" onClick={onCancel} disabled={loading}>
            {cancelText}
          </Button>
          <Button variant={tone === 'danger' ? 'danger' : 'primary'} onClick={onConfirm} loading={loading}>
            {confirmText}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ---------------- 其他 ----------------

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx('skeleton rounded-lg', className)} />;
}

export function SectionLabel({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cx('text-[13px] font-semibold text-ink-3', className)}>{children}</p>;
}

/** 空状态：说明 + 下一步 */
export function Empty({ title, desc, action, art }: { title: string; desc?: string; action?: ReactNode; art?: ReactNode }) {
  return (
    <div className="flex flex-col items-center rounded-md border border-line bg-surface px-6 py-14 text-center">
      {art}
      <p className="font-display text-[20px] text-ink">{title}</p>
      {desc && <p className="mt-1 max-w-[26em] text-[14px] text-ink-3">{desc}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
