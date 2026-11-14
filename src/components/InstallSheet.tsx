import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useInstall } from '../lib/pwa';
import { Illustration } from './brand';
import { AddSquareIcon, AlertIcon, ShareIcon } from './icons';

const KEY = 'dz-install-dismissed';
const dismissed = () => {
  try { return localStorage.getItem(KEY) === '1'; } catch { return false; }
};

/**
 * 「添加到主屏幕」底部面板：手机浏览器里第一次打开「今天」时弹出一次。
 * 已从主屏幕打开、在电脑上、浏览器不支持安装，或者点过「知道了 / 以后再说」后不再出现。
 */
export function InstallSheet() {
  const { mode, install } = useInstall();
  const [open, setOpen] = useState(false);
  const phone = typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches;
  const eligible = phone && (mode === 'ios' || mode === 'wechat' || mode === 'prompt') && !dismissed();

  useEffect(() => {
    if (!eligible) return;
    const timer = window.setTimeout(() => setOpen(true), 1200);
    return () => window.clearTimeout(timer);
  }, [eligible]);

  const close = () => {
    setOpen(false);
    try { localStorage.setItem(KEY, '1'); } catch {}
  };

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[80]">
          <motion.div className="absolute inset-0 bg-[rgba(20,24,22,0.38)]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={close} />
          <motion.section
            role="dialog"
            aria-modal="true"
            aria-labelledby="install-title"
            initial={{ y: '110%' }}
            animate={{ y: 0 }}
            exit={{ y: '110%' }}
            transition={{ type: 'spring', stiffness: 380, damping: 36 }}
            className="absolute inset-x-2 bottom-[max(8px,env(safe-area-inset-bottom))] flex flex-col gap-[18px] rounded-[34px] bg-surface px-5 pt-2.5 pb-[22px]"
          >
            <span className="h-[5px] w-9 self-center rounded-[3px] bg-[#D9D8D2]" aria-hidden />
            <div className="flex items-center gap-3.5">
              <Illustration name="mascot-cheer" className="size-16 shrink-0" />
              <div className="flex flex-col gap-[3px]">
                <h2 id="install-title" className="text-[20px] font-bold text-ink">放到主屏幕，像 App 一样用</h2>
                <p className="text-[14px] leading-5 text-ink-3">全屏打开，不用每次找链接，搭子发消息能及时看到</p>
              </div>
            </div>

            {mode === 'ios' && (
              <div className="overflow-hidden rounded-2xl bg-paper">
                <div className="flex h-[52px] items-center gap-3 px-4 text-[16px] text-ink">
                  <ShareIcon size={22} width={2} className="text-brand-text" />
                  <span>点 Safari 的<b>分享</b>按钮</span>
                </div>
                <div className="ml-[50px] h-[0.5px] bg-line" />
                <div className="flex h-[52px] items-center gap-3 px-4 text-[16px] text-ink">
                  <AddSquareIcon size={22} width={2} className="text-brand-text" />
                  <span>选<b>添加到主屏幕</b></span>
                </div>
              </div>
            )}

            {mode === 'wechat' && (
              <div className="flex items-start gap-2.5 px-1">
                <AlertIcon size={18} width={2} className="mt-px shrink-0 text-accent" />
                <p className="text-[14px] leading-5 text-ink">在微信里打开的？点右上角 <b>···</b> 选「在浏览器打开」，拍照打卡更稳定。</p>
              </div>
            )}

            <div className="flex flex-col gap-1.5">
              {mode === 'prompt' ? (
                <button type="button" onClick={() => { void install(); close(); }} className="h-[50px] rounded-[14px] bg-brand text-[17px] font-semibold text-white">安装到桌面</button>
              ) : (
                <button type="button" onClick={close} className="h-[50px] rounded-[14px] bg-brand text-[17px] font-semibold text-white">知道了</button>
              )}
              <button type="button" onClick={close} className="h-11 text-[16px] text-brand-text">以后再说</button>
            </div>
          </motion.section>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
