import { useState } from 'react';
import { ArrowUpRight } from 'lucide-react';
import { Link } from 'react-router';
import { marginNoteStatusLabel, useBenefitsStatus } from '../lib/benefits';

// Official website assets; preserve their proportions and original colors.
const XMIND_LOGO = 'https://assets.xmind.cn/www/assets/images/new-xmind-logo-dark-60f56e9142.svg';
const MARGINNOTE_LOGO = 'https://www.marginnote.com/assets/mn5/mn5-logo.png';

export function BenefitBanner() {
  const { status, error } = useBenefitsStatus();
  const [xmindLogoFailed, setXmindLogoFailed] = useState(false);
  const [mnLogoFailed, setMnLogoFailed] = useState(false);
  return <Link to="/benefits" className="group block overflow-hidden rounded-[24px] border border-brand/20 bg-surface text-ink shadow-sm transition-colors hover:border-brand/50">
    <div className="flex items-start justify-between gap-4 px-5 pt-5 sm:px-6 sm:pt-6">
      <div><p className="text-xs font-semibold tracking-wider text-brand-text">树仁搭子 × 品牌合作</p><h2 className="mt-1.5 text-[22px] font-bold">学习工具福利</h2></div>
      <span aria-hidden="true" className="grid size-10 shrink-0 place-items-center rounded-full bg-brand text-white"><ArrowUpRight className="transition-transform group-hover:translate-x-0.5" size={23} /></span>
    </div>
    <div className="grid gap-3 p-5 sm:grid-cols-2 sm:gap-4 sm:px-6">
      <div className="rounded-[18px] border border-[#efddce] bg-[#fff6ee] p-5 text-[#502e22]">
        <div className="flex h-[72px] items-center">
          {xmindLogoFailed ? <span className="text-3xl font-bold">Xmind</span> : <img src={XMIND_LOGO} alt="Xmind" width={176} height={44} referrerPolicy="no-referrer" onError={() => setXmindLogoFailed(true)} className="h-11 w-44 max-w-full object-contain object-left" />}
        </div>
        <p className="mt-4 text-[28px] leading-tight font-bold tracking-tight">50 <span className="text-lg font-semibold">AI 点数</span></p>
        <p className="mt-2 text-sm leading-relaxed text-[#795442]">共 200 份 · {!error && status?.xmind.remaining === 0 ? '登记名额已满' : '登记后统一发放'}</p>
      </div>
      <div className="rounded-[18px] border border-[#d5e3f2] bg-[#eef5ff] p-5 text-[#1c3657]">
        <div className="flex h-[72px] items-center gap-3">
          {!mnLogoFailed && <img src={MARGINNOTE_LOGO} alt="" width={64} height={64} referrerPolicy="no-referrer" onError={() => setMnLogoFailed(true)} className="size-16 shrink-0 object-contain" />}
          <span className="text-lg font-bold tracking-tight sm:text-xl">MarginNote 5</span>
        </div>
        <p className="mt-4 text-[28px] leading-tight font-bold tracking-tight">3 个月 <span className="text-lg font-semibold">Max 订阅</span></p>
        <p className="mt-2 text-sm leading-relaxed text-[#496486]">{marginNoteStatusLabel(status, error)}</p>
      </div>
    </div>
    <div className="flex items-center justify-between gap-3 border-t border-line px-5 py-4 text-sm font-semibold text-brand-text sm:px-6"><span>查看福利与参与方式</span><span aria-hidden="true">→</span></div>
  </Link>;
}
