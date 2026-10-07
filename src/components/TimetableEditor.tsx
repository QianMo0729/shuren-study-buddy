import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { CalendarDays, Plus, Upload, X } from 'lucide-react';
import { resolveSubjectOption } from '../../shared/courseCatalog';
import { DAYS, SEMESTER_COURSE_LIMIT } from '../../shared/options';
import {
  deduplicateLessons, formatTeachingWeeks, isValidFirstWeekDate, LESSON_TIMES, lessonTime,
  MAX_TEACHING_WEEK, MAX_TIMETABLE_LESSONS, parseTeachingWeeks, subtractTimetableFromSchedule,
  teachingWeek, timetableConflicts, type PrivateTimetable, type TimetableImport, type TimetableInput, type TimetableLesson,
} from '../../shared/timetable';
import { importTimetableFile, timetableApi } from '../lib/timetable';
import { SubjectsInput } from './profileForm';
import { Button, Input } from './ui';

export interface TimetableEditorProps {
  semesterCourses: string[];
  onCoursesChange: (courses: string[]) => void;
  schedule: number[];
  onScheduleChange: (slots: number[]) => void;
  onDirtyChange?: (dirty: boolean) => void;
}
const emptyTimetable = (): TimetableInput => ({ semester: '', firstWeekDate: '', lessons: [] });
const selectable = 'w-full rounded-md border border-line-strong bg-surface px-2 py-2 text-sm text-ink';
const validLesson = (lesson: TimetableLesson) => !!lesson.courseName.trim() && lesson.courseName.length <= 200
  && lesson.startPeriod >= 1 && lesson.endPeriod <= LESSON_TIMES.length && lesson.endPeriod >= lesson.startPeriod && lesson.weeks.length > 0;

function LessonFields({ lesson, conflict, onChange, onRemove }: {
  lesson: TimetableLesson; conflict: boolean; onChange: (lesson: TimetableLesson) => void; onRemove: () => void;
}) {
  const [weekText, setWeekText] = useState(() => formatTeachingWeeks(lesson.weeks));
  const [weekError, setWeekError] = useState('');
  const [expanded, setExpanded] = useState(() => !lesson.courseName.trim());
  const patch = (value: Partial<TimetableLesson>) => onChange({ ...lesson, ...value });
  return <details open={expanded} onToggle={(event) => setExpanded(event.currentTarget.open)} className={`rounded-md border p-3 ${conflict || !validLesson(lesson) ? 'border-danger/50 bg-danger-soft/20' : 'border-line bg-surface'}`}>
    <summary className="cursor-pointer text-sm font-medium leading-6">
      {lesson.courseName || '新课程'} <span className="text-ink-3">· {DAYS[lesson.day - 1]} · {lessonTime(lesson)}</span>
      {conflict && <span className="ml-2 text-danger">时间冲突</span>}
      {!validLesson(lesson) && <span className="ml-2 text-danger">待补全</span>}
      {!lesson.course && <span className="ml-2 text-ink-3">待对应课程</span>}
      <span className="block pl-4 text-xs font-normal text-ink-3">第 {formatTeachingWeeks(lesson.weeks) || '？'} 周 · {lesson.location || '地点未填写'}</span>
    </summary>
    <div className="mt-4 space-y-3">
      <label className="block text-xs text-ink-2">课表课程原名
        <Input className="mt-1" value={lesson.courseName} maxLength={200} onChange={(event) => patch({ courseName: event.target.value, course: '' })} />
      </label>
      <div><p className="mb-1 text-xs text-ink-2">对应标准课程（未找到可留空，原名仍会保存）</p>
        <SubjectsInput value={lesson.course ? [lesson.course] : []} onChange={(courses) => {
          const selected = resolveSubjectOption(courses[0] ?? '');
          patch({ course: selected?.label ?? '', ...(selected && !lesson.courseName.trim() ? { courseName: selected.name } : {}) });
        }} max={1} coursesOnly />
      </div>
      <div className="grid grid-cols-3 gap-2">
        <label className="text-xs text-ink-2">星期<select className={`${selectable} mt-1`} value={lesson.day} onChange={(event) => patch({ day: Number(event.target.value) })}>{DAYS.map((name, index) => <option value={index + 1} key={name}>{name}</option>)}</select></label>
        <label className="text-xs text-ink-2">开始节次<select className={`${selectable} mt-1`} value={lesson.startPeriod} onChange={(event) => patch({ startPeriod: Number(event.target.value) })}><option value={0} disabled>请选择</option>{LESSON_TIMES.map((_, index) => <option value={index + 1} key={index}>第 {index + 1} 节</option>)}</select></label>
        <label className="text-xs text-ink-2">结束节次<select className={`${selectable} mt-1`} value={lesson.endPeriod} onChange={(event) => patch({ endPeriod: Number(event.target.value) })}><option value={0} disabled>请选择</option>{LESSON_TIMES.map((_, index) => <option value={index + 1} key={index}>第 {index + 1} 节</option>)}</select></label>
      </div>
      <label className="block text-xs text-ink-2">上课周次
        <Input className="mt-1" placeholder="如 1-16周、1,2-16双周" value={weekText} onChange={(event) => {
          setWeekText(event.target.value);
          try { patch({ weeks: parseTeachingWeeks(event.target.value) }); setWeekError(''); }
          catch (error) { patch({ weeks: [] }); setWeekError((error as Error).message); }
        }} />
      </label>
      {weekError && <p className="text-xs text-danger">{weekError}</p>}
      <label className="block text-xs text-ink-2">教室 / 地点<Input className="mt-1" value={lesson.location} maxLength={200} onChange={(event) => patch({ location: event.target.value })} /></label>
      <Button type="button" size="sm" variant="dangerOutline" icon={<X size={14} />} onClick={onRemove}>移除此条排课</Button>
    </div>
  </details>;
}

