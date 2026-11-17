export type PartnerBrand = 'xmind' | 'marginnote';

// Original marks from the partners' official websites, kept with the site so they load without
// calling out to another server. Never recolor or distort them. Sources are listed in docs/合作福利MVP.md.
const LOGOS = {
  xmind: '/partners/logos/xmind.svg',
  marginnote: '/partners/logos/marginnote.png',
};

export function PartnerLogo({ brand, size = 'default' }: { brand: PartnerBrand; size?: 'hero' | 'default' | 'compact' }) {
  const hero = size === 'hero';
  const compact = size === 'compact';
  // The white plate keeps the original colors legible on the dark theme.
  return <span className={`inline-flex max-w-full items-center gap-3 rounded-2xl bg-white text-[#1c2320] ring-1 ring-black/5 ${hero ? 'p-3 sm:p-4' : 'p-2'}`}>
    {brand === 'xmind'
      ? <img src={LOGOS.xmind} alt="Xmind" width={hero ? 256 : 176} height={hero ? 64 : 44} className={hero ? 'h-11 w-44 max-w-full object-contain sm:h-16 sm:w-64' : 'h-11 w-44 max-w-full object-contain'} />
      : <><img src={LOGOS.marginnote} alt="" width={hero ? 88 : compact ? 40 : 56} height={hero ? 88 : compact ? 40 : 56} className={`shrink-0 object-contain ${hero ? 'size-14 sm:size-[88px]' : compact ? 'size-10' : 'size-14'}`} /><span className={`font-bold tracking-tight ${hero ? 'text-xl sm:text-2xl' : compact ? 'text-base' : 'text-lg'}`}>MarginNote 5</span></>}
  </span>;
}
