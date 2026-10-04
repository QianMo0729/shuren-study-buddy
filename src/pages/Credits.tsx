import { Link } from 'react-router';
import { ChevronLeft } from 'lucide-react';
import { Plate, Wordmark } from '../components/brand';
import { useCredits } from '../components/credits';
import { GLYPH_SOURCE } from '../../server/watermarkFont';

/** 图版与照片出处：CC BY / CC BY-SA 要求署名，这里集中列出 */
export function Credits() {
  const { campus, plates } = useCredits();
  return (
    <div className="mx-auto max-w-[980px] px-5 pb-20 sm:px-8">
      <header className="flex h-16 items-center justify-between">
        <Link to="/" aria-label="树仁搭子">
          <Wordmark />
        </Link>
        <Link to="/" className="inline-flex items-center gap-0.5 text-[14px] text-ink-2 hover:text-ink">
          <ChevronLeft size={16} /> 返回首页
        </Link>
      </header>

      <h1 className="mt-8 border-b border-ink pb-4 font-display text-[40px] tracking-[-0.02em] text-ink sm:text-[56px]">图版与照片出处</h1>
      <p className="mt-5 max-w-[40em] text-[15px] leading-[1.85] text-ink-2">
        树仁搭子图鉴中的动植物图版均取自公有领域的博物学著作；校园照片来自维基共享资源（Wikimedia Commons），按各自的知识共享许可协议使用。感谢这些作者。
      </p>

      <h2 className="mt-14 font-display text-[26px] text-ink">校园照片</h2>
      <ul className="mt-5 divide-y divide-line border-y border-line">
        {campus.map((c) => (
          <li key={c.file} className="grid gap-4 py-4 sm:grid-cols-[160px_minmax(0,1fr)]">
            <img src={`/assets/campus/${c.file}`} alt="" className="aspect-[3/2] w-full rounded-sm object-cover" loading="lazy" />
            <div className="text-[14px] leading-relaxed">
              <p className="font-display text-[17px] text-ink">{c.subject}</p>
              <p className="text-ink-2">
                摄影：{c.author}　许可：
                <a href={c.licenseUrl} target="_blank" rel="noreferrer" className="underline decoration-line-strong underline-offset-2">
                  {c.license}
                </a>
              </p>
              <a href={c.sourceUrl} target="_blank" rel="noreferrer" className="break-all text-ink-3 underline decoration-line underline-offset-2 hover:text-ink">
                {c.title}
              </a>
            </div>
          </li>
        ))}
      </ul>

      <h2 className="mt-14 font-display text-[26px] text-ink">动植物图版</h2>
      <ul className="mt-5 grid gap-x-8 gap-y-6 sm:grid-cols-2">
        {plates.map((p) => (
          <li key={p.slug} className="grid grid-cols-[72px_minmax(0,1fr)] gap-4">
            <Plate nickname={p.zh} className="aspect-[4/5] rounded-sm" pad="6%" />
            <div className="min-w-0 text-[13.5px] leading-relaxed">
              <p>
                <span className="font-display text-[17px] text-ink">{p.zh}</span> <span className="latin text-ink-3">{p.latin}</span>
              </p>
              {p.author && <p className="truncate text-ink-2">{p.author}</p>}
              <p className="text-ink-3">{[p.date, p.license].filter(Boolean).join('，')}</p>
              <a href={p.sourceUrl} target="_blank" rel="noreferrer" className="block truncate text-ink-3 underline decoration-line underline-offset-2 hover:text-ink">
                {p.title}
              </a>
            </div>
          </li>
        ))}
      </ul>

      <h2 className="mt-14 font-display text-[26px] text-ink">打卡水印字体</h2>
      <div className="mt-5 border-y border-line py-4 text-[14px] leading-relaxed">
        <p className="font-display text-[17px] text-ink">{GLYPH_SOURCE}</p>
        <p className="mt-1 max-w-[46em] text-ink-2">
          学习打卡照片右下角的地点与时间水印，是服务器用 GNU Unifont 的 16 像素点阵字形逐像素盖上的。
          Unifont 由 Roman Czyborra、Paul Hardy、Qianqian Fang 等贡献者制作，以 SIL Open Font License 1.1 与 GNU GPL 2.0+（附字体嵌入例外）双许可发布，本站按
          <a href="https://openfontlicense.org/open-font-license-official-text/" target="_blank" rel="noreferrer" className="mx-0.5 underline decoration-line-strong underline-offset-2">
            SIL Open Font License 1.1
          </a>
          使用。
        </p>
        <a href="https://unifoundry.com/unifont/" target="_blank" rel="noreferrer" className="mt-1 inline-block break-all text-ink-3 underline decoration-line underline-offset-2 hover:text-ink">
          unifoundry.com/unifont
        </a>
      </div>
    </div>
  );
}
