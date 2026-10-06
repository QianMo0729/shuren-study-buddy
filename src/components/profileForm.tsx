import { AnimatePresence, Reorder, motion } from 'motion/react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, BookOpen, Check, ChevronDown, ChevronRight, GraduationCap, ImagePlus, Search, X, ZoomIn } from 'lucide-react';
import { MAJOR_GROUPS, UNDECIDED } from '../../shared/majors';
import { MBTIS, PERSONALITY_ITEMS, STUDY_TYPES, SUBJECT_LIMIT } from '../../shared/options';
import type { Personality, PersonalityKey } from '../../shared/types';
import { api, ApiError, fileUrl } from '../lib/api';
import { cx } from '../lib/format';
import { compressImage } from '../lib/image';
import { ease } from '../lib/motion';
import { useToast } from '../lib/toast';
import { Button, Input, Modal, Spinner } from './ui';
import { Seal } from './brand';
import { COURSE_OPTIONS, EXAM_OPTIONS, COURSE_CATALOG_SOURCE, invalidSelectedSubjects, resolveSubjectOption, searchSubjectOptions, type SubjectOption } from '../../shared/courseCatalog';

// ---------------- 专业选择（可搜索、按院系分组） ----------------

export function MajorSelect({ value, onChange, invalid, placeholder = '选择专业 / 院系', allowClear }: {
  value: string;
  onChange: (v: string) => void;
  invalid?: boolean;
  placeholder?: string;
  allowClear?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [kw, setKw] = useState('');
  const groups = useMemo(() => {
    const k = kw.trim().toLowerCase();
    if (!k) return MAJOR_GROUPS;
    return MAJOR_GROUPS.map((g) => ({
      ...g,
      majors: g.college.toLowerCase().includes(k) ? g.majors : g.majors.filter((m) => m.toLowerCase().includes(k)),
    })).filter((g) => g.majors.length);
  }, [kw]);
  const college = MAJOR_GROUPS.find((g) => g.majors.includes(value))?.college;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cx(
          'flex h-11 w-full items-center gap-2 rounded-lg border bg-surface px-3.5 text-left text-[16px] transition-[border-color,box-shadow] hover:border-ink-4 sm:text-[15px]',
          invalid ? 'border-danger' : 'border-line-strong',
        )}
      >
        {value ? (
          <span className="min-w-0 flex-1 truncate text-ink">
            {value}
            {college && college !== '其他' && <span className="ml-2 text-[13px] text-ink-3">{college}</span>}
          </span>
        ) : (
          <span className="flex-1 text-ink-4">{placeholder}</span>
        )}
        {allowClear && value && (
          <span
            role="button"
            onClick={(e) => {
              e.stopPropagation();
              onChange('');
            }}
            className="grid size-6 place-items-center rounded text-ink-4 hover:bg-paper-2 hover:text-ink-2"
          >
            <X size={14} />
          </span>
        )}
        <ChevronDown size={17} className="text-ink-3" />
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="选择专业 / 院系" size="md">
        <div className="px-5 pt-3 sm:px-6">
          <Input autoFocus value={kw} onChange={(e) => setKw(e.target.value)} placeholder="搜索专业或院系，如「微电子」" leading={<Search size={16} />} />
        </div>
        <div className="mt-3 max-h-[56dvh] overflow-y-auto px-3 pb-5">
          {groups.map((g) => (
            <div key={g.college} className="mb-1">
              <p className="sticky top-0 z-10 bg-surface px-3 pt-3 pb-1.5 text-[12.5px] font-semibold text-ink-3">{g.college}</p>
              {g.majors.map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => {
                    onChange(m);
                    setOpen(false);
                    setKw('');
                  }}
                  className={cx('flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left text-[15px] transition-colors', m === value ? 'bg-brand-soft font-semibold text-brand-text' : 'text-ink hover:bg-paper-2')}
                >
                  {m}
                  {m === value && <Check size={16} />}
                </button>
              ))}
            </div>
          ))}
          {!groups.length && <p className="py-10 text-center text-[14px] text-ink-3">没有找到这个专业，可以先选择「{UNDECIDED}」。</p>}
        </div>
      </Modal>
    </>
  );
}

