import { useState } from 'react';

export type PartnerBrand = 'xmind' | 'marginnote';

// Original assets from the official websites. Never recolor or distort the marks.
const LOGOS = {
  xmind: 'https://assets.xmind.cn/www/assets/images/new-xmind-logo-dark-60f56e9142.svg',
  marginnote: 'https://www.marginnote.com/assets/mn5/mn5-logo.png',
};

export function PartnerLogo({ brand, size = 'default' }: { brand: PartnerBrand; size?: 'hero' | 'default' | 'compact' }) {
  const [failed, setFailed] = useState(false);
  const hero = size === 'hero';
  const compact = size === 'compact';
  return <span className={`inline-flex max-w-full items-center gap-3 rounded-2xl bg-white text-[#1c2320] ring-1 ring-black/5 ${hero ? 'p-4' : 'p-2'}`}>
    {brand === 'xmind' ? (failed ? <span className={hero ? 'text-4xl font-bold' : 'text-3xl font-bold'}>Xmind</span> :
      <img src={LOGOS.xmind} alt="Xmind" width={hero ? 256 : 176} height={hero ? 64 : 44} referrerPolicy="no-referrer" onError={() => setFailed(true)} className={hero ? 'h-16 w-64 max-w-full object-contain' : 'h-11 w-44 max-w-full object-contain'} />)
      : <>{!failed && <img src={LOGOS.marginnote} alt="" width={hero ? 88 : compact ? 40 : 56} height={hero ? 88 : compact ? 40 : 56} referrerPolicy="no-referrer" onError={() => setFailed(true)} className={`shrink-0 object-contain ${hero ? 'size-[88px]' : compact ? 'size-10' : 'size-14'}`} />}<span className={`font-bold tracking-tight ${hero ? 'text-2xl' : compact ? 'text-base' : 'text-lg'}`}>MarginNote 5</span></>}
  </span>;
}
