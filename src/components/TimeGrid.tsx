import { useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { DAYS, PERIODS, slotIndex, slotsHours } from '../../shared/options';
import { cx } from '../lib/format';

/**
 * 学习时间表：
 * - 桌面：按住鼠标拖动即可连续涂抹 / 擦除
 * - 手机：轻点切换单格；长按后拖动可连续涂抹；点击星期或时段标题可整列 / 整行切换
 * - 只读模式可叠加「我的时间」，高亮你们的共同时段
 */
export function TimeGrid({
  value, onChange, readOnly, compare, compact,
}: {
  value: number[];
  onChange?: (v: number[]) => void;
  readOnly?: boolean;
  compare?: number[];
  compact?: boolean;
}) {
  const set = new Set(value);
  const cmp = new Set(compare ?? []);
  const gridRef = useRef<HTMLDivElement>(null);
  const paint = useRef<{ mode: 'add' | 'remove'; touched: Set<number> } | null>(null);
  const [pulse, setPulse] = useState<number | null>(null);
  const valueRef = useRef(value);
  valueRef.current = value;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const apply = (slot: number) => {
    const p = paint.current;
    const onChange = onChangeRef.current;
    if (!p || p.touched.has(slot) || !onChange) return;
    p.touched.add(slot);
    const cur = new Set(valueRef.current);
    if (p.mode === 'add') cur.add(slot);
    else cur.delete(slot);
    const next = [...cur].sort((a, b) => a - b);
    valueRef.current = next;
    onChange(next);
  };

  const slotAt = (x: number, y: number) => {
    const el = document.elementFromPoint(x, y) as HTMLElement | null;
    const s = el?.closest<HTMLElement>('[data-slot]')?.dataset.slot;
    return s === undefined ? null : Number(s);
  };

  const begin = (slot: number) => {
    paint.current = { mode: valueRef.current.includes(slot) ? 'remove' : 'add', touched: new Set() };
    apply(slot);
    setPulse(slot);
  };

  // 触摸：长按进入涂抹模式
  useEffect(() => {
    const grid = gridRef.current;
    if (!grid || readOnly) return;
    let timer = 0;
    let start: { x: number; y: number; slot: number | null } | null = null;
    let painting = false;
    const onStart = (e: TouchEvent) => {
      const t = e.touches[0];
      start = { x: t.clientX, y: t.clientY, slot: slotAt(t.clientX, t.clientY) };
      painting = false;
      clearTimeout(timer);
      timer = window.setTimeout(() => {
        if (start?.slot == null) return;
        painting = true;
        navigator.vibrate?.(8);
        begin(start.slot);
      }, 260);
    };
    const onMove = (e: TouchEvent) => {
      const t = e.touches[0];
      if (painting) {
        e.preventDefault();
        const s = slotAt(t.clientX, t.clientY);
        if (s != null) apply(s);
      } else if (start && Math.hypot(t.clientX - start.x, t.clientY - start.y) > 8) {
        clearTimeout(timer);
        start = null;
      }
    };
    const onEnd = (e: TouchEvent) => {
      clearTimeout(timer);
      if (!painting && start?.slot != null) {
        e.preventDefault();
        begin(start.slot);
      }
      painting = false;
      paint.current = null;
      start = null;
    };
    grid.addEventListener('touchstart', onStart, { passive: true });
    grid.addEventListener('touchmove', onMove, { passive: false });
    grid.addEventListener('touchend', onEnd, { passive: false });
    return () => {
      grid.removeEventListener('touchstart', onStart);
      grid.removeEventListener('touchmove', onMove);
      grid.removeEventListener('touchend', onEnd);
    };
  }, [readOnly]);

  useEffect(() => {
    const up = () => (paint.current = null);
    window.addEventListener('pointerup', up);
    return () => window.removeEventListener('pointerup', up);
  }, []);

  const toggleMany = (slots: number[]) => {
    if (!onChange) return;
    const all = slots.every((s) => set.has(s));
    const cur = new Set(value);
    slots.forEach((s) => (all ? cur.delete(s) : cur.add(s)));
    onChange([...cur].sort((a, b) => a - b));
  };

  const presets: { label: string; slots: number[] }[] = [
    { label: '工作日晚上', slots: [0, 1, 2, 3, 4].flatMap((d) => [5, 6, 7].map((p) => slotIndex(d, p))) },
    { label: '周末白天', slots: [5, 6].flatMap((d) => [0, 1, 3, 4].map((p) => slotIndex(d, p))) },
    { label: '午间碎片', slots: [0, 1, 2, 3, 4].map((d) => slotIndex(d, 2)) },
  ];

  const overlapCount = compare ? value.filter((s) => cmp.has(s)).length : 0;

  return (
    <div>
      {!readOnly && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {presets.map((p) => (
            <button
              key={p.label}
              type="button"
              onClick={() => toggleMany(p.slots)}
              className="h-8 rounded-md border border-line-strong bg-surface px-2.5 text-[13px] text-ink-2 transition-colors hover:border-ink-4 hover:text-ink"
            >
              {p.label}
            </button>
          ))}
          {value.length > 0 && (
            <button type="button" onClick={() => onChange?.([])} className="h-8 rounded-md px-2 text-[13px] text-ink-3 hover:text-danger">
              清空
            </button>
          )}
        </div>
      )}
      <div
        ref={gridRef}
        className={cx('grid select-none', compact ? 'gap-[3px]' : 'gap-1')}
        style={{ gridTemplateColumns: `${compact ? '2.6rem' : '3.6rem'} repeat(7, minmax(0, 1fr))` }}
        onPointerDown={(e) => {
          if (readOnly || e.pointerType === 'touch' || e.button !== 0) return;
          const s = slotAt(e.clientX, e.clientY);
          if (s != null) {
            e.preventDefault();
            begin(s);
          }
        }}
        onPointerMove={(e) => {
          if (readOnly || e.pointerType === 'touch' || !paint.current) return;
          const s = slotAt(e.clientX, e.clientY);
          if (s != null) apply(s);
        }}
      >
        <div />
        {DAYS.map((d, di) => (
          <button
            type="button"
            key={d}
            disabled={readOnly}
            onClick={() => toggleMany(PERIODS.map((_, p) => slotIndex(di, p)))}
            className={cx('pb-1 text-center text-[12px] text-ink-3', !readOnly && 'rounded hover:text-ink')}
          >
            {compact ? d.slice(1) : d}
          </button>
        ))}
        {PERIODS.map((p, pi) => (
          <div key={p.label} className="contents">
            <button
              type="button"
              disabled={readOnly}
              onClick={() => toggleMany(DAYS.map((_, d) => slotIndex(d, pi)))}
              className={cx('flex flex-col items-end justify-center pr-2 text-right leading-tight', !readOnly && 'hover:text-ink')}
            >
              <span className={cx('text-ink-2', compact ? 'text-[10px]' : 'text-[12px]')}>{p.label}</span>
              {!compact && <span className="text-[10.5px] text-ink-4 tabular">{p.time}</span>}
            </button>
            {DAYS.map((_, di) => {
              const s = slotIndex(di, pi);
              const on = set.has(s);
              const mine = cmp.has(s);
              const both = on && mine;
              return (
                <motion.div
                  key={s}
                  data-slot={s}
                  role={readOnly ? undefined : 'checkbox'}
                  aria-label={`${DAYS[di]} ${p.label} ${p.time}`}
                  aria-checked={readOnly ? undefined : on}
                  tabIndex={readOnly ? undefined : 0}
                  onKeyDown={(e) => {
                    if (!readOnly && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); begin(s); paint.current = null; }
                  }}
                  animate={pulse === s ? { scale: [1, 0.86, 1] } : undefined}
                  transition={{ duration: 0.28 }}
                  onAnimationComplete={() => pulse === s && setPulse(null)}
                  className={cx(
                    'relative rounded-[4px] transition-colors duration-100',
                    compact ? 'h-5' : 'h-8 sm:h-9',
                    !readOnly && 'cursor-pointer',
                    both
                      ? 'bg-accent'
                      : on
                        ? 'bg-brand'
                        : mine
                          ? 'bg-brand-soft'
                          : 'bg-paper-2 hover:bg-line',
                  )}
                >
                </motion.div>
              );
            })}
          </div>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[13px] text-ink-3">
        {compare ? (
          <>
            <Legend className="bg-brand" label="TA 的时间" />
            <Legend className="bg-brand-soft" label="你的时间" />
            <Legend className="bg-accent" label={`共同时间：${overlapCount} 个时段，${slotsHours(value.filter((s) => cmp.has(s)))} 小时/周`} />
          </>
        ) : (
          <span className="tabular">
            已选 {value.length} 个时段，约 {slotsHours(value)} 小时/周
            {!readOnly && <span className="ml-2 text-ink-4">电脑上可以按住拖动；手机上长按后拖动</span>}
          </span>
        )}
      </div>
    </div>
  );
}

function Legend({ className, label }: { className: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cx('size-3 rounded-[3px]', className)} />
      {label}
    </span>
  );
}