// ---------------- 照片 ----------------

async function uploadFile(file: File, kind: 'photo' | 'timetable') {
  const dataUrl = await compressImage(file, kind === 'timetable' ? 2000 : 1400);
  return (await api.upload(dataUrl, kind)).name;
}

export function PhotoUploader({ value, onChange, max = 4, onBusyChange }: { value: string[]; onChange: (v: string[]) => void; max?: number; onBusyChange?: (busy: boolean) => void }) {
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(0);
  const uploading = useRef(false);
  const mounted = useRef(true);
  const busyCallback = useRef(onBusyChange);
  busyCallback.current = onBusyChange;
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; busyCallback.current?.(false); };
  }, []);

  const onFiles = async (files: FileList | null) => {
    if (!files?.length || uploading.current) return;
    const room = max - value.length;
    const list = [...files].slice(0, room);
    if (files.length > room) toast.info(`最多上传 ${max} 张照片`);
    if (!list.length) return;
    uploading.current = true;
    busyCallback.current?.(true);
    setBusy(list.length);
    const added: string[] = [];
    try {
      for (const f of list) {
        if (!mounted.current) break;
        try {
          added.push(await uploadFile(f, 'photo'));
        } catch (e) {
          if (mounted.current) toast.error('上传失败', e instanceof ApiError || e instanceof Error ? e.message : undefined);
        }
        if (mounted.current) setBusy((b) => b - 1);
      }
      if (mounted.current) onChange([...value, ...added]);
    } finally {
      uploading.current = false;
      if (mounted.current) { setBusy(0); busyCallback.current?.(false); }
    }
  };

  return (
    <div>
      <div className="flex gap-2.5">
        <Reorder.Group axis="x" values={value} onReorder={(next) => { if (!uploading.current) onChange(next); }} className="flex gap-2.5">
          {value.map((name, i) => (
            <Reorder.Item
              key={name}
              value={name}
              className="group relative aspect-[3/4] w-[clamp(64px,21vw,104px)] cursor-grab overflow-hidden rounded-lg bg-paper-2 active:cursor-grabbing"
              whileDrag={{ scale: 1.06, boxShadow: 'var(--shadow-lg)', zIndex: 10 }}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <img src={fileUrl(name)} alt="" className="pointer-events-none h-full w-full object-cover" />
              {i === 0 ? (
                <span className="absolute inset-x-0 bottom-0 bg-black/55 py-0.5 text-center text-[11px] text-white">封面</span>
              ) : (
                <button
                  type="button"
                  disabled={busy > 0}
                  onClick={() => onChange([name, ...value.filter((x) => x !== name)])}
                  className="absolute inset-x-0 bottom-0 bg-black/40 py-0.5 text-center text-[11px] text-white opacity-0 transition-opacity group-hover:opacity-100 max-sm:opacity-100"
                >
                  设为封面
                </button>
              )}
              <button
                type="button"
                disabled={busy > 0}
                onClick={() => onChange(value.filter((x) => x !== name))}
                className="absolute top-1 right-1 grid size-6 place-items-center rounded-md bg-black/45 text-white hover:bg-black/65"
                aria-label="删除照片"
              >
                <X size={13} />
              </button>
            </Reorder.Item>
          ))}
        </Reorder.Group>
        {Array.from({ length: busy }).map((_, i) => (
          <div key={`b${i}`} className="grid aspect-[3/4] w-[clamp(64px,21vw,104px)] place-items-center rounded-lg bg-paper-2 text-ink-3">
            <Spinner />
          </div>
        ))}
        {!busy && value.length < max && (
          <button
            type="button"
            onClick={() => input.current?.click()}
            className="flex aspect-[3/4] w-[clamp(64px,21vw,104px)] flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-line-strong text-ink-3 transition-colors hover:border-ink-4 hover:text-ink"
          >
            <ImagePlus size={20} strokeWidth={1.7} />
            <span className="text-[12px]">{value.length ? '继续添加' : '添加照片'}</span>
          </button>
        )}
      </div>
      {busy > 0 && <p className="mt-2 text-[13px] text-ink-3" role="status">正在上传 {busy} 张照片，上传完成后可继续填写。</p>}
      <input ref={input} type="file" accept="image/*" multiple hidden onChange={(e) => (onFiles(e.target.files), (e.target.value = ''))} />
    </div>
  );
}

