import { ArrowUpRight, Gift } from 'lucide-react';
import { Link } from 'react-router';
import { marginNoteStatusLabel, useBenefitsStatus } from '../lib/benefits';

export function BenefitBanner() {
  const { status, error } = useBenefitsStatus();
  return <Link to="/benefits" className="group flex items-start gap-3 rounded-[22px] border border-brand/15 bg-brand-softer p-5 text-ink transition-colors hover:bg-brand-soft sm:items-center sm:gap-5">
    <span aria-hidden="true" className="mt-1 grid size-16 shrink-0 place-items-center rounded-[20px] bg-[#F8BE57] text-[#713B12] shadow-[0_4px_12px_rgba(113,59,18,0.16)] ring-4 ring-[#F8BE57]/20 sm:mt-0 sm:size-[72px]">
      <Gift className="size-9 sm:size-10" strokeWidth={2.2} />
    </span>
    <div className="min-w-0 flex-1"><p className="text-xs font-semibold tracking-wider text-brand-text">品牌合作</p>
      <h2 className="mt-1 text-lg font-bold">学习工具福利</h2>
      <p className="mt-1 text-sm leading-relaxed text-ink-2">Xmind：50 AI 点数，共 200 份{!error && status?.xmind.remaining === 0 ? '，登记名额已满' : ''}</p>
      <p className="mt-1 text-sm leading-relaxed text-ink-2">MarginNote：3 个月 Max 订阅 · {marginNoteStatusLabel(status, error)}</p>
      <span className="mt-3 inline-block text-sm font-semibold text-brand-text">查看福利与参与方式 →</span></div>
    <ArrowUpRight aria-hidden="true" className="hidden shrink-0 text-brand-text transition-transform group-hover:translate-x-0.5 sm:block" size={23} />
  </Link>;
}