function WeekPreview({ lessons, week, day, firstWeekDate }: { lessons: TimetableLesson[]; week: number; day: number; firstWeekDate: string }) {
  const active = lessons.filter((lesson) => lesson.weeks.includes(week)).sort((a, b) => a.startPeriod - b.startPeriod);
  const dateLabel = (index: number) => {
    if (!firstWeekDate || !isValidFirstWeekDate(firstWeekDate)) return '';
    return new Date(Date.parse(`${firstWeekDate}T00:00:00Z`) + ((week - 1) * 7 + index) * 86400_000).toISOString().slice(5, 10);
  };
  const cards = (index: number) => active.filter((lesson) => lesson.day === index + 1).map((lesson) => <div key={lesson.id} className="rounded-md border border-brand/15 bg-brand-soft/60 p-2 text-xs leading-5">
    <p className="font-semibold text-brand-text">{lesson.courseName}</p>
    <p className="text-ink-2">{lessonTime(lesson)}</p>
    <p className="text-ink-3">第 {lesson.startPeriod}{lesson.endPeriod !== lesson.startPeriod ? `–${lesson.endPeriod}` : ''} 节</p>
    {lesson.location && <p className="break-words text-ink-3">{lesson.location}</p>}
  </div>);
  return <>
    <div className="hidden max-h-[560px] overflow-auto rounded-md border border-line md:block">
      <table className="w-full min-w-[800px] table-fixed border-collapse text-xs">
        <thead className="sticky top-0 z-10 bg-paper-2"><tr><th className="w-20 border-b border-line p-2">节次 / 时间</th>{DAYS.map((name, index) => <th key={name} className="border-b border-l border-line p-2 font-semibold">{name}<span className="block font-normal text-ink-3">{dateLabel(index)}</span></th>)}</tr></thead>
        <tbody>{LESSON_TIMES.map(([start, end], period) => <tr key={start}>
          <th className="border-b border-line px-1 py-3 align-top font-normal text-ink-3">第 {period + 1} 节<br />{start}<br />{end}</th>
          {DAYS.map((name, index) => {
            const entries = active.filter((lesson) => lesson.day === index + 1 && lesson.startPeriod <= period + 1 && lesson.endPeriod >= period + 1);
            return <td key={name} className={`border-b border-l border-line p-1 align-top ${entries.length ? 'bg-brand-soft/30' : ''}`}>
              {entries.map((lesson) => <div key={lesson.id} className="mb-1 rounded bg-brand-soft/60 p-1.5 leading-5">
                <p className="font-semibold text-brand-text">{lesson.startPeriod === period + 1 ? lesson.courseName : `↳ ${lesson.courseName}`}</p>
                {lesson.startPeriod === period + 1 && <><p className="text-ink-2">{lessonTime(lesson)}</p><p className="break-words text-ink-3">{lesson.location}</p></>}
              </div>)}
            </td>;
          })}
        </tr>)}</tbody>
      </table>
    </div>
    <div className="space-y-2 md:hidden"><p className="text-sm text-ink-2">{DAYS[day - 1]} {dateLabel(day - 1)}</p>{cards(day - 1)}{!active.some((lesson) => lesson.day === day) && <p className="rounded-md border border-line p-5 text-center text-sm text-ink-3">这一天没有课</p>}</div>
  </>;
}

