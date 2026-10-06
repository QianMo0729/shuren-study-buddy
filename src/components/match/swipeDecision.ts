import type { FeedbackAction } from '../../../shared/types';

/** 左滑感兴趣，右滑不感兴趣；距离与快速甩动沿用同一组阈值。 */
export const SWIPE_THRESHOLD = 110;
const FLING_VELOCITY = 800;
export const FEEDBACK_EXIT_DIRECTION = { like: -1, dislike: 1 } as const;

export function feedbackForDrag(offsetX: number, velocityX: number): FeedbackAction | null {
  if (offsetX > SWIPE_THRESHOLD || velocityX > FLING_VELOCITY) return 'dislike';
  if (offsetX < -SWIPE_THRESHOLD || velocityX < -FLING_VELOCITY) return 'like';
  return null;
}

export function feedbackForKey(key: string): FeedbackAction | null {
  if (key === 'ArrowLeft') return 'like';
  if (key === 'ArrowRight') return 'dislike';
  if (key === 'ArrowDown') return 'skip';
  return null;
}
