import { AnimatePresence, motion } from 'motion/react';
import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { CalendarClock, ChevronLeft, ChevronRight, Clock3, Flag, Link2, Pencil, ShieldX, Star, UserRoundX, X } from 'lucide-react';
import { collegeOf } from '../../shared/majors';
import {
  DISLIKE_OPTIONS, DURATIONS, FREQUENCIES, GENDERS, GRADES, INTERESTS, PLACES, STATUSES, STUDY_FORMATS, STUDY_METHODS, STUDY_TYPES, optionLabel, overlapSlots, slotsHours,
} from '../../shared/options';
import type { AdvancedQuery, MatchInfo, PublicProfile, RecommendationInfo } from '../../shared/types';
import { expand, tokenize } from '../../shared/searchText';
import { api, ApiError, fileUrl } from '../lib/api';
import { useAuth } from '../lib/auth';
import { cx, timeAgo } from '../lib/format';
import { ease, spring } from '../lib/motion';
import { useToast } from '../lib/toast';
import { Button, ConfirmDialog, IconButton } from './ui';
import { Plate, Stamp, typeTone } from './brand';
import { usePlateCredit } from './credits';
import { speciesOfNickname } from '../../shared/species';
import { Nickname, StatusDot } from './ProfileCard';
import { TimeGrid } from './TimeGrid';
import { RecommendationDetails } from './RecommendationDetails';
import { ReportDialog, TakedownDialog } from './moderation';
import { MatchBar, MatchButtons, MatchCelebrationFor, useMatchActions } from './match/MatchActions';
import { MoreMenu } from './match/MoreMenu';
import { PersonalityScale } from './match/PersonalityScale';

