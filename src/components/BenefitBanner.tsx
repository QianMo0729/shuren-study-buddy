import { ArrowUpRight, Gift } from 'lucide-react';
import { Link } from 'react-router';

export function BenefitBanner() {
  return <Link to="/benefits" className="group flex items-center gap-4 rounded-[22px] border border-brand/15 bg-brand-softer p-5 text-ink transition-colors hover:bg-brand-soft">
    <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-surface text-brand-text"><Gift size={25} /></span>
    <div className="flex-1"><p className="text-xs font-semibold tracking-wider text-brand-text">品牌合作 · 学习工具福利</p>
      <h2 className="mt-1 text-lg font-bold">给学习加一点好工具</h2>
      <p className="mt-1 text-sm text-ink-2">Xmind AI 点数 · MarginNote 订阅福利</p></div>
    <ArrowUpRight className="shrink-0 text-brand-text transition-transform group-hover:translate-x-0.5" size={23} />
  </Link>;
}
