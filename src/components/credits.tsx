import { useEffect, useState } from 'react';
import { cx } from '../lib/format';

export interface CampusCredit {
  file: string;
  title: string;
  subject: string;
  author: string;
  license: string;
  licenseUrl: string;
  sourceUrl: string;
  width: number;
  height: number;
}
export interface PlateCredit {
  slug: string;
  zh: string;
  latin: string;
  title: string;
  author: string;
  date: string;
  description: string;
  license: string;
  sourceUrl: string;
}

type Credits = { campus: CampusCredit[]; plates: PlateCredit[] };
let cache: Credits | null = null;
let pending: Promise<Credits> | null = null;

function load(): Promise<Credits> {
  if (cache) return Promise.resolve(cache);
  pending ??= Promise.all([
    fetch('/assets/campus/credits.json').then((r) => (r.ok ? r.json() : [])).catch(() => []),
    fetch('/assets/species/credits.json').then((r) => (r.ok ? r.json() : [])).catch(() => []),
  ]).then(([campus, plates]) => (cache = { campus, plates }));
  return pending;
}

export function useCredits() {
  const [c, setC] = useState<Credits>(cache ?? { campus: [], plates: [] });
  useEffect(() => {
    load().then(setC);
  }, []);
  return c;
}

export function usePlateCredit(slug: string | undefined) {
  const c = useCredits();
  return slug ? c.plates.find((p) => p.slug === slug) : undefined;
}

/** 校园照片：先显示纸色底，加载完成后淡入 */
export function CampusPhoto({ file, className, priority }: { file: string; className?: string; priority?: boolean }) {
  const [loaded, setLoaded] = useState(false);
  return (
    <div className={cx(className?.includes('absolute') ? '' : 'relative', 'overflow-hidden bg-mat', className)}>
      <img
        src={`/assets/campus/${file}`}
        srcSet={`/assets/campus/${file.replace('.jpg', '-1200.jpg')} 1200w, /assets/campus/${file} 2400w`}
        sizes="(max-width: 768px) 100vw, 1200px"
        alt=""
        loading={priority ? 'eager' : 'lazy'}
        onLoad={() => setLoaded(true)}
        className={cx('absolute inset-0 h-full w-full object-cover transition-opacity duration-700', loaded ? 'opacity-100' : 'opacity-0')}
      />
    </div>
  );
}
