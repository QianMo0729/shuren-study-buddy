import { Clock3, Info } from 'lucide-react';
import type { RecommendationInfo } from '../../shared/types';
import { TimeGrid } from './TimeGrid';

const format = (value: number) => Number.isInteger(value) ? String(value) : value.toFixed(1);

/** Explain questionnaire compatibility without implying a probability of success. */
export function RecommendationDetails({ recommendation }: { recommendation: RecommendationInfo }) {
  const missing = recommendation.dimensions.filter((dimension) => dimension.similarity === null);
  return (
    <section className="mt-6 overflow-hidden rounded-xl border border-brand/25 bg-brand-softer" aria-label="问卷契合度说明">
      <div className="flex items-start justify-between gap-4 p-4 sm:p-5">
        <div className="min-w-0">
          <p className="text-[12px] font-semibold tracking-[0.08em] text-brand-text">问卷匹配 · 为你推荐</p>
          <h3 className="mt-1 font-display text-[21px] text-ink">为什么推荐这位同学</h3>
          <p className="mt-1.5 text-[13px] leading-relaxed text-ink-2">依据共同时间、学习目标等 7 项信息计算，帮助你比较学习安排。</p>
        </div>
        <div className="shrink-0 text-center text-brand-text">
          <p className="text-[11px]">契合度</p>
          <p className="font-display text-[38px] leading-tight tabular">{recommendation.score}<span className="ml-0.5 text-[13px]">分</span></p>
        </div>
      </div>
      {!!recommendation.reasons.length && <ul className="mx-4 mb-4 space-y-1.5 border-l-2 border-brand/35 pl-3 text-[13.5px] text-ink-2 sm:mx-5">{recommendation.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>}
      <div className="border-y border-brand/15 bg-surface/70 px-4 sm:px-5">
        {recommendation.dimensions.map((dimension) => {
          const available = dimension.similarity !== null;
          const similarity = Math.round(Math.max(0, Math.min(1, dimension.similarity ?? 0)) * 100);
          const contribution = available && recommendation.coverage > 0 ? dimension.similarity! * dimension.weight / recommendation.coverage * 100 : 0;
          return (
            <div key={dimension.key} className="border-b border-line py-3 last:border-b-0">
              <div className="flex items-baseline justify-between gap-3 text-[13px]">
                <p className="font-semibold text-ink">{dimension.label}<span className="ml-2 text-[11px] font-normal text-ink-3">权重 {dimension.weight}</span></p>
                <span className={available ? 'shrink-0 text-brand-text tabular' : 'shrink-0 text-ink-3'}>{available ? `贡献 ${contribution.toFixed(1)} 分` : '未计入'}</span>
              </div>
              {available && <div className="mt-2 h-1 overflow-hidden rounded-full bg-paper-2" role="meter" aria-label={`${dimension.label}匹配程度`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={similarity}><div className="h-full rounded-full bg-brand/70" style={{ width: `${similarity}%` }} /></div>}
              <p className="mt-1.5 text-[12px] leading-relaxed text-ink-3">{dimension.detail}</p>
            </div>
          );
        })}
      </div>
      <div className="space-y-4 p-4 sm:p-5">
        <details className="group rounded-lg border border-line bg-surface px-3 py-2.5">
          <summary className="cursor-pointer list-none text-[13px] font-semibold text-ink"><span className="flex items-center gap-2"><Clock3 size={15} className="text-brand-text" aria-hidden />每周共同时间 {format(recommendation.overlapHours)} 小时<span className="ml-auto text-[11px] font-normal text-brand-text group-open:hidden">展开时段</span><span className="ml-auto hidden text-[11px] font-normal text-brand-text group-open:inline">收起</span></span></summary>
          <div className="mt-4"><TimeGrid value={recommendation.commonSlots} readOnly /></div>
        </details>
        {!!recommendation.cautions.length && <div className="rounded-lg bg-paper-2 px-3 py-2.5"><p className="text-[12px] font-semibold text-ink-2">联系前可以聊聊</p><ul className="mt-1 space-y-1 text-[12.5px] leading-relaxed text-ink-2">{recommendation.cautions.map((caution) => <li key={caution}>{caution}</li>)}</ul></div>}
        <p className="flex gap-2 text-[12px] leading-relaxed text-ink-3"><Info size={14} className="mt-0.5 shrink-0" aria-hidden /><span>可比较信息覆盖 {recommendation.coverage}% 权重。{missing.length ? `${missing.map((dimension) => dimension.label).join('、')}资料不足，未计入分数；仅按已提供信息折算为 100 分。` : '7 项信息均可比较，按权重合计为 100 分。'}各项贡献展示到小数点后一位，总分四舍五入。分数是问卷契合程度，不是匹配成功概率。</span></p>
      </div>
    </section>
  );
}