export function ProfileDetail({ profile, onClose, onChanged, inOverlay, match, searchQuery, keyword, recommendation }: { profile: PublicProfile; onClose?: () => void; onChanged?: () => void; inOverlay?: boolean; match?: MatchInfo; searchQuery?: AdvancedQuery; keyword?: string; recommendation?: RecommendationInfo }) {
  const { user } = useAuth();
  const toast = useToast();
  const nav = useNavigate();
  const [fav, setFav] = useState(profile.isFavorite);
  const [favBusy, setFavBusy] = useState(false);
  const [report, setReport] = useState(false);
  const [takedown, setTakedown] = useState(false);
  const [excluding, setExcluding] = useState(false);
  const [excludeBusy, setExcludeBusy] = useState(false);
  const actions = useMatchActions(profile, onChanged);
  const leave = () => { onChanged?.(); onClose ? onClose() : nav('/match'); };
  const publicPhotos = profile.isMe || profile.photoVisibility === 'public' ? profile.photos : [];
  const matchedFields = new Set((match?.matched ?? []).filter((key) => /^\d+:/.test(key)).map((key) => key.slice(key.indexOf(':') + 1)));
  const matched = (...fields: string[]) => fields.some((field) => matchedFields.has(field));
  const words = [...new Set([
    ...tokenize(keyword ?? ''),
    ...(searchQuery?.criteria.filter((item) => item.field === 'text' && item.mode !== 'not').flatMap((item) => item.values) ?? []),
  ].flatMap(expand))];
  const bioMatched = matched('text') || !!match?.matched.some((key) => key.endsWith('·自我介绍')) || words.some((word) => profile.bio.toLowerCase().includes(word));
  const type = STUDY_TYPES.find((t) => t.value === profile.studyType);
  const tone = typeTone(profile.studyType);
  const overlap = overlapSlots(profile.schedule, profile.mySchedule);
  const overlapH = slotsHours(overlap);
  const college = collegeOf(profile.major);
  const sp = speciesOfNickname(profile.nickname);
  const plateCredit = usePlateCredit(sp?.slug);

  const facts = [
    { k: '专业', v: profile.major + (college && college !== '其他' ? `（${college}）` : '') },
    { k: '年级', v: optionLabel(GRADES, profile.grade) },
    { k: '性别', v: optionLabel(GENDERS, profile.gender) },
    { k: 'MBTI', v: profile.mbti },
  ].filter((f) => f.v);
  const format = optionLabel(STUDY_FORMATS, profile.studyFormat);
  const deadline = deadlineText(profile.goalDeadline);

  return (
    <div className="grid md:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] md:gap-8">
      {/* 照片 */}
      <div className="relative md:sticky md:top-0 md:h-fit">
        <motion.div layoutId={inOverlay ? `cover-${profile.id}` : undefined} transition={spring} className="relative aspect-[4/3] overflow-hidden bg-mat md:aspect-[4/5] md:rounded-md">
          {publicPhotos.length ? <Photos photos={publicPhotos} /> : <Plate nickname={profile.nickname} className="h-full w-full" pad="8%" />}
        </motion.div>
        {!publicPhotos.length && sp && (
          <figcaption className="px-5 pt-3 text-[13px] leading-relaxed text-ink-3 md:px-0">
            <p>
              <span className="font-display text-[15px] text-ink-2">{sp.zh}</span> <span className="latin">{sp.latin}</span>
            </p>
            <p className="mt-0.5 text-ink-2">{sp.note}</p>
            {plateCredit && (
              <p className="mt-1">
                图版：
                <a href={plateCredit.sourceUrl} target="_blank" rel="noreferrer" className="underline decoration-line-strong underline-offset-2 hover:text-ink">
                  {plateCredit.author || plateCredit.title}
                  {plateCredit.date ? `，${plateCredit.date}` : ''}
                </a>
                ，公有领域
              </p>
            )}
          </figcaption>
        )}
        {onClose && (
          <IconButton label="关闭" onClick={onClose} className="absolute top-3 left-3 bg-surface/90 shadow-sm md:hidden">
            <X size={18} />
          </IconButton>
        )}
      </div>

      {/* 信息 */}
      <div className="min-w-0 px-5 pt-5 pb-10 md:px-0 md:pt-1">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <p className={cx('flex items-center gap-1.5 text-[13px] text-ink-3', matched('status') && 'rounded-md bg-brand-soft px-2 py-1 text-brand-text')}>
              <StatusDot status={profile.status} />
              {optionLabel(STATUSES, profile.status)}
              {profile.publishedAt && <span>· {timeAgo(profile.publishedAt)}上传</span>}
            </p>
            <motion.h2 layoutId={inOverlay ? `nick-${profile.id}` : undefined} transition={spring} className="mt-1.5">
              <Nickname name={profile.nickname} size={32} />
            </motion.h2>
            <p className="mt-1 text-[15px] text-ink-2">{[profile.major, optionLabel(GRADES, profile.grade)].filter(Boolean).join('，')}</p>
          </div>
          {onClose && (
            <IconButton label="关闭" onClick={onClose} className="-mt-1 -mr-2 hidden md:grid">
              <X size={20} />
            </IconButton>
          )}
        </div>

        {/* 操作 */}
        <div className="mt-5 flex flex-wrap items-center gap-2">
          {profile.isMe ? (
            <Button variant="primary" icon={<Pencil size={15} />} onClick={() => nav('/me/edit')}>
              编辑我的主页
            </Button>
          ) : (
            <>
              <div className="mr-1 hidden md:block">
                <MatchButtons actions={actions} />
              </div>
              <Button
                variant={fav ? 'soft' : 'secondary'}
                loading={favBusy}
                icon={<Star size={15} className={fav ? 'fill-current' : ''} />}
                onClick={async () => {
                  if (favBusy) return;
                  setFavBusy(true);
                  try {
                    const r = await api.favorite(profile.id);
                    setFav(r.isFavorite);
                    toast.success(r.isFavorite ? '已收藏' : '已取消收藏');
                    onChanged?.();
                  } catch (e) {
                    toast.error('操作失败', e instanceof ApiError ? e.message : undefined);
                  } finally {
                    setFavBusy(false);
                  }
                }}
              >
                {fav ? '已收藏' : '收藏'}
              </Button>
              <IconButton
                label="复制主页链接"
                onClick={async () => {
                  try {
                    if (!navigator.clipboard) throw new Error();
                    await navigator.clipboard.writeText(`${location.origin}/u/${profile.id}`);
                    toast.success('主页链接已复制');
                  } catch { toast.error('复制失败', '请从浏览器地址栏复制主页链接'); }
                }}
              >
                <Link2 size={17} />
              </IconButton>
              <IconButton label="举报" onClick={() => setReport(true)} className="text-ink-3 hover:text-danger">
                <Flag size={16} />
              </IconButton>
              <MoreMenu items={[{ label: '排除这位同学', icon: <UserRoundX size={15} aria-hidden />, tone: 'danger', onSelect: () => setExcluding(true) }]} />
            </>
          )}
          {user?.role === 'admin' && !profile.isMe && (
            <Button variant="dangerOutline" size="sm" icon={<ShieldX size={14} />} onClick={() => setTakedown(true)} className="ml-auto">
              撤下此主页
            </Button>
          )}
        </div>

        {!profile.isMe && !recommendation && overlapH > 0 && (
          <p className="mt-5 flex items-center gap-2 text-[14px] text-ink-2">
            <Clock3 size={16} className="shrink-0 text-accent" />
            你们每周有 <b className="font-semibold text-accent-text tabular">{overlapH}</b> 小时的共同学习时间（{overlap.length} 个时段）
          </p>
        )}

        {recommendation && <RecommendationDetails recommendation={recommendation} />}
        {match && match.total > 0 && <p className="mt-5 rounded-md bg-brand-soft px-3 py-2 text-[13px] text-brand-text">匹配 {match.score} / {match.total} 项检索条件；下方已标记匹配的信息。</p>}

        <div className="mt-8 space-y-8">
          {type && (
            <Block label="学习类型" matched={matched('studyType')}>
              <div className="flex items-center gap-3.5">
                <Stamp text={type.glyph} size={40} />
                <div>
                  <p className="text-[16px] font-semibold" style={{ color: tone }}>
                    {type.label}
                  </p>
                  <p className="text-[14px] text-ink-2">{type.desc}</p>
                </div>
              </div>
              {format && <p className="mt-3 text-[14px] text-ink-2">学习形式：<span className="text-ink">{format}</span></p>}
            </Block>
          )}
          {!type && format && <Block label="学习形式"><Chips items={[format]} /></Block>}

          {profile.bio && (
            <Block label="关于 TA" matched={bioMatched}>
              <p className="font-hand text-[17px] leading-[1.85] whitespace-pre-wrap text-ink"><Highlight text={profile.bio} words={words} /></p>
            </Block>
          )}

          {Object.values(profile.personality ?? {}).some((value) => value >= 1) && (
            <Block label="学习性格">
              <PersonalityScale personality={profile.personality} />
            </Block>
          )}

          {facts.length > 0 && <Block label="基本信息" matched={matched('major', 'college', 'grade', 'gender')}>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
              {facts.map((f) => (
                <div key={f.k} className="min-w-0">
                  <dt className="text-[13px] text-ink-3">{f.k}</dt>
                  <dd className="mt-0.5 text-[15px] break-words text-ink">{f.v}</dd>
                </div>
              ))}
            </dl>
          </Block>}
          <Block label="我的学习地点" matched={matched('places')}>
            <Chips items={[...profile.places.map((p) => optionLabel(PLACES, p)), profile.placesOther].filter(Boolean)} />
          </Block>
          {(profile.dislikeTags?.length > 0 || profile.dislikes) && (
            <Block label="不希望搭子这样">
              <Chips items={[...(profile.dislikeTags ?? []).map((value) => optionLabel(DISLIKE_OPTIONS, value)), ...profile.dislikes.split(/[、，,]/).map((value) => value.trim())].filter(Boolean)} tone="danger" />
            </Block>
          )}
          {(profile.expectedPlaces?.length > 0 || profile.expectedPlacesOther) && <Block label="期望搭子的学习地点" matched={matched('expectedPlaces')}><Chips items={[...(profile.expectedPlaces ?? []).map((value) => optionLabel(PLACES, value)), profile.expectedPlacesOther].filter(Boolean)} /></Block>}
          {(profile.studyMethods?.length > 0 || profile.studyMethodsOther) && <Block label="主要学习模式" matched={matched('studyMethods')}><Chips items={[...(profile.studyMethods ?? []).map((value) => optionLabel(STUDY_METHODS, value)), profile.studyMethodsOther].filter(Boolean)} /></Block>}
          {(profile.frequency || profile.duration) && <Block label="学习节奏与时长" matched={matched('frequency', 'duration')}><Chips items={[optionLabel(FREQUENCIES, profile.frequency), optionLabel(DURATIONS, profile.duration)].filter(Boolean)} /></Block>}
          {profile.expectations && <Block label="对学习搭子的期待" matched={matched('expectations')}><p className="text-[15px] leading-relaxed whitespace-pre-wrap text-ink">{profile.expectations}</p></Block>}

          <Block label={profile.isMe || !profile.mySchedule.length ? '我的空闲时间' : '空闲时间（已叠加你的时间）'} matched={matched('schedule', 'overlap')}>
            <TimeGrid value={profile.schedule} readOnly compare={!profile.isMe && profile.mySchedule.length ? profile.mySchedule : undefined} />
          </Block>
          {!!profile.expectedSchedule?.length && <Block label="期望搭子的空闲时间"><TimeGrid value={profile.expectedSchedule} readOnly compare={profile.schedule} /></Block>}

          {(profile.subjects?.length > 0 || deadline) && (
            <Block label="在学的科目" matched={matched('subjects')}>
              {profile.subjects?.length > 0 ? <Chips items={profile.subjects} tone="brand" /> : null}
              {deadline && <p className={cx('flex items-center gap-1.5 text-[14px] text-ink-2', profile.subjects?.length > 0 && 'mt-3')}><CalendarClock size={15} className="shrink-0 text-ink-3" aria-hidden />目标日期：{deadline}</p>}
            </Block>
          )}

          {(profile.studyPlan || profile.planTags.length > 0) && (
            <Block label="近期学习目标" matched={matched('planTags')}>
              {profile.planTags.length > 0 && <Chips items={profile.planTags} tone="brand" />}
              {profile.studyPlan && <p className="font-hand mt-3 text-[16px] leading-relaxed whitespace-pre-wrap text-ink">{profile.studyPlan}</p>}
              {[{ label: '科研 / 竞赛', value: profile.goalResearch }, { label: '技能自学', value: profile.goalSkills }, { label: '其他目标', value: profile.goalOther }].filter((item) => item.value).map((item) => <p key={item.label} className="mt-2 text-[15px] text-ink-2">{item.label}：{item.value}</p>)}
            </Block>
          )}

          {(profile.interests?.length > 0 || profile.interestsOther) && (
            <Block label="兴趣爱好" matched={matched('interests')}>
              <Chips items={[...(profile.interests ?? []).map((value) => optionLabel(INTERESTS, value)), profile.interestsOther].filter(Boolean)} />
            </Block>
          )}
        </div>
        {!profile.isMe && <MatchBar actions={actions} inOverlay={!!onClose} />}
      </div>

      <ReportDialog open={report} onClose={() => setReport(false)} targetType="profile" targetId={profile.id} />
      {!profile.isMe && <MatchCelebrationFor actions={actions} />}
      <ConfirmDialog
        open={excluding}
        title="排除这位同学？"
        desc="排除后，双方将不再出现在彼此的匹配结果中，私聊与联系方式交换也会停止。对方不会收到提示；你可以在「我的」中取消排除。"
        confirmText="确认排除"
        tone="danger"
        loading={excludeBusy}
        onCancel={() => { if (!excludeBusy) setExcluding(false); }}
        onConfirm={async () => {
          setExcludeBusy(true);
          try {
            await api.excludeConnection(profile.id);
            setExcluding(false);
            toast.success('已排除这位同学', '对方不会收到提示，可在「我的」中取消排除。');
            leave();
          } catch (e) {
            toast.error('操作失败', e instanceof ApiError ? e.message : undefined);
          } finally {
            setExcludeBusy(false);
          }
        }}
      />
      <TakedownDialog
        open={takedown}
        onClose={() => setTakedown(false)}
        type="profile"
        id={profile.id}
        label={profile.nickname}
        onDone={leave}
      />
    </div>
  );
}

