import { useState } from 'react';
import { PlusSquare, Share, X } from 'lucide-react';
import { useInstall } from '../lib/pwa';
import { Illustration } from './brand';

const KEY = 'dz-install-dismissed';
const dismissed = () => {
  try { return localStorage.getItem(KEY) === '1'; } catch { return false; }
};

/**
 * 「今天」页顶部的提示：把网站放到主屏幕，之后像 App 一样全屏打开。
 * 已经从主屏幕打开、在电脑上或关掉过一次之后不再显示。
 */
export function InstallCard() {
  const { mode, install } = useInstall();
  const [hidden, setHidden] = useState(dismissed);
  const phone = typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches;
  if (hidden || mode === 'installed' || mode === 'other' || (!phone && mode !== 'prompt')) return null;

  const close = () => {
    setHidden(true);
    try { localStorage.setItem(KEY, '1'); } catch {}
  };

  return (
    <section aria-label="添加到主屏幕" className="relative mb-5 flex gap-3.5 rounded-[22px] bg-surface p-4 pr-11 shadow-sm">
      <Illustration name="mascot-cheer" className="size-14 shrink-0" />
      <div className="min-w-0">
        <h2 className="text-[16px] font-bold text-ink">放到主屏幕，像 App 一样用</h2>
        {mode === 'wechat' ? (
          <p className="mt-1 text-[13.5px] leading-relaxed text-ink-2">在微信里打开的？点右上角 <b>···</b> 选「在浏览器打开」，再添加到主屏幕。拍照打卡在浏览器里也更稳定。</p>
        ) : mode === 'ios' ? (
          <p className="mt-1 text-[13.5px] leading-relaxed text-ink-2">
            点 Safari 的分享按钮 <Share size={14} className="inline -translate-y-px text-brand-text" aria-label="分享" />，再选「添加到主屏幕」<PlusSquare size={14} className="inline -translate-y-px text-brand-text" aria-hidden />。之后从桌面图标打开，就没有浏览器的地址栏了。
          </p>
        ) : (
          <>
            <p className="mt-1 text-[13.5px] leading-relaxed text-ink-2">全屏打开，不用每次找链接。</p>
            <button type="button" onClick={() => void install()} className="mt-2.5 h-9 rounded-full bg-brand px-4 text-[14px] font-semibold text-white hover:bg-brand-2">安装到桌面</button>
          </>
        )}
      </div>
      <button type="button" onClick={close} aria-label="不再提示" className="absolute top-2 right-2 grid size-9 place-items-center rounded-full text-ink-3 hover:bg-ink/[.05] hover:text-ink">
        <X size={17} aria-hidden />
      </button>
    </section>
  );
}