export function TimetableUpload({ value, onChange }: { value: string | null; onChange: (v: string | null) => void }) {
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState(false);
  return (
    <div>
      {value ? (
        <div className="flex items-center gap-3 rounded-lg border border-line bg-surface p-2 pr-2.5">
          <button type="button" onClick={() => setView(true)} className="group relative size-14 shrink-0 overflow-hidden rounded-md bg-paper-2" aria-label="查看课程表">
            <img src={fileUrl(value)} alt="课程表" className="h-full w-full object-cover" />
            <span className="absolute inset-0 grid place-items-center bg-black/30 text-white opacity-0 transition-opacity group-hover:opacity-100">
              <ZoomIn size={16} />
            </span>
          </button>
          <div className="min-w-0 flex-1">
            <p className="text-[14px] font-semibold text-ink">课程表已上传</p>
            <p className="text-[13px] text-ink-3">仅自己及管理员可查看</p>
          </div>
          <Button size="sm" variant="ghost" onClick={() => input.current?.click()} loading={busy}>
            替换
          </Button>
          <Button size="sm" variant="ghost" onClick={() => onChange(null)} className="text-danger">
            移除
          </Button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => input.current?.click()}
          disabled={busy}
          className="flex w-full items-center gap-3 rounded-lg border border-dashed border-line-strong px-4 py-3 text-left text-ink-2 transition-colors hover:border-ink-4 hover:text-ink"
        >
          {busy ? <Spinner /> : <ImagePlus size={18} strokeWidth={1.7} />}
          <span className="text-[14px]">上传课程表截图（教务系统或课表 App 的截图即可）</span>
        </button>
      )}
      <input
        ref={input}
        type="file"
        accept="image/*"
        hidden
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (!f) return;
          setBusy(true);
          try {
            onChange(await uploadFile(f, 'timetable'));
          } catch (err) {
            toast.error('上传失败', err instanceof Error ? err.message : undefined);
          } finally {
            setBusy(false);
          }
        }}
      />
      <Lightbox src={value ? fileUrl(value) : null} open={view} onClose={() => setView(false)} />
    </div>
  );
}

