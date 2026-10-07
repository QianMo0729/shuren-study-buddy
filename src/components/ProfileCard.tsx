import { motion } from 'motion/react';
import { GRADES, STATUSES, STUDY_TYPES, optionLabel } from '../../shared/options';
import { speciesOfNickname } from '../../shared/species';
import type { ProfileCard as Card } from '../../shared/types';
import { cx } from '../lib/format';
import { spring } from '../lib/motion';
import { Plate, Stamp } from './brand';
import { TIER_LABEL } from './match/labels';

/** 系统昵称 = 物种 + 编号（如「白鹭KLM23」），拆开排版 */
export function splitNickname(nick: string) {
  const m = /^(.*?)([A-Z]{3}\d{2})$/.exec(nick);
  return m && m[1] ? { word: m[1], code: m[2] } : { word: nick, code: '' };
}

/** 昵称：物种名用朱雀仿宋，编号用它的旧式西文数字 */
export function Nickname({ name, size = 18, className }: { name: string; size?: number; className?: string }) {
  const { word, code } = splitNickname(name);
  return (
    <span className={cx('inline-flex min-w-0 items-baseline gap-[0.35em] font-display', className)} style={{ fontSize: size }}>
      <span className="truncate text-ink">{word}</span>
      {code && <span className="shrink-0 text-[0.72em] tracking-[0.06em] text-ink-3">{code}</span>}
    </span>
  );
}

/** 兼容旧调用：头像 / 封面 */
export function Cover({ nickname, cover, className }: { id?: number; nickname: string; cover: string | null; studyType?: string; className?: string }) {
  return <Plate nickname={nickname} photo={cover} className={className} pad="10%" />;
}

export function StatusDot({ status, className }: { status: string; className?: string }) {
  const s = STATUSES.find((x) => x.value === status) ?? STATUSES[0];
  return <span className={cx('inline-block size-[7px] shrink-0 rounded-full', className)} style={{ background: s.color }} />;
}

/** 符合度：像批改一样写一个分数 */
export function MatchMeter({ score, total, className }: { score: number; total: number; className?: string }) {
  if (total <= 0) return null;
  const full = score >= total;
  return (
    <span className={cx('inline-flex items-baseline gap-0.5 rounded-sm px-1.5 py-0.5 font-display', full ? 'bg-seal text-[#fbf7f2]' : 'bg-surface/95 text-seal', className)} title={`符合 ${score} 项，共 ${total} 项`}>
      <span className="text-[17px] leading-none">{score}</span>
      <span className="text-[12px] leading-none opacity-80">/{total}</span>
    </span>
  );
}