export function TimetableEditor({ semesterCourses, onCoursesChange, schedule, onScheduleChange, onDirtyChange }: TimetableEditorProps) {
  const inputId = useId();
  const mounted = useRef(true);
  const loadVersion = useRef(0);
  const [saved, setSaved] = useState<PrivateTimetable | null>(null);
  const [form, setForm] = useState<TimetableInput>(emptyTimetable);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [pendingImport, setPendingImport] = useState<TimetableImport | null>(null);
  const [importMode, setImportMode] = useState<'merge' | 'replace'>('merge');
  const [warnings, setWarnings] = useState<string[]>([]);
  const [warningsChecked, setWarningsChecked] = useState(false);
  const [week, setWeek] = useState(1);
  const [day, setDay] = useState(1);
  const [editorVersion, setEditorVersion] = useState(0);
  const [showLessons, setShowLessons] = useState(false);
  const baseline = saved ? { semester: saved.semester, firstWeekDate: saved.firstWeekDate, lessons: saved.lessons } : emptyTimetable();
  const dirty = JSON.stringify(form) !== JSON.stringify(baseline);
  const conflicts = useMemo(() => timetableConflicts(form.lessons), [form.lessons]);
  const conflictIds = new Set(conflicts.flat());
  const valid = !!form.semester.trim() && isValidFirstWeekDate(form.firstWeekDate) && form.lessons.every(validLesson)
    && (!warnings.length || warningsChecked);
  const suggestedSchedule = useMemo(() => subtractTimetableFromSchedule(schedule, saved?.lessons ?? []), [schedule, saved]);
  const removedSlots = schedule.length - suggestedSchedule.length;

  const load = async () => {
    const version = ++loadVersion.current;
    setLoading(true); setError(''); setLoadFailed(false);
    try {
      const { timetable } = await timetableApi.get();
      if (!mounted.current || version !== loadVersion.current) return;
      setSaved(timetable); setForm(timetable ? { semester: timetable.semester, firstWeekDate: timetable.firstWeekDate, lessons: timetable.lessons } : emptyTimetable());
      const currentWeek = timetable ? teachingWeek(timetable.firstWeekDate) : null;
      setWeek(currentWeek && currentWeek > 0 && currentWeek <= MAX_TEACHING_WEEK ? currentWeek : 1);
    } catch (cause) { if (mounted.current && version === loadVersion.current) { setError((cause as Error).message); setLoadFailed(true); } }
    finally { if (mounted.current && version === loadVersion.current) setLoading(false); }
  };
  useEffect(() => { mounted.current = true; void load(); return () => { mounted.current = false; loadVersion.current++; }; }, []);
  useEffect(() => { onDirtyChange?.(dirty || !!pendingImport); }, [dirty, pendingImport, onDirtyChange]);
  useEffect(() => {
    if (!dirty && !pendingImport) return;
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [dirty, pendingImport]);
  const edit = (next: TimetableInput) => { setForm(next); setStatus(''); setError(''); };
  const chooseFile = async (file?: File) => {
    if (!file) return;
    setBusy(true); setError(''); setStatus('');
    try {
      const imported = await importTimetableFile(file);
      if (!mounted.current) return;
      setPendingImport(imported); setImportMode(form.lessons.length ? 'merge' : 'replace');
    } catch (cause) { if (mounted.current) setError((cause as Error).message); }
    finally { if (mounted.current) setBusy(false); }
  };
  const applyImport = () => {
    if (!pendingImport) return;
    const next = deduplicateLessons(importMode === 'merge' ? [...form.lessons, ...pendingImport.lessons] : pendingImport.lessons);
    if (next.length > MAX_TIMETABLE_LESSONS) { setError(`最多保存 ${MAX_TIMETABLE_LESSONS} 条排课，请先移除旧课表`); return; }
    edit({ ...form, lessons: next }); setWarnings(importMode === 'merge' ? [...new Set([...warnings, ...pendingImport.warnings])] : pendingImport.warnings); setWarningsChecked(false);
    setPendingImport(null); setEditorVersion((version) => version + 1);
    setStatus('已加入下方预览。请校对后点击「确认并保存课表」。');
  };
  const save = async () => {
    if (!valid) return;
    setBusy(true); setError('');
    try {
      const { timetable } = await timetableApi.save({ semester: form.semester.trim(), firstWeekDate: form.firstWeekDate, lessons: form.lessons });
      if (!mounted.current) return;
      setSaved(timetable); setForm({ semester: timetable.semester, firstWeekDate: timetable.firstWeekDate, lessons: timetable.lessons });
      setWarnings([]); setStatus('私人课表已保存。下方可按需更新本学期课程和可学习时间。');
    } catch (cause) { if (mounted.current) setError((cause as Error).message); }
    finally { if (mounted.current) setBusy(false); }
  };
  if (loading) return <p className="py-4 text-sm text-ink-3">正在读取私人课表…</p>;
  if (loadFailed) return <div className="space-y-2"><p role="alert" className="text-sm text-danger">{error}</p><Button type="button" onClick={() => void load()}>重新读取课表</Button></div>;
  return <section className="space-y-4 rounded-lg border border-line bg-paper/30 p-4 sm:p-5" aria-label="私人课表导入与编辑">
    <div><h3 className="flex items-center gap-2 font-semibold"><CalendarDays size={18} />我的课表</h3>
      <p className="mt-1 text-xs leading-5 text-ink-3">仅本人可见。上传 TIS 导出的 Excel 后校对保存，也可以手动添加课程。Excel 原文件不会上传。</p>
    </div>
    <fieldset disabled={busy} className="min-w-0 space-y-4 disabled:opacity-60">
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor={inputId} className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-line-strong bg-surface px-3 py-2 text-sm font-semibold"><Upload size={16} />{busy ? '正在处理…' : '选择 TIS Excel'}</label>
        <input id={inputId} type="file" className="sr-only" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(event) => { void chooseFile(event.target.files?.[0]); event.target.value = ''; }} />
        <span className="text-xs text-ink-3">.xlsx · 最大 2 MB</span>
      </div>
      {pendingImport && <div className="space-y-3 rounded-md border border-brand/25 bg-brand-soft/30 p-3">
        <p className="text-sm">已识别 {pendingImport.courseCount} 门课程、{pendingImport.lessons.length} 条排课，等待校对。</p>
        {form.lessons.length > 0 && <div className="flex flex-wrap gap-4 text-sm"><label><input type="radio" checked={importMode === 'merge'} onChange={() => setImportMode('merge')} /> 合并到当前课表（自动去重）</label><label><input type="radio" checked={importMode === 'replace'} onChange={() => setImportMode('replace')} /> 替换当前全部排课</label></div>}
        <div className="flex gap-2"><Button type="button" size="sm" variant="primary" onClick={applyImport}>{importMode === 'replace' && form.lessons.length ? '替换预览，继续校对' : '加入预览，继续校对'}</Button><Button type="button" size="sm" onClick={() => setPendingImport(null)}>取消导入</Button></div>
        <p className="text-xs text-ink-3">此时不会修改已保存的课表。</p>
      </div>}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm text-ink-2">学期<Input className="mt-1" placeholder="如 2026–2027 学年秋季学期" maxLength={80} value={form.semester} onChange={(event) => edit({ ...form, semester: event.target.value })} /></label>
        <label className="text-sm text-ink-2">第 1 教学周的周一（可留空）<Input className="mt-1" type="date" value={form.firstWeekDate} onChange={(event) => edit({ ...form, firstWeekDate: event.target.value })} /></label>
      </div>
      {!isValidFirstWeekDate(form.firstWeekDate) && <p className="text-xs text-danger">请选择第 1 教学周的周一日期；尚不确定可以留空。</p>}
      <p className="text-xs text-ink-3">未填写首周日期时按第 N 周查看，不推测开学日期。第 11 节按相同休息规则设为 21:20–22:10。</p>
      {warnings.length > 0 && <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-950"><ul className="list-disc space-y-1 pl-4">{warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul><label className="mt-3 flex items-start gap-2"><input type="checkbox" checked={warningsChecked} onChange={(event) => setWarningsChecked(event.target.checked)} />我已核对提示，并补齐遗漏或不确定的排课</label></div>}
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm">查看<select aria-label="教学周" className={`${selectable} w-auto`} value={week} onChange={(event) => setWeek(Number(event.target.value))}>{Array.from({ length: MAX_TEACHING_WEEK }, (_, index) => <option key={index} value={index + 1}>第 {index + 1} 周</option>)}</select></label>
        <label className="md:hidden"><span className="sr-only">星期</span><select className={`${selectable} w-auto`} value={day} onChange={(event) => setDay(Number(event.target.value))}>{DAYS.map((label, index) => <option key={label} value={index + 1}>{label}</option>)}</select></label>
        <span className="text-xs text-ink-3">{form.lessons.length} 条排课{dirty ? ' · 尚未保存' : saved ? ' · 已保存' : ''}</span>
      </div>
      <WeekPreview lessons={form.lessons} week={week} day={day} firstWeekDate={form.firstWeekDate} />
      {conflicts.length > 0 && <p className="text-sm text-danger">发现 {conflicts.length} 组时间重叠，请展开标记的排课核对。若为学校安排的冲突，可保留并保存。</p>}
      <details open={showLessons} onToggle={(event) => setShowLessons(event.currentTarget.open)}><summary className="cursor-pointer text-sm font-semibold">校对与编辑全部排课（{form.lessons.length} 条）</summary>
        <div className="mt-3 space-y-2">{form.lessons.map((lesson) => <LessonFields key={`${editorVersion}-${lesson.id}`} lesson={lesson} conflict={conflictIds.has(lesson.id)} onChange={(next) => edit({ ...form, lessons: form.lessons.map((item) => item.id === lesson.id ? next : item) })} onRemove={() => edit({ ...form, lessons: form.lessons.filter((item) => item.id !== lesson.id) })} />)}</div>
      </details>
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" icon={<Plus size={14} />} disabled={form.lessons.length >= MAX_TIMETABLE_LESSONS} onClick={() => { edit({ ...form, lessons: [...form.lessons, { id: crypto.randomUUID(), courseName: '', course: '', day: 1, startPeriod: 1, endPeriod: 2, weeks: Array.from({ length: 16 }, (_, index) => index + 1), location: '' }] }); setShowLessons(true); }}>手动添加排课</Button>
        <Button type="button" variant="primary" size="sm" loading={busy} disabled={!dirty || !valid || !!pendingImport} onClick={() => void save()}>确认并保存课表</Button>
        {dirty && <Button type="button" variant="ghost" size="sm" onClick={() => { setForm(baseline); setWarnings([]); setPendingImport(null); setStatus('已恢复到上次保存的课表'); setEditorVersion((version) => version + 1); }}>放弃本次课表修改</Button>}
      </div>
      {dirty && !form.semester.trim() && <p className="text-xs text-ink-3">填写学期后才能保存课表。</p>}
      {dirty && form.lessons.some((lesson) => !validLesson(lesson)) && <p className="text-xs text-danger">请展开「校对与编辑全部排课」，补全标为待补全的课程。</p>}
    </fieldset>
    {saved && !dirty && !pendingImport && <div className="space-y-3 border-t border-line pt-4">
      <p className="text-xs leading-5 text-ink-3">课表已独立保存。下面两项会更新问卷答案；用于匹配的重点科目仍由你自己选择。</p>
      <Button type="button" size="sm" disabled={busy || !saved.lessons.some((lesson) => lesson.course)} onClick={() => {
        const courses = [...new Set([...semesterCourses, ...saved.lessons.map((lesson) => lesson.course).filter(Boolean)])];
        if (courses.length > SEMESTER_COURSE_LIMIT) { setError(`本学期课程最多 ${SEMESTER_COURSE_LIMIT} 门，请先整理课程清单`); return; }
        onCoursesChange(courses); setStatus('已将确认的标准课程加入本学期课程清单。');
      }}>将课表课程加入本学期课程</Button>
      <div className="space-y-2"><p className="text-xs leading-5 text-ink-3">从你已经选择的可学习时间中，扣除整学期任一周与课程重叠的时间格（含连堂课间 10 分钟）。不会自动增加空闲时间。预计移除 {removedSlots} 格，保留 {suggestedSchedule.length} 格。</p>
        <Button type="button" size="sm" disabled={busy || removedSlots === 0} onClick={() => { onScheduleChange(suggestedSchedule); setStatus('已按课表扣除重叠时间，请核对问卷中的可学习时间。'); }}>确认扣除上课时间</Button>
        {!schedule.length && <p className="text-xs text-ink-3">请先在问卷中选择自己愿意学习的时间，再使用此功能。</p>}
      </div>
    </div>}
    {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    {status && <p role="status" className="text-sm text-brand-text">{status}</p>}
  </section>;
}

export default TimetableEditor;