function Block({ label, children, matched }: { label: string; children: ReactNode; matched?: boolean }) {
  return (
    <section className={matched ? '-mx-3 rounded-lg border border-brand/25 bg-brand-softer p-3' : undefined}>
      <h3 className="mb-3 flex items-center gap-2 border-b border-line pb-1.5 font-display text-[17px] text-ink">{label}{matched && <span className="ml-auto font-sans text-[11px] font-normal text-brand-text">符合检索条件</span>}</h3>
      {children}
    </section>
  );
}

function Chips({ items, tone }: { items: string[]; tone?: 'brand' | 'danger' }) {
  if (!items.length) return <p className="text-[14px] text-ink-4">未填写</p>;
  const cls = { brand: 'bg-brand-soft text-brand-text', danger: 'bg-danger-soft text-danger', none: 'bg-paper-2 text-ink' }[tone ?? 'none'];
  return (
    <div className="flex flex-wrap gap-1.5">
      {[...new Set(items)].map((i) => (
        <span key={i} className={cx('rounded-md px-2.5 py-1 text-[14px]', cls)}>
          {i}
        </span>
      ))}
    </div>
  );
}

function Photos({ photos }: { photos: string[] }) {
  const [i, setI] = useState(0);
  const [dir, setDir] = useState(1);
  const go = (d: number) => {
    setDir(d);
    setI((x) => (x + d + photos.length) % photos.length);
  };
  return (
    <div className="group relative h-full w-full">
      <AnimatePresence initial={false} custom={dir}>
        <motion.img
          key={photos[i]}
          src={fileUrl(photos[i])}
          alt=""
          className="absolute inset-0 h-full w-full object-cover"
          initial={{ x: `${dir * 30}%`, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: `${dir * -20}%`, opacity: 0 }}
          transition={{ duration: 0.35, ease }}
          drag={photos.length > 1 ? 'x' : false}
          dragConstraints={{ left: 0, right: 0 }}
          dragElastic={0.3}
          onDragEnd={(_, info) => {
            if (info.offset.x < -60) go(1);
            else if (info.offset.x > 60) go(-1);
          }}
        />
      </AnimatePresence>
      {photos.length > 1 && (
        <>
          <div className="absolute inset-x-0 bottom-3 flex justify-center gap-1.5">
            {photos.map((p, k) => (
              <button key={p} onClick={() => (setDir(k > i ? 1 : -1), setI(k))} className={cx('size-1.5 rounded-full transition-colors', k === i ? 'bg-white' : 'bg-white/45')} aria-label={`第 ${k + 1} 张`} />
            ))}
          </div>
          <button onClick={() => go(-1)} className="absolute top-1/2 left-3 hidden size-9 -translate-y-1/2 place-items-center rounded-full bg-black/35 text-white opacity-0 transition-opacity group-hover:opacity-100 md:grid" aria-label="上一张">
            <ChevronLeft size={18} />
          </button>
          <button onClick={() => go(1)} className="absolute top-1/2 right-3 hidden size-9 -translate-y-1/2 place-items-center rounded-full bg-black/35 text-white opacity-0 transition-opacity group-hover:opacity-100 md:grid" aria-label="下一张">
            <ChevronRight size={18} />
          </button>
        </>
      )}
    </div>
  );
}

function Highlight({ text, words }: { text: string; words: string[] }) {
  const terms = [...new Set(words)].sort((left, right) => right.length - left.length);
  if (!terms.length) return <>{text}</>;
  const escaped = terms.map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const expression = new RegExp(`(${escaped.join('|')})`, 'gi');
  const pieces = text.split(expression);
  return <>{pieces.map((piece, index) => terms.some((term) => term.toLowerCase() === piece.toLowerCase()) ? <mark key={index} className="rounded-sm bg-brand-soft px-0.5 text-brand-text">{piece}</mark> : piece)}</>;
}

/** 目标日期：显示日期，并说明还有几天（已过去的只显示日期） */
function deadlineText(date: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return '';
  const [y, m, d] = date.split('-').map(Number);
  const target = Date.UTC(y, m - 1, d);
  const today = new Date();
  const days = Math.round((target - Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())) / 86_400_000);
  const label = `${y} 年 ${m} 月 ${d} 日`;
  return days > 0 ? `${label}（还有 ${days} 天）` : days === 0 ? `${label}（就是今天）` : label;
}
