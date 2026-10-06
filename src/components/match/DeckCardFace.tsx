import { CircleAlert, Clock3, Compass } from 'lucide-react';
import { GRADES, optionLabel } from '../../../shared/options';
import type { DeckCard } from '../../../shared/types';
import { cx } from '../../lib/format';
import { Plate } from '../brand';
import { Nickname } from '../ProfileCard';
import { TIER_LABEL, hours } from './labels';

/**
 * 滑卡正面。信息按决策顺序排：契合度 → 学什么 → 为什么推荐 → 需要先聊的 → 共同时间；
 * 昵称与图版缩小放在角落，避免只凭外表做决定。
 * 手机上卡片矮、放不下全部内容：提醒排到理由前面并只留一条理由，被截掉的不能是唯一的反面信息。
 */
export function DeckCardFace({ card, onOpen }: { card: DeckCard; onOpen?: () => void }) {
  const r = card.recommendation;
  const subjects = card.subjects?.length ? card.subjects : [];
  const goals = card.planTags ?? [];
  const caution = r.cautions[0];
  return (
    <div className="flex h-full flex-col overflow-hidden rounded-md border border-line-strong bg-surface shadow-md select-none">
      <div className="flex items-start justify-between gap-3 px-4 pt-4 pb-3.5 sm:px-6 sm:pt-5 sm:pb-4">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-[12px] text-ink-3">
            问卷契合度
            {card.explore && (
              <span className="inline-flex items-center gap-1 rounded-[4px] bg-paper-2 px-1.5 py-0.5 text-[11px] text-ink-2" title="为避免推荐越来越窄，偶尔会推荐一些不同类型的同学">
                <Compass size={11} aria-hidden />
                换个方向
              </span>
            )}
          </p>
          <p className="mt-1 flex items-baseline gap-2 font-display leading-none whitespace-nowrap text-brand-text">
            <span className="text-[22px] sm:text-[26px]">{TIER_LABEL[r.tier]}</span>
            <span className="text-[40px] tabular sm:text-[46px]">{r.score}</span>
          </p>
        </div>
        <div className="flex min-w-0 max-w-[46%] items-center gap-2.5">
          <div className="min-w-0 text-right">
            <Nickname name={card.nickname} size={15} className="max-w-full justify-end" />
            <p className="mt-0.5 truncate text-[12px] text-ink-3">{[card.major, optionLabel(GRADES, card.grade)].filter(Boolean).join(' · ') || '专业未填'}</p>
          </div>
          <Plate nickname={card.nickname} photo={card.cover} className="size-12 shrink-0 rounded-[5px] border border-line" pad="8%" />
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-hidden border-t border-dashed border-line-strong px-4 pt-3.5 sm:gap-4 sm:px-6 sm:pt-4">
        <section aria-label="学习内容">
          <p className="mb-1.5 text-[12px] text-ink-3">{subjects.length ? '在学' : '近期目标'}</p>
          <div className="flex flex-wrap gap-1.5">
            {(subjects.length ? subjects : goals).slice(0, 5).map((item) => (
              <span key={item} className={cx('rounded-[5px] px-2 py-0.5 text-[14px]', subjects.length ? 'bg-brand-soft text-brand-text' : 'bg-paper-2 text-ink')}>{item}</span>
            ))}
            {!subjects.length && !goals.length && <span className="text-[13px] text-ink-4">未填写</span>}
          </div>
          {subjects.length > 0 && goals.length > 0 && <p className="mt-1.5 truncate text-[12.5px] text-ink-3 max-sm:hidden">目标：{goals.join(' · ')}</p>}
        </section>

        {r.reasons.length > 0 && (
          <section aria-label="推荐理由" className="max-sm:order-2">
            <ul className="space-y-1.5 border-l-2 border-brand/30 pl-3 text-[14px] leading-relaxed text-ink">
              {r.reasons.slice(0, 3).map((reason, i) => <li key={reason} className={cx('line-clamp-2', i > 0 && 'max-sm:hidden')}>{reason}</li>)}
            </ul>
          </section>
        )}

        {caution && (
          <p className="flex gap-2 rounded-[5px] bg-paper-2 px-3 py-2 text-[13px] leading-relaxed text-ink-2 max-sm:order-1">
            <CircleAlert size={15} className="mt-[3px] shrink-0 text-ink-3" aria-hidden />
            <span className="line-clamp-2"><span className="sr-only">提醒：</span>{caution}</span>
          </p>
        )}
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-line px-4 py-3 sm:px-6">
        <span className="inline-flex items-center gap-1.5 text-[14px] text-accent-text">
          <Clock3 size={15} aria-hidden />
          每周共同 <b className="font-semibold tabular">{hours(r.overlapHours)}</b> 小时
        </span>
        {onOpen && (
          <button type="button" onClick={onOpen} onPointerDownCapture={(e) => e.stopPropagation()} className="-my-2.5 -mr-2 px-2 py-2.5 text-[13px] font-semibold text-brand-text hover:underline">
            查看详情
          </button>
        )}
      </div>
    </div>
  );
}