/** 广场卡片：一条图鉴条目 */
export function ProfileCard({ card, onOpen, isAdmin, onTakedown, matchLabels, index = 0 }: {
  card: Card;
  onOpen: () => void;
  isAdmin?: boolean;
  onTakedown?: () => void;
  matchLabels?: (key: string) => string;
  index?: number;
}) {
  const type = STUDY_TYPES.find((t) => t.value === card.studyType);
  const status = STATUSES.find((s) => s.value === card.status);
  const sp = speciesOfNickname(card.nickname);

  return (
    <article className="group relative">
      <div
        role="button"
        tabIndex={0}
        onClick={onOpen}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onOpen())}
        className={cx(
          'relative cursor-pointer overflow-hidden rounded-md border bg-surface transition-colors duration-200',
          card.isMe ? 'border-seal/60' : 'border-line hover:border-line-strong',
        )}
      >
        <motion.div layoutId={`cover-${card.id}`} transition={spring} className="relative">
          <Plate nickname={card.nickname} photo={card.cover} className={card.recommendation ? 'aspect-[4/3]' : 'aspect-[4/5]'} reveal delay={Math.min(index, 8) * 0.06} />
          {card.isMe && <Stamp text="我的" size={36} rotate={-6} className="absolute top-3 left-3" />}
          {card.match && card.match.total > 0 && <MatchMeter score={card.match.score} total={card.match.total} className="absolute top-2.5 right-2.5" />}
          {card.recommendation && (
            <span className="absolute top-2.5 right-2.5 rounded-md border border-brand/15 bg-surface/95 px-2.5 py-1.5 text-brand-text shadow-sm" title="根据问卷信息计算的契合程度，不是成功概率">
              <span className="block text-[11px] leading-tight">{TIER_LABEL[card.recommendation.tier] ?? '契合度'}</span>
              <span className="font-display text-[23px] leading-tight tabular">{card.recommendation.score}</span>
              <span className="sr-only">，契合度 {card.recommendation.score}</span>
            </span>
          )}
        </motion.div>

        <div className="px-3.5 pt-3 pb-3.5 sm:px-4 sm:pt-3.5 sm:pb-4">
          <div className="flex items-start justify-between gap-2">
            <motion.div layoutId={`nick-${card.id}`} transition={spring} className="min-w-0">
              {card.remarkName ? <span className="block truncate font-display text-[19px] text-ink">{card.remarkName}</span> : <Nickname name={card.nickname} size={19} />}
            </motion.div>
            {type && <Stamp text={type.glyph} size={24} className="mt-0.5" />}
          </div>
          {card.remarkName ? <p className="mt-0.5 truncate text-[12px] text-ink-3">原昵称：{card.nickname}</p> : sp && <p className="latin mt-0.5 truncate text-[13px] text-ink-3">{sp.latin}</p>}

          <p className="mt-2.5 truncate text-[13.5px] text-ink">
            {card.major || '专业未填'}
            <span className="text-ink-3">{card.grade && ` · ${optionLabel(GRADES, card.grade)}`}</span>
          </p>
          <p className="mt-0.5 truncate text-[13px] text-ink-2">{type?.label || '—'}</p>

          {!!card.subjects?.length && (
            <ul className="mt-2 flex flex-wrap gap-1" aria-label="在学的科目">
              {card.subjects.slice(0, 3).map((subject) => <li key={subject} className="max-w-full truncate rounded-[4px] bg-brand-soft px-1.5 py-0.5 text-[12px] text-brand-text">{subject}</li>)}
              {card.subjects.length > 3 && <li className="px-0.5 py-0.5 text-[12px] text-ink-3">+{card.subjects.length - 3}</li>}
            </ul>
          )}
          {card.studyPlan && <p className="mt-2 line-clamp-2 text-[13px] leading-relaxed text-ink-2">{card.studyPlan}</p>}
          {!!card.planTags?.length && <p className="mt-1.5 line-clamp-1 text-xs text-brand-text">{card.planTags.join(' · ')}</p>}
          {card.recommendation && <ul className="mt-3 space-y-1.5 border-l-2 border-brand/25 pl-2 text-[12px] leading-relaxed text-ink-2" aria-label="推荐理由">{card.recommendation.reasons.slice(0, 2).map((reason) => <li key={reason} className="line-clamp-2">{reason}</li>)}</ul>}
          {card.match?.snippet ? (
            <p className="font-hand mt-2.5 line-clamp-2 text-[14px] leading-relaxed text-ink-2">「{card.match.snippet}」</p>
          ) : card.match && matchLabels && card.match.matched.length > 0 ? (
            <p className="mt-2.5 text-[12.5px] leading-relaxed text-ink-3">
              符合 <span className="text-ink-2">{card.match.matched.map(matchLabels).join('、')}</span>
            </p>
          ) : null}

          <div className="mt-3 flex items-center justify-between gap-2 border-t border-dashed border-line-strong pt-2.5 text-[12.5px]">
            <span className="inline-flex min-w-0 items-center gap-1.5 text-ink-3">
              <StatusDot status={card.status} />
              <span className="truncate">{status?.label}</span>
            </span>
            {!card.isMe && card.overlapHours > 0 && (
              <span className="shrink-0 text-seal tabular" title="与你每周的共同学习时间">
                同时段 {card.overlapHours} 小时
              </span>
            )}
          </div>

          {card.recommendation && <p className="mt-2 text-[11px] text-brand-text">查看 7 项契合度说明 →</p>}
          {isAdmin && !card.isMe && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onTakedown?.();
              }}
              className="mt-3 flex h-8 w-full items-center justify-center rounded border border-danger/35 text-[13px] text-danger transition-colors hover:bg-danger hover:text-white"
            >
              撤下此主页
            </button>
          )}
        </div>
      </div>
    </article>
  );
}

export function CardSkeleton() {
  return (
    <div className="overflow-hidden rounded-md border border-line bg-surface">
      <div className="skeleton aspect-[4/5]" />
      <div className="space-y-2.5 p-4">
        <div className="skeleton h-5 w-2/3 rounded" />
        <div className="skeleton h-3 w-1/2 rounded" />
        <div className="skeleton h-3 w-4/5 rounded" />
      </div>
    </div>
  );
}
