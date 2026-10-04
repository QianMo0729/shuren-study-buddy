import { ChevronDown, Clock3, Info } from 'lucide-react';
import { RECOMMENDATION_TIERS } from '../../shared/options';
import type { RecommendationDimension, RecommendationInfo } from '../../shared/types';
import { TimeGrid } from './TimeGrid';

const format = (value: number) => (Number.isInteger(value) ? String(value) : value.toFixed(1));
const percent = (value: number) => Math.round(Math.max(0, Math.min(1, value)) * 100);

/** 契合度档位文字：很合拍 / 较合拍 / 可以聊聊 */
export const tierLabel = (tier: RecommendationInfo['tier']) => RECOMMENDATION_TIERS[tier]?.label ?? '';

/** 解释双向问卷契合度；分数不是匹配成功的概率 */
export function RecommendationDetails({ recommendation }: { recommendation: RecommendationInfo }) {
  const r = recommendation;
  const missing = r.dimensions.filter((dimension) => dimension.similarity === null);
  return (
    <section className="mt-6 overflow-hidden rounded-xl border border-brand/25 bg-brand-softer" aria-label="问卷契合度说明">
      <div className="flex items-start justify-between gap-4 p-4 sm:p-5">
        <div className="min-w-0">
          <p className="text-[12px] font-semibold tracking-[0.08em] text-brand-text">问卷匹配 · 为你推荐</p>
          <h3 className="mt-1 font-display text-[21px] text-ink">为什么推荐这位同学</h3>
          <p className="mt-1.5 text-[13px] leading-relaxed text-ink-2">
            TA 符合你的期待 <b className="font-semibold text-ink tabular">{r.forMe}%</b>
            <span className="mx-1.5 text-ink-4" aria-hidden>·</span>
            你符合 TA 的期待 <b className="font-semibold text-ink tabular">{r.forThem}%</b>
          </p>
        </div>
        <div className="shrink-0 text-center text-brand-text">
          <p className="text-[12px] font-semibold"><span className="sr-only">契合度：</span>{tierLabel(r.tier)}</p>
          <p className="font-display text-[38px] leading-tight tabular">{r.score}<span className="ml-0.5 text-[13px]">分</span></p>
        </div>
      </div>

      {r.reasons.length > 0 && (
        <ul className="mx-4 mb-4 space-y-1.5 border-l-2 border-brand/35 pl-3 text-[13.5px] text-ink-2 sm:mx-5" aria-label="推荐理由">
          {r.reasons.map((reason) => <li key={reason}>{reason}</li>)}
        </ul>
      )}
      {r.cautions.length > 0 && (
        <div className="mx-4 mb-4 rounded-lg bg-paper-2 px-3 py-2.5 sm:mx-5">
          <p className="text-[12px] font-semibold text-ink-2">见面前可以聊聊</p>
          <ul className="mt-1 space-y-1 text-[12.5px] leading-relaxed text-ink-2">{r.cautions.map((caution) => <li key={caution}>{caution}</li>)}</ul>
        </div>
      )}

      <div className="space-y-3 border-t border-brand/15 bg-surface/70 p-4 sm:p-5">
        <details className="group rounded-lg border border-line bg-surface px-3 py-2.5">
          <summary className="cursor-pointer list-none text-[13px] font-semibold text-ink">
            <span className="flex items-center gap-2">
              各项契合度（双向）
              <span className="ml-auto flex items-center gap-1 text-[11px] font-normal text-brand-text">
                <span className="group-open:hidden">展开明细</span><span className="hidden group-open:inline">收起</span>
                <ChevronDown size={14} className="transition-transform group-open:rotate-180" aria-hidden />
              </span>
            </span>
          </summary>
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11.5px] text-ink-3" aria-hidden>
            <span className="flex items-center gap-1.5"><span className="h-1.5 w-4 rounded-full bg-brand/70" />TA 符合你的期待</span>
            <span className="flex items-center gap-1.5"><span className="h-1.5 w-4 rounded-full bg-ink/35" />你符合 TA 的期待</span>
          </div>
          <div className="mt-1">{r.dimensions.map((dimension) => <DimensionRow key={dimension.key} dimension={dimension} />)}</div>
        </details>

        <details className="group rounded-lg border border-line bg-surface px-3 py-2.5">
          <summary className="cursor-pointer list-none text-[13px] font-semibold text-ink">
            <span className="flex items-center gap-2">
              <Clock3 size={15} className="text-accent" aria-hidden />每周共同时间 {format(r.overlapHours)} 小时
              <span className="ml-auto flex items-center gap-1 text-[11px] font-normal text-brand-text">
                <span className="group-open:hidden">展开时段</span><span className="hidden group-open:inline">收起</span>
                <ChevronDown size={14} className="transition-transform group-open:rotate-180" aria-hidden />
              </span>
            </span>
          </summary>
          <div className="mt-4"><TimeGrid value={r.commonSlots} readOnly /></div>
        </details>

        <p className="flex gap-2 text-[12px] leading-relaxed text-ink-3">
          <Info size={14} className="mt-0.5 shrink-0" aria-hidden />
          <span>
            总分取两个方向的调和平均，双方都满意才会高分。可比较信息覆盖 {r.coverage}% 权重
            {missing.length ? `；${missing.map((dimension) => dimension.label).join('、')}资料不足，按中性 50% 计入` : ''}。
            分数是问卷契合程度，不是匹配成功概率。
          </span>
        </p>
      </div>
    </section>
  );
}

function DimensionRow({ dimension }: { dimension: RecommendationDimension }) {
  const available = dimension.forMe !== null && dimension.forThem !== null;
  return (
    <div className="border-b border-line py-3 last:border-b-0 last:pb-1">
      <div className="flex items-baseline justify-between gap-3 text-[13px]">
        <p className="font-semibold text-ink">{dimension.label}<span className="ml-2 text-[11px] font-normal text-ink-3">权重 {dimension.weight}</span></p>
        <span className={available ? 'shrink-0 text-brand-text tabular' : 'shrink-0 text-ink-3'}>
          {available ? `${percent(dimension.similarity!)}%` : '资料不足 · 按中性计'}
        </span>
      </div>
      {available && (
        <div className="mt-2 space-y-1">
          <Bar label={`${dimension.label}：TA 符合你的期待`} value={dimension.forMe!} tone="bg-brand/70" />
          <Bar label={`${dimension.label}：你符合 TA 的期待`} value={dimension.forThem!} tone="bg-ink/35" />
        </div>
      )}
      <p className="mt-1.5 text-[12px] leading-relaxed text-ink-3">{dimension.detail}</p>
    </div>
  );
}

function Bar({ label, value, tone }: { label: string; value: number; tone: string }) {
  const n = percent(value);
  return (
    <div className="flex items-center gap-2">
      <div className="h-1 flex-1 overflow-hidden rounded-full bg-paper-2" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={n} aria-valuetext={`${n}%`}>
        <div className={`h-full rounded-full ${tone}`} style={{ width: `${n}%` }} />
      </div>
      <span className="w-9 shrink-0 text-right text-[11px] text-ink-3 tabular" aria-hidden>{n}%</span>
    </div>
  );
}
