import { animate, motion, useMotionValue, useReducedMotion, useTransform, type PanInfo } from 'motion/react';
import { useCallback, useEffect, useLayoutEffect, useRef, type ReactNode } from 'react';
import { Clock3, Heart, Undo2, X } from 'lucide-react';
import type { DeckCard, FeedbackAction } from '../../shared/types';
import { cx } from '../lib/format';
import { ease } from '../lib/motion';
import { DeckCardFace } from './match/DeckCardFace';
import { TIER_LABEL } from './match/labels';

/** 拖过这个距离（或甩得足够快）就算做出选择 */
const THRESHOLD = 110;
const FLING_VELOCITY = 800;
const VISIBLE = 3;

/**
 * 滑卡：一次一张大卡，后面叠两张。右滑 / ♥ 感兴趣，左滑 / ✕ 不感兴趣，「稍后再看」把卡片收起。
 * 键盘：← 不感兴趣、→ 感兴趣、↓ 稍后再看。只负责展示与手势，反馈请求由调用方处理。
 */
export function SwipeDeck({ cards, onDecide, onOpen, onUndo, canUndo, undoing, active = true, header, className }: {
  cards: DeckCard[];
  /** 卡片上方左侧的说明（如个性化提示）；右侧固定放「撤销上一步」 */
  header?: ReactNode;
  onDecide: (card: DeckCard, action: FeedbackAction) => void;
  onOpen: (card: DeckCard) => void;
  onUndo?: () => void;
  canUndo?: boolean;
  undoing?: boolean;
  /** 有弹窗或浮层打开时关闭键盘操作 */
  active?: boolean;
  className?: string;
}) {
  const reduced = useReducedMotion();
  const x = useMotionValue(0);
  const lift = useMotionValue(0);
  const fade = useMotionValue(1);
  const rotate = useTransform(x, [-320, 0, 320], [-12, 0, 12]);
  const likeOpacity = useTransform(x, [24, THRESHOLD], [0, 1]);
  const nopeOpacity = useTransform(x, [-THRESHOLD, -24], [1, 0]);
  const busy = useRef(false);
  const pressAt = useRef<{ x: number; y: number } | null>(null);
  const top = cards[0];

  // 换到下一张时，在绘制前把位移复位，避免旧位置闪一下
  useLayoutEffect(() => {
    x.set(0);
    lift.set(0);
    fade.set(1);
    busy.current = false;
  }, [top?.id, x, lift, fade]);

  const commit = useCallback(async (action: FeedbackAction) => {
    if (!top || busy.current) return;
    busy.current = true;
    if (!reduced) {
      if (action === 'skip') {
        await Promise.all([
          animate(lift, -90, { duration: 0.24, ease }),
          animate(fade, 0, { duration: 0.24, ease }),
        ]);
      } else {
        const width = typeof window === 'undefined' ? 800 : window.innerWidth;
        await animate(x, (action === 'like' ? 1 : -1) * (width * 0.6 + 260), { duration: 0.26, ease });
      }
    }
    onDecide(top, action);
  }, [top, reduced, x, lift, fade, onDecide]);

  const onDragEnd = (_: unknown, info: PanInfo) => {
    if (info.offset.x > THRESHOLD || info.velocity.x > FLING_VELOCITY) void commit('like');
    else if (info.offset.x < -THRESHOLD || info.velocity.x < -FLING_VELOCITY) void commit('dislike');
    else animate(x, 0, { type: 'spring', stiffness: 480, damping: 34 });
  };

  useEffect(() => {
    if (!active || !top) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) || el.closest('[role="dialog"],[role="menu"],[role="radiogroup"]'))) return;
      const action = ({ ArrowLeft: 'dislike', ArrowRight: 'like', ArrowDown: 'skip' } as Record<string, FeedbackAction>)[e.key];
      if (!action) return;
      e.preventDefault();
      void commit(action);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, top, commit]);

  const stack = cards.slice(0, VISIBLE);

  return (
    <div className={cx('mx-auto w-full max-w-[440px]', className)}>
      <div className="mb-3 flex min-h-7 items-start justify-between gap-3">
        <div className="min-w-0">{header}</div>
        {canUndo && onUndo && (
          <button type="button" onClick={onUndo} disabled={undoing} className="inline-flex shrink-0 items-center gap-1 rounded-[5px] border border-line-strong bg-surface px-2 py-1 text-[12.5px] text-ink-2 hover:text-ink disabled:opacity-50">
            <Undo2 size={13} aria-hidden />
            撤销上一步
          </button>
        )}
      </div>
      <div className="relative h-[clamp(360px,calc(100dvh-430px),540px)]" role="region" aria-roledescription="滑卡" aria-label="推荐的同学">
        {stack.map((card, index) => {
          const isTop = index === 0;
          return (
            <motion.div
              key={card.id}
              className="absolute inset-0"
              style={{ zIndex: VISIBLE - index }}
              initial={false}
              animate={{ scale: 1 - index * 0.045, y: index * 14, opacity: index === VISIBLE - 1 ? 0.6 : 1 }}
              transition={reduced ? { duration: 0 } : { type: 'spring', stiffness: 380, damping: 32 }}
              aria-hidden={!isTop}
            >
              {isTop ? (
                <motion.div
                  className="relative h-full cursor-grab touch-pan-y active:cursor-grabbing"
                  style={{ x, y: lift, rotate, opacity: fade }}
                  drag="x"
                  dragMomentum={false}
                  dragElastic={1}
                  onDragEnd={onDragEnd}
                  onPointerDown={(event) => { pressAt.current = { x: event.clientX, y: event.clientY }; }}
                  onTap={(event, info) => {
                    // 拖动过、或点在卡片内的按钮上，都不算“点开”
                    const start = pressAt.current;
                    if (!start || Math.hypot(info.point.x - start.x - window.scrollX, info.point.y - start.y - window.scrollY) > 8) return;
                    if ((event.target as HTMLElement | null)?.closest('button')) return;
                    onOpen(card);
                  }}
                  role="group"
                  aria-label={`${card.nickname}，${TIER_LABEL[card.recommendation.tier]}，契合度 ${card.recommendation.score}`}
                >
                  <DeckCardFace card={card} onOpen={() => onOpen(card)} />
                  <motion.span style={{ opacity: likeOpacity }} className="pointer-events-none absolute top-[30%] left-5 -rotate-12 rounded-[6px] border-[3px] border-seal px-2.5 py-1 font-display text-[24px] text-seal" aria-hidden>
                    感兴趣
                  </motion.span>
                  <motion.span style={{ opacity: nopeOpacity }} className="pointer-events-none absolute top-[30%] right-5 rotate-12 rounded-[6px] border-[3px] border-ink-3 px-2.5 py-1 font-display text-[24px] text-ink-3" aria-hidden>
                    不感兴趣
                  </motion.span>
                </motion.div>
              ) : (
                <div className="pointer-events-none h-full">
                  <DeckCardFace card={card} />
                </div>
              )}
            </motion.div>
          );
        })}
      </div>

      <div className="mt-5 flex items-start justify-center gap-6 sm:mt-6 sm:gap-8">
        <DeckButton label="不感兴趣" hint="←" onClick={() => void commit('dislike')} disabled={!top} className="size-14 border border-line-strong bg-surface text-ink-2 hover:border-ink-3 hover:text-ink">
          <X size={26} strokeWidth={2.2} />
        </DeckButton>
        <DeckButton label="稍后再看" hint="↓" onClick={() => void commit('skip')} disabled={!top} className="mt-1.5 size-11 border border-line bg-surface text-ink-3 hover:text-ink">
          <Clock3 size={19} />
        </DeckButton>
        <DeckButton label="感兴趣" hint="→" onClick={() => void commit('like')} disabled={!top} className="size-14 bg-brand text-white hover:bg-brand-2">
          <Heart size={24} strokeWidth={2.2} className="fill-current" />
        </DeckButton>
      </div>
      <p className="mt-3 hidden text-center text-[12.5px] text-ink-4 md:block">键盘：← 不感兴趣 · → 感兴趣 · ↓ 稍后再看</p>
    </div>
  );
}

function DeckButton({ label, hint, onClick, disabled, className, children }: {
  label: string; hint: string; onClick: () => void; disabled?: boolean; className: string; children: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-1.5">
      <motion.button
        type="button"
        whileTap={{ scale: 0.92 }}
        onClick={onClick}
        disabled={disabled}
        aria-label={`${label}（快捷键 ${hint}）`}
        className={cx('grid place-items-center rounded-full shadow-sm transition-colors disabled:opacity-40', className)}
      >
        {children}
      </motion.button>
      <span className="text-[12px] text-ink-3" aria-hidden>{label}</span>
    </div>
  );
}
