import { PERSONALITY_ITEMS } from '../../../shared/options';
import type { Personality } from '../../../shared/types';
import { cx } from '../../lib/format';

/** 学习性格：每项一条 5 格小刻度，标出 TA 的选择；未回答的题目不显示 */
export function PersonalityScale({ personality }: { personality: Personality }) {
  const answered = PERSONALITY_ITEMS.filter((item) => personality[item.key] >= 1 && personality[item.key] <= 5);
  if (!answered.length) return <p className="text-[14px] text-ink-4">未填写</p>;
  return (
    <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
      {answered.map((item) => {
        const value = personality[item.key];
        return (
          <div key={item.key} className="min-w-0">
            <dt className="flex items-baseline justify-between gap-2 text-[13.5px] text-ink">
              {item.label}
              <span className="sr-only">：{value} / 5（1 = {item.low}，5 = {item.high}）</span>
            </dt>
            <dd className="mt-1.5" aria-hidden>
              <div className="flex gap-1">
                {[1, 2, 3, 4, 5].map((n) => (
                  <span key={n} className={cx('h-1.5 flex-1 rounded-full', n === value ? 'bg-brand' : 'bg-paper-2')} />
                ))}
              </div>
              <div className="mt-1 flex justify-between gap-2 text-[11.5px] text-ink-3">
                <span className={cx('truncate', value <= 2 && 'text-ink-2')}>{item.low}</span>
                <span className={cx('truncate text-right', value >= 4 && 'text-ink-2')}>{item.high}</span>
              </div>
            </dd>
          </div>
        );
      })}
    </dl>
  );
}
