import { motion } from 'motion/react';
import { useState } from 'react';
import { STUDY_TYPES } from '../../shared/options';
import { speciesOfNickname } from '../../shared/species';
import { fileUrl } from '../lib/api';
import { cx } from '../lib/format';
import { ease } from '../lib/motion';

/** 标志：书院院徽 + 「树仁搭子」 */
export function Wordmark({ className, size = 'md' }: { className?: string; size?: 'md' | 'lg' }) {
  return (
    <span className={cx('inline-flex items-center gap-2.5', className)}>
      <img src="/assets/brand/shield.png" alt="" className={cx('w-auto dark:hidden', size === 'lg' ? 'h-9' : 'h-7')} />
      <img src="/assets/brand/shield-white.png" alt="" className={cx('hidden w-auto opacity-85 dark:block', size === 'lg' ? 'h-9' : 'h-7')} />
      <span className={cx('font-display leading-none text-ink', size === 'lg' ? 'text-[24px]' : 'text-[20px]')}>树仁搭子</span>
    </span>
  );
}

/** 旧名保留，避免其它地方引用出错 */
export const Logo = Wordmark;

export const typeTone = (studyType: string) => STUDY_TYPES.find((t) => t.value === studyType)?.tone ?? '#005C65';

/**
 * 印章：朱砂色。1 字居中；2 字竖排；4 字按传统顺序（右列上下、左列上下）。
 * white = 白文（红底白字），否则朱文（红字红框）。
 */
export function Stamp({ text, size = 28, white = true, rotate = 0, className }: { text: string; size?: number; white?: boolean; rotate?: number; className?: string }) {
  const chars = [...text];
  const layout =
    chars.length === 4 ? 'grid-cols-2 grid-rows-2 [grid-auto-flow:column] [direction:rtl]' : chars.length === 2 ? 'grid-rows-2' : '';
  const fs = chars.length === 1 ? size * 0.6 : chars.length === 2 ? size * 0.4 : size * 0.38;
  return (
    <span
      aria-hidden
      className={cx('inline-grid shrink-0 place-items-center font-display leading-none', layout, className)}
      style={{
        width: size,
        height: size,
        fontSize: fs,
        transform: rotate ? `rotate(${rotate}deg)` : undefined,
        color: white ? '#fbf7f2' : 'var(--seal)',
        background: white ? 'var(--seal)' : 'transparent',
        boxShadow: white ? undefined : `inset 0 0 0 ${Math.max(1.5, size / 22)}px var(--seal)`,
        // 手工印章的边缘并不完全规整
        borderRadius: `${size * 0.1}px ${size * 0.14}px ${size * 0.08}px ${size * 0.12}px`,
        padding: chars.length > 1 ? size * 0.08 : 0,
      }}
    >
      {chars.map((c, i) => (
        <span key={i} className="block">
          {c}
        </span>
      ))}
    </span>
  );
}

/** 旧组件名：学习类型、活动分类的单字章 */
export function Seal({ char, size = 26, className }: { char: string; tone?: string; size?: number; solid?: boolean; className?: string }) {
  return <Stamp text={char} size={size} className={className} />;
}

/**
 * 图版：有照片用照片；没有照片时，显示昵称对应物种的博物画（裱在卡纸上）；
 * 找不到图版时，退回到一张只写着昵称首字的名签。
 */
export function Plate({
  nickname, photo, className, pad = '9%', reveal = false, delay = 0, fit = 'contain',
}: {
  nickname: string;
  photo?: string | null;
  className?: string;
  pad?: string;
  reveal?: boolean;
  delay?: number;
  fit?: 'contain' | 'cover';
}) {
  const sp = speciesOfNickname(nickname);
  const [failed, setFailed] = useState(false);
  const src = photo ? fileUrl(photo) : sp && !failed ? `/assets/species/${sp.slug}.jpg` : null;

  const inner = src ? (
    photo ? (
      <img src={src} alt={`${nickname} 的照片`} loading="lazy" className="h-full w-full object-cover" />
    ) : (
      <div className="grid h-full w-full place-items-center bg-mat" style={{ padding: pad }}>
        <img
          src={src}
          alt={sp ? `${sp.zh}（${sp.latin}）的博物画` : ''}
          loading="lazy"
          onError={() => setFailed(true)}
          className={cx('plate-img max-h-full max-w-full', fit === 'cover' ? 'h-full w-full object-cover' : 'object-contain')}
        />
      </div>
    )
  ) : (
    <div className="grid h-full w-full place-items-center">
      <span className="font-display text-[clamp(40px,38%,120px)] leading-none text-ink/25">{(sp?.zh ?? nickname).slice(0, 1)}</span>
    </div>
  );

  return (
    <div className={cx('relative overflow-hidden bg-mat', className)}>
      {reveal ? (
        <motion.div
          className="h-full w-full"
          initial={{ clipPath: 'inset(0 0 100% 0)' }}
          whileInView={{ clipPath: 'inset(0 0 0% 0)' }}
          viewport={{ once: true, margin: '-40px' }}
          transition={{ duration: 0.9, ease, delay }}
        >
          {inner}
        </motion.div>
      ) : (
        inner
      )}
    </div>
  );
}

/** 吉祥物插画位：把 GPT 生成的图片放到 public/assets 下同名文件即可显示；缺图时不显示任何东西 */
export function Illustration({ name, className }: { name: string; className?: string }) {
  const [ok, setOk] = useState(true);
  if (!ok) return null;
  return <img src={`/assets/${name}.png`} alt="" className={cx('object-contain', className)} onError={() => setOk(false)} />;
}