export function Lightbox({ src, open, onClose }: { src: string | null; open: boolean; onClose: () => void }) {
  return createPortal(
    <AnimatePresence>
      {open && src && (
        <motion.div
          className="fixed inset-0 z-[95] grid place-items-center bg-black/85 p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <motion.img
            src={src}
            alt=""
            className="max-h-[90dvh] max-w-full rounded-2xl object-contain shadow-2xl"
            initial={{ scale: 0.92, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            transition={{ duration: 0.3, ease }}
          />
          <button className="absolute top-4 right-4 grid size-10 place-items-center rounded-full bg-white/10 text-white hover:bg-white/20" aria-label="关闭">
            <X size={20} />
          </button>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

// ---------------- 学习类型（含 30 秒小测） ----------------

// ---------------- MBTI ----------------

export function MbtiPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="grid grid-cols-4 gap-1.5 sm:max-w-sm">
      {MBTIS.map((m) => {
        const on = m === value;
        return (
          <button
            key={m}
            type="button"
            onClick={() => onChange(on ? '' : m)}
            aria-pressed={on}
            className={cx('h-9 rounded-md border text-[13px] tracking-wide transition-colors', on ? 'border-brand bg-brand font-semibold text-white' : 'border-line-strong bg-surface text-ink-2 hover:border-ink-4')}
          >
            {m}
          </button>
        );
      })}
    </div>
  );
}

// ---------------- 选项列表（单选 / 多选） ----------------

export function OptionCards<T extends { value: string; label: string; hint?: string; color?: string }>({
  options, value, onChange, multi, invalid, cols = 3,
}: {
  options: T[];
  value: string[];
  onChange: (v: string[]) => void;
  multi?: boolean;
  invalid?: boolean;
  cols?: 1 | 2 | 3;
}) {
  const grid = { 1: 'grid-cols-1', 2: 'grid-cols-1 sm:grid-cols-2', 3: 'grid-cols-1 sm:grid-cols-3' }[cols];
  return (
    <div className={cx('grid gap-2', grid, invalid && 'rounded-lg outline-2 outline-offset-4 outline-danger/50')} role={multi ? 'group' : 'radiogroup'}>
      {options.map((o) => {
        const on = value.includes(o.value);
        return (
          <button
            key={o.value}
            type="button"
            role={multi ? 'checkbox' : 'radio'}
            aria-checked={on}
            onClick={() => onChange(multi ? (on ? value.filter((v) => v !== o.value) : [...value, o.value]) : [o.value])}
            className={cx('flex items-center gap-3 rounded-lg border px-3.5 py-2.5 text-left transition-colors', on ? 'border-brand bg-brand-softer' : 'border-line-strong bg-surface hover:border-ink-4')}
          >
            <span className={cx('grid size-[18px] shrink-0 place-items-center border-[1.5px]', multi ? 'rounded-[4px]' : 'rounded-full', on ? 'border-brand bg-brand text-white' : 'border-line-strong')}>
              {on && <Check size={11} strokeWidth={3} />}
            </span>
            {o.color && <span className="size-2 shrink-0 rounded-full" style={{ background: o.color }} />}
            <span className="min-w-0 flex-1">
              <span className="block text-[15px] text-ink">{o.label}</span>
              {o.hint && <span className="block text-[13px] text-ink-3">{o.hint}</span>}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ---------------- 具体课程 / 考试（分级目录与全局搜索） ----------------

type SubjectLocation = { kind: 'root' } | { kind: 'course'; department?: string } | { kind: 'exam'; category?: string; family?: string };

export function SubjectsInput({ value, onChange, max = SUBJECT_LIMIT, coursesOnly = false, id, describedBy }: {
  value: string[];
  onChange: (v: string[]) => void;
  max?: number;
  coursesOnly?: boolean;
  id?: string;
  describedBy?: string;
}) {
  const [query, setQuery] = useState('');
  const [browseLocation, setLocation] = useState<SubjectLocation>(() => ({ kind: coursesOnly ? 'course' : 'root' }));
  const location: SubjectLocation = coursesOnly && browseLocation.kind !== 'course' ? { kind: 'course' } : browseLocation;
  const [notice, setNotice] = useState('');
  const browseTitle = useRef<HTMLParagraphElement>(null);
  const full = value.length >= max;
  const overLimit = value.length > max;
  const unknown = coursesOnly ? value.filter((item) => resolveSubjectOption(item)?.kind !== 'course') : invalidSelectedSubjects(value);
  const selected = new Set(value.map((item) => resolveSubjectOption(item)?.id).filter(Boolean));
  const has = (option: SubjectOption) => selected.has(option.id);
  const searching = !!query.trim();
  const searchResults = useMemo(() => query.trim() ? searchSubjectOptions(query, coursesOnly ? 'course' : 'all', 81) : [], [query, coursesOnly]);
  const departments = useMemo(() => [...new Set(COURSE_OPTIONS.map((option) => option.department))], []);
  const categories = useMemo(() => [...new Set(EXAM_OPTIONS.map((option) => option.category))], []);
  const exams = location.kind === 'exam' && location.category
    ? EXAM_OPTIONS.filter((option) => option.category === location.category) : EXAM_OPTIONS;
  const families = [...new Set(exams.map((option) => option.family))];
  const singleExamFamily = location.kind === 'exam' && !!location.category && families.length === 1;
  const breadcrumbs: { label: string; location: SubjectLocation }[] = coursesOnly
    ? [{ label: '开课院系', location: { kind: 'course' } }]
    : [{ label: '选择分类', location: { kind: 'root' } }];
  if (location.kind === 'course') {
    if (!coursesOnly) breadcrumbs.push({ label: '课程', location: { kind: 'course' } });
    if (location.department) breadcrumbs.push({ label: location.department, location });
  }
  if (location.kind === 'exam') {
    breadcrumbs.push({ label: '备考', location: { kind: 'exam' } });
    if (location.category) breadcrumbs.push({ label: location.category, location: { kind: 'exam', category: location.category } });
    if (location.family && !singleExamFamily) breadcrumbs.push({ label: location.family, location });
  }
  const navigate = (next: SubjectLocation) => {
    setLocation(coursesOnly && next.kind !== 'course' ? { kind: 'course' } : next);
    setQuery('');
    requestAnimationFrame(() => browseTitle.current?.focus({ preventScroll: true }));
  };
  const toggle = (option: SubjectOption) => {
    if (coursesOnly && option.kind !== 'course') return;
    if (has(option)) {
      onChange(value.filter((item) => resolveSubjectOption(item)?.id !== option.id));
      setNotice(`已删除：${option.label}`);
    } else if (!full) {
      onChange([...value, option.label]);
      setNotice(`已选择：${option.label}`);
    }
  };
  const remove = (subject: string) => {
    onChange(value.filter((item) => item !== subject));
    setNotice(`已删除：${subject}`);
  };
  const classification = (option: SubjectOption) => option.kind === 'course'
    ? `课程 · ${option.department} · ${option.code}`
    : `备考 · ${option.category} · ${option.family}${option.level ? ` · ${option.level}` : ''} · ${option.code}`;
  const optionButton = (option: SubjectOption, card = false) => {
    const chosen = has(option);
    const contextualLevel = !searching && option.kind === 'exam' && !!option.level;
    const label = contextualLevel ? option.level! : option.name;
    return <button key={option.id} type="button" disabled={full && !chosen} aria-pressed={chosen}
      aria-label={`${chosen ? '取消选择' : '选择'} ${contextualLevel ? label : option.label}`} onClick={() => toggle(option)}
      className={cx('flex min-w-0 items-start gap-2.5 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:cursor-not-allowed disabled:opacity-45',
        card ? 'rounded-xl border p-3.5' : 'w-full border-b border-line px-3.5 py-3 last:border-0',
        chosen ? 'border-brand/45 bg-brand-softer' : card ? 'border-line bg-surface hover:border-brand/45 hover:bg-brand-softer' : 'hover:bg-brand-softer')}>
      <span className={cx('mt-0.5 grid size-[18px] shrink-0 place-items-center rounded-[4px] border', chosen ? 'border-brand bg-brand text-white' : 'border-line-strong bg-surface')} aria-hidden>
        {chosen && <Check size={12} strokeWidth={3} />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[14px] leading-snug font-medium text-ink">{label}</span>
        <span className="mt-1 block text-[12px] leading-relaxed text-ink-3">{contextualLevel ? option.code : classification(option)}</span>
      </span>
    </button>;
  };
  const branchButton = (label: string, options: readonly SubjectOption[], next: SubjectLocation, hint: string) => {
    const chosenCount = options.filter(has).length;
    return <button key={label} type="button" aria-label={label} onClick={() => navigate(next)}
      className="group flex min-w-0 items-start gap-2 rounded-xl border border-line bg-surface p-3.5 text-left transition-colors hover:border-brand/45 hover:bg-brand-softer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand">
      <span className="min-w-0 flex-1">
        <span className="block text-[14px] leading-snug font-semibold text-ink">{label}</span>
        <span className="mt-1.5 block text-[12px] leading-relaxed text-ink-3">{hint}</span>
        {chosenCount > 0 && <span className="mt-2 inline-flex items-center gap-1 text-[11px] font-medium text-brand-text"><Check size={11} aria-hidden />已选 {chosenCount} 项</span>}
      </span>
      <ChevronRight size={16} aria-hidden className="mt-0.5 shrink-0 text-ink-4 transition-transform group-hover:translate-x-0.5" />
    </button>;
  };
  const leaves = location.kind === 'course' && location.department
    ? COURSE_OPTIONS.filter((option) => option.department === location.department)
    : singleExamFamily ? exams
      : location.kind === 'exam' && location.family ? exams.filter((option) => option.family === location.family) : [];
  const title = searching ? '搜索结果'
    : location.kind === 'root' ? '先选择课程或备考'
      : location.kind === 'course' ? location.department ? '选择课程 · 可多选' : '选择开课院系'
        : leaves.length ? leaves.every((option) => !!option.level) ? '选择等级 · 可多选' : '选择考试 · 可多选'
          : location.category ? '选择考试系列' : '选择考试类别';
  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-3 text-[12px] text-ink-3">
        <span>{coursesOnly ? '已选择的本学期课程' : '已选择的课程与考试'}</span><span className={cx('shrink-0 tabular', overLimit && 'font-semibold text-danger')}>{value.length} / {max} · 最多 {max} 项</span>
      </div>
      {value.length > 0 && (
        <ul aria-label={coursesOnly ? '已选择的本学期课程' : '已选择的课程或考试'} className="mb-3 flex flex-wrap gap-2">
          {value.map((subject) => {
            const unresolved = unknown.includes(subject);
            return <li key={subject} className={cx('inline-flex max-w-full items-center gap-1 rounded-md border py-1 pr-0.5 pl-2.5 text-[13px]', unresolved ? 'border-danger/35 bg-danger-soft text-danger' : 'border-brand/40 bg-brand-softer text-ink')}>
              <span className="min-w-0 break-words">{resolveSubjectOption(subject)?.label ?? subject}{unresolved && <span className="ml-1 text-[11px]">（需重新选择）</span>}</span>
              <button type="button" onClick={() => remove(subject)} aria-label={`删除 ${subject}`} className="grid size-7 shrink-0 place-items-center rounded text-ink-3 hover:bg-paper-2 hover:text-ink"><X size={13} /></button>
            </li>;
          })}
        </ul>
      )}
      {overLimit && <p className="mb-3 text-[13px] leading-relaxed text-danger" role="status">当前已选 {value.length} 项，最多可保留 {max} 项。请移除至少 {value.length - max} 项；减少到 {max} 项以下后可继续添加。</p>}
      {unknown.length > 0 && <p className="mb-3 text-[13px] leading-relaxed text-danger" role="status">以前填写的部分内容未对应到唯一{coursesOnly ? '校内课程' : '课程或考试'}。请删除标记项，再从下面的目录选择；草稿会保留原内容。</p>}
      <Input
        id={id}
        aria-label={coursesOnly ? '搜索本学期课程' : '搜索课程或考试'}
        type="search"
        value={query}
        maxLength={80}
        aria-describedby={describedBy}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing || event.keyCode === 229) return;
          if (event.key === 'Enter') { event.preventDefault(); setNotice(coursesOnly ? '请在搜索结果中选择课程' : '请在搜索结果中选择课程或考试'); }
        }}
        leading={<Search size={16} />}
        placeholder={coursesOnly ? '搜索课程名称、编号或开课院系' : '搜索全部分类：课程、编号、院系、考试'}
      />
      <div className="mt-3 rounded-xl border border-line bg-paper/40 p-3 sm:p-3.5">
        <nav aria-label={coursesOnly ? '课程分类路径' : '课程与备考分类路径'} className="mb-3 flex flex-wrap items-center gap-x-1 gap-y-1 text-[12px]">
          {breadcrumbs.map((crumb, index) => <span key={`${index}-${crumb.label}`} className="inline-flex min-w-0 items-center gap-1">
            {index > 0 && <ChevronRight size={12} aria-hidden className="shrink-0 text-ink-4" />}
            {index === breadcrumbs.length - 1 && !searching
              ? <span aria-current="location" className="font-semibold text-ink-2">{crumb.label}</span>
              : <button type="button" aria-label={`返回${crumb.label}`} onClick={() => navigate(crumb.location)} className="rounded px-0.5 text-ink-3 hover:text-brand-text hover:underline">{crumb.label}</button>}
          </span>)}
          {searching && <span className="inline-flex items-center gap-1"><ChevronRight size={12} aria-hidden className="text-ink-4" /><span aria-current="location" className="font-semibold text-ink-2">全局搜索</span></span>}
        </nav>
        <div className="mb-3 flex items-center justify-between gap-3">
          <p ref={browseTitle} tabIndex={-1} className="text-[13px] font-semibold text-ink-2 outline-none">{title}</p>
          {searching
            ? <button type="button" onClick={() => { setQuery(''); requestAnimationFrame(() => browseTitle.current?.focus({ preventScroll: true })); }} className="shrink-0 text-[12px] text-brand-text hover:underline">清空搜索</button>
            : breadcrumbs.length > 1 && <button type="button" onClick={() => navigate(breadcrumbs[breadcrumbs.length - 2].location)} className="inline-flex shrink-0 items-center gap-1 text-[12px] text-ink-3 hover:text-brand-text"><ArrowLeft size={13} aria-hidden />返回上一级</button>}
        </div>
        {searching ? <>
          <div className="max-h-80 overflow-y-auto rounded-lg border border-line bg-surface" aria-label={coursesOnly ? '课程搜索结果' : '课程与考试搜索结果'}>
            {searchResults.length ? searchResults.slice(0, 80).map((option) => optionButton(option))
              : <p className="px-3.5 py-7 text-center text-[13px] leading-relaxed text-ink-3">{coursesOnly ? '没有找到匹配课程，试试课程名称、编号或院系名称。' : '没有找到匹配项目，试试课程编号、考试简称或院系名称。'}</p>}
          </div>
          {searchResults.length > 80 && <p className="mt-2 text-[12px] text-ink-3">已显示前 80 项，请输入更具体的关键词缩小范围。</p>}
        </> : location.kind === 'root' ? <div className="grid grid-cols-2 gap-2.5" aria-label="课程或备考分类">
          <button type="button" aria-label="课程" onClick={() => navigate({ kind: 'course' })} className="group min-w-0 rounded-xl border border-line bg-surface p-4 text-left transition-colors hover:border-brand/50 hover:bg-brand-softer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand sm:p-5">
            <BookOpen size={23} strokeWidth={1.6} aria-hidden className="mb-4 text-brand-text" />
            <span className="flex items-center justify-between gap-1 text-[17px] font-semibold text-ink">课程<ChevronRight size={17} aria-hidden className="text-ink-4 group-hover:text-brand-text" /></span>
            <span className="mt-1.5 block text-[12px] leading-relaxed text-ink-3">按开课院系选择<br />{COURSE_OPTIONS.length} 门校内课程</span>
          </button>
          <button type="button" aria-label="备考" onClick={() => navigate({ kind: 'exam' })} className="group min-w-0 rounded-xl border border-line bg-surface p-4 text-left transition-colors hover:border-brand/50 hover:bg-brand-softer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand sm:p-5">
            <GraduationCap size={23} strokeWidth={1.6} aria-hidden className="mb-4 text-brand-text" />
            <span className="flex items-center justify-between gap-1 text-[17px] font-semibold text-ink">备考<ChevronRight size={17} aria-hidden className="text-ink-4 group-hover:text-brand-text" /></span>
            <span className="mt-1.5 block text-[12px] leading-relaxed text-ink-3">按类别、系列与等级选择<br />{categories.length} 类考试</span>
          </button>
        </div> : leaves.length ? <div className="max-h-80 overflow-y-auto rounded-lg border border-line bg-surface" aria-label={location.kind === 'course' ? '可选课程' : '可选考试等级'}>{leaves.map((option) => optionButton(option))}</div>
          : <div className="grid max-h-96 grid-cols-2 gap-2.5 overflow-y-auto p-0.5" aria-label={location.kind === 'course' ? '开课院系' : location.category ? '考试系列' : '考试类别'}>
            {location.kind === 'course' ? departments.map((department) => {
              const options = COURSE_OPTIONS.filter((option) => option.department === department);
              return branchButton(department, options, { kind: 'course', department }, `${options.length} 门课程`);
            }) : !location.category ? categories.map((category) => {
              const options = EXAM_OPTIONS.filter((option) => option.category === category);
              const familyCount = new Set(options.map((option) => option.family)).size;
              const hint = familyCount === 1
                ? `${options.length} ${options.every((option) => !!option.level) ? '个等级' : '项考试'}`
                : `${familyCount} 个系列 · ${options.length} 项考试`;
              return branchButton(category, options, { kind: 'exam', category }, hint);
            }) : families.map((family) => {
              const options = exams.filter((option) => option.family === family);
              if (options.length === 1 && !options[0].level) return optionButton(options[0], true);
              return branchButton(family, options, { kind: 'exam', category: location.category, family }, `${options.length} 个${options.every((option) => !!option.level) ? '等级' : '可选项目'}`);
            })}
          </div>}
      </div>
      <p className="mt-2.5 text-[12px] leading-relaxed text-ink-3">{coursesOnly ? '可跨院系选择本学期课程。' : '可跨分类多选。'}课程来自<a href={COURSE_CATALOG_SOURCE} target="_blank" rel="noreferrer" className="text-brand-text underline">南科大教学工作部公开课程库</a>，{coursesOnly ? '同名课程请核对编号。' : '同名课程按编号区分：和同学选了同一个编号，才会按同一门课匹配。'}</p>
      {full && !overLimit && <p className="mt-1.5 text-[13px] text-ink-3">已选满 {max} 项，需要更换时请先删除一项。</p>}
      <p className="sr-only" aria-live="polite">{notice}</p>
    </div>
  );
}

// ---------------- 学习性格（1–5 量表） ----------------

const MODE_HINTS: Record<'similar' | 'need' | 'give', string> = {
  similar: '和搭子越接近越合拍',
  need: '由对方「愿意督促对方的程度」来满足：对方越乐意督促，越适合你',
  give: '用来满足对方「需要被督促」的程度',
};

export function PersonalityScales({ value, onChange }: { value: Personality; onChange: (v: Personality) => void }) {
  const answered = PERSONALITY_ITEMS.filter((item) => value[item.key] > 0).length;
  return (
    <div>
      <p className="mb-4 text-[13px] text-ink-3" aria-live="polite">已回答 <span className="tabular">{answered}</span> / {PERSONALITY_ITEMS.length} 题</p>
      <div className="space-y-6">
        {PERSONALITY_ITEMS.map((item, index) => (
          <LikertItem key={item.key} index={index} item={item} value={value[item.key]} onChange={(n) => onChange({ ...value, [item.key]: n })} />
        ))}
      </div>
    </div>
  );
}

function LikertItem({ index, item, value, onChange }: {
  index: number;
  item: { key: PersonalityKey; label: string; low: string; high: string; mode: 'similar' | 'need' | 'give' };
  value: number;
  onChange: (n: number) => void;
}) {
  const id = useId();
  const choiceLabel = (n: number) => `${n} 分${n === 1 ? `，${item.low}` : n === 5 ? `，${item.high}` : n === 3 ? '，居中' : ''}`;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <p id={`${id}-label`} className="text-[14px] font-semibold text-ink">{index + 1}. {item.label}</p>
        {value > 0 && (
          <button type="button" onClick={() => onChange(0)} className="shrink-0 text-[12.5px] text-ink-3 underline-offset-2 hover:text-ink hover:underline" aria-label={`清除「${item.label}」的回答`}>
            清除
          </button>
        )}
      </div>
      <p id={`${id}-hint`} className="mt-0.5 text-[12.5px] text-ink-3">{MODE_HINTS[item.mode]}</p>
      <div role="radiogroup" aria-labelledby={`${id}-label`} aria-describedby={`${id}-hint`} className="mt-2.5 grid grid-cols-5 gap-1.5">
        {[1, 2, 3, 4, 5].map((n) => (
          <label key={n} className="relative block">
            <input
              type="radio"
              name={`${id}-scale`}
              value={n}
              checked={value === n}
              onChange={() => onChange(n)}
              aria-label={choiceLabel(n)}
              className="peer absolute inset-0 size-full cursor-pointer opacity-0"
            />
            <span
              aria-hidden
              className="pointer-events-none flex h-10 items-center justify-center rounded-md border border-line-strong bg-surface text-[14px] text-ink-2 transition-colors peer-hover:border-ink-4 peer-checked:border-brand peer-checked:bg-brand peer-checked:font-semibold peer-checked:text-white peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-brand"
            >
              {n}
            </span>
          </label>
        ))}
      </div>
      <div className="mt-1.5 flex justify-between gap-3 text-[12.5px] leading-snug text-ink-3" aria-hidden>
        <span>← {item.low}</span>
        <span className="text-right">{item.high} →</span>
      </div>
    </div>
  );
}
