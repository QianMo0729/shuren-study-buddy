import type { Transition, Variants } from 'motion/react';

/** 全站统一的动效参数：快速、柔和、可打断 */
export const ease = [0.23, 1, 0.32, 1] as const;
export const spring: Transition = { type: 'spring', stiffness: 420, damping: 34, mass: 0.9 };
export const softSpring: Transition = { type: 'spring', stiffness: 260, damping: 30 };
export const layoutSpring: Transition = { type: 'spring', stiffness: 340, damping: 36 };

// 只动 transform 和 opacity：便宜、稳定，也不会影响页面内的 position: fixed 元素
export const page: Variants = {
  initial: { opacity: 0, y: 10 },
  enter: { opacity: 1, y: 0, transition: { duration: 0.36, ease } },
  exit: { opacity: 0, transition: { duration: 0.14 } },
};

export const stagger = (gap = 0.045, delay = 0): Variants => ({
  hidden: {},
  show: { transition: { staggerChildren: gap, delayChildren: delay } },
});

export const rise: Variants = {
  hidden: { opacity: 0, y: 14 },
  show: { opacity: 1, y: 0, transition: { duration: 0.45, ease } },
};

export const fade: Variants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { duration: 0.4, ease } },
};
