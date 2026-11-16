import { ArrowUpRight, Gift } from 'lucide-react';
import { Link } from 'react-router';
import { marginNoteStatusLabel, useBenefitsStatus } from '../lib/benefits';

export function BenefitBanner() {
  const { status, error } = useBenefitsStatus();
  return <Link to="/benefits" className="group flex items-center gap-4 rounded-[22px] border border-brand/15 bg-brand-softer p-5 text-ink transition-colors hover:bg-brand-soft">
    <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-surface text-brand-text"><Gift size={25} /></span>
    <div className="min-w-0 flex-1"><p className="text-xs font-semibold tracking-wider text-brand-text">品牌合作</p>
      <h2 className="mt-1 text-lg font-bold">学习工具福利</h2>
      <p className="mt-1 text-sm leading-relaxed text-ink-2">Xmind：50 AI 点数，共 200 份{!error && status?.xmind.remaining === 0 ? '，登记名额已满' : ''}</p>
      <p className="mt-1 text-sm leading-relaxed text-ink-2">MarginNote：3 个月 Max 订阅 · {marginNoteStatusLabel(status, error)}</p>
      <span className="mt-3 inline-block text-sm font-semibold text-brand-text">查看福利与参与方式 →</span></div>
    <ArrowUpRight className="shrink-0 text-brand-text transition-transform group-hover:translate-x-0.5" size={23} />
  </Link>;
}
