import { resolveSubjectOption } from './courseCatalog.ts';
import { PERIODS, SLOT_COUNT, slotDay, slotPeriod } from './options.ts';

export const LESSON_TIMES = [
  ['08:00', '08:50'], ['09:00', '09:50'], ['10:20', '11:10'], ['11:20', '12:10'],
  ['14:00', '14:50'], ['15:00', '15:50'], ['16:20', '17:10'], ['17:20', '18:10'],
  ['19:00', '19:50'], ['20:00', '20:50'], ['21:20', '22:10'],
] as const;
export const MAX_TEACHING_WEEK = 30;
export const MAX_TIMETABLE_LESSONS = 200;

/** Independent, private timetable. Neither raw files nor teachers/student details are stored. */
export interface TimetableLesson {
  id: string;
  courseName: string;
  /** Canonical catalog label, or empty when a course still needs catalog confirmation. */
  course: string;
  day: number; // Monday = 1
  startPeriod: number;
  endPeriod: number;
  weeks: number[];
  location: string;
}
export interface TimetableInput {
  semester: string;
  /** Monday of teaching week 1, or empty if unknown. */
  firstWeekDate: string;
  lessons: TimetableLesson[];
}
export interface PrivateTimetable extends TimetableInput { updatedAt: string }
export interface TimetableImport {
  lessons: TimetableLesson[];
  warnings: string[];
  courseCount: number;
}

/** Parity belongs to each comma-delimited segment: 1,2-16双周 keeps week 1. */
export function parseTeachingWeeks(raw: string): number[] {
  const value = raw.normalize('NFKC').replace(/[\[\]【】\s第]/g, '').replace(/[，、；;]/g, ',').replace(/[~～—–至]/g, '-');
  if (!value) throw new Error('请填写上课周次');
  const weeks = new Set<number>();
  for (const segment of value.split(',')) {
    const match = segment.match(/^(\d{1,2})(?:-(\d{1,2}))?(?:\(?(单|双)(?:周)?\)?|周(?:\(?(单|双)\)?)?)?$/);
    if (!match) throw new Error('周次格式应为 1-16周、1,3-16周或 2-16双周');
    const start = Number(match[1]);
    const end = Number(match[2] ?? match[1]);
    const parity = match[3] ?? match[4];
    if (start < 1 || end > MAX_TEACHING_WEEK || end < start) throw new Error(`周次须在 1–${MAX_TEACHING_WEEK} 周内`);
    for (let week = start; week <= end; week++) {
      if (!parity || week % 2 === (parity === '单' ? 1 : 0)) weeks.add(week);
    }
  }
  if (!weeks.size) throw new Error('该周次条件没有包含任何一周');
  return [...weeks].sort((a, b) => a - b);
}

export function formatTeachingWeeks(weeks: readonly number[]): string {
  const sorted = [...new Set(weeks)].sort((a, b) => a - b);
  const runs: string[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const first = sorted[i];
    let end = first;
    while (sorted[i + 1] === end + 1) end = sorted[++i];
    runs.push(end === first ? `${first}` : `${first}-${end}`);
  }
  return runs.join(',');
}

export function lessonTime(lesson: Pick<TimetableLesson, 'startPeriod' | 'endPeriod'>): string {
  return `${LESSON_TIMES[lesson.startPeriod - 1]?.[0] ?? '?'}–${LESSON_TIMES[lesson.endPeriod - 1]?.[1] ?? '?'}`;
}

const canonicalCourse = (name: string) => {
  const option = resolveSubjectOption(name);
  return option?.kind === 'course' ? option.label : '';
};

export function deduplicateLessons(lessons: readonly TimetableLesson[]): TimetableLesson[] {
  const seen = new Set<string>();
  const ids = new Set<string>();
  return lessons.flatMap((lesson, index) => {
    const weeks = [...new Set(lesson.weeks)].sort((a, b) => a - b);
    const key = JSON.stringify([lesson.course || lesson.courseName.trim(), lesson.day, lesson.startPeriod, lesson.endPeriod, weeks, lesson.location.trim()]);
    if (seen.has(key)) return [];
    seen.add(key);
    let id = lesson.id;
    let suffix = index;
    while (ids.has(id)) id = `${lesson.id}-${suffix++}`;
    ids.add(id);
    return [{ ...lesson, id, weeks }];
  });
}

/** TIS grid export. The matrix comes from read-excel-file, in a browser or Node. */
export function parseTisTimetable(rows: readonly (readonly unknown[])[]): TimetableImport {
  if (rows.length > 500 || rows.some((row) => row.length > 50)) throw new Error('课表范围过大，请使用 TIS 导出的个人周课表');
  const dayValue = (cell: unknown) => {
    const match = String(cell ?? '').trim().match(/^(?:星期|周|礼拜)([一二三四五六日天])$/);
    return match ? '一二三四五六日天'.indexOf(match[1]) % 7 + 1 : 0;
  };
  // Sunday synonyms must both map to day 7.
  const weekday = (cell: unknown) => /^(?:星期|周|礼拜)天$/.test(String(cell ?? '').trim()) ? 7 : dayValue(cell);
  const headerIndex = rows.findIndex((row) => row.filter((cell) => weekday(cell)).length >= 5);
  if (headerIndex < 0) throw new Error('未找到星期表头，请上传 TIS 导出的学生课表 .xlsx 文件');
  const columns = rows[headerIndex].map(weekday);
  const lessons: TimetableLesson[] = [];
  const warnings: string[] = [];
  for (let r = headerIndex + 1; r < rows.length; r++) {
    for (let c = 0; c < rows[r].length; c++) {
      const day = columns[c];
      const raw = String(rows[r][c] ?? '').trim();
      if (!day || !raw) continue;
      if (raw.length > 20_000) throw new Error('单个课表单元格内容过长');
      const records = [...raw.matchAll(/\[([^\]]*周[^\]]*)\]\s*\[([^\]]*)\]\s*\[([^\]]*节)\]/g)];
      if (!records.length) {
        warnings.push(`第 ${r + 1} 行、第 ${c + 1} 列未识别到完整排课，请核对并手动补充。`);
        continue;
      }
      let previousEnd = 0;
      for (const record of records) {
        const prefix = raw.slice(previousEnd, record.index).trim();
        previousEnd = record.index! + record[0].length;
        const courseName = prefix.split(/\r?\n/).map((line) => line.trim()).find((line) => line && !line.startsWith('[')) ?? '';
        const period = record[3].normalize('NFKC').match(/^(\d{1,2})(?:[-–~](\d{1,2}))?节$/);
        let weeks: number[] = [];
        try { weeks = parseTeachingWeeks(record[1]); }
        catch { warnings.push(`「${courseName || '未命名课程'}」的周次需要手动校对。`); }
        const startPeriod = period ? Number(period[1]) : 0;
        const endPeriod = period ? Number(period[2] ?? period[1]) : 0;
        if (!period || startPeriod < 1 || endPeriod > LESSON_TIMES.length || endPeriod < startPeriod) {
          warnings.push(`「${courseName || '未命名课程'}」的节次需要手动校对。`);
        }
        const course = canonicalCourse(courseName);
        if (!course) warnings.push(`「${courseName || '未命名课程'}」尚未对应标准课程，已保留原名供确认。`);
        lessons.push({ id: `import-${r}-${c}-${lessons.length}`, courseName, course, day, startPeriod, endPeriod, weeks, location: record[2].trim() });
      }
      if (raw.slice(previousEnd).trim()) warnings.push(`第 ${r + 1} 行、第 ${c + 1} 列有未识别的剩余内容，请核对是否漏课。`);
    }
  }
  if (!lessons.length) throw new Error('文件中没有可识别的排课，请检查文件是否为 TIS 个人课表');
  if (lessons.length > MAX_TIMETABLE_LESSONS) throw new Error(`最多支持 ${MAX_TIMETABLE_LESSONS} 条排课`);
  const unique = deduplicateLessons(lessons);
  return { lessons: unique, warnings: [...new Set(warnings)], courseCount: new Set(unique.map((lesson) => lesson.course || lesson.courseName)).size };
}

export function timetableConflicts(lessons: readonly TimetableLesson[]): [string, string][] {
  const conflicts: [string, string][] = [];
  for (let i = 0; i < lessons.length; i++) for (let j = i + 1; j < lessons.length; j++) {
    const a = lessons[i]; const b = lessons[j];
    if (a.day === b.day && a.startPeriod <= b.endPeriod && b.startPeriod <= a.endPeriod && a.weeks.some((week) => b.weeks.includes(week))) conflicts.push([a.id, b.id]);
  }
  return conflicts;
}

export function isValidFirstWeekDate(value: string): boolean {
  if (value === '') return true;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value && date.getUTCDay() === 1;
}

/** Asia/Shanghai calendar dates, with no computer-timezone assumptions. */
export function teachingWeek(firstWeekDate: string, now = new Date()): number | null {
  if (!firstWeekDate || !isValidFirstWeekDate(firstWeekDate)) return null;
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const part = (name: string) => parts.find((value) => value.type === name)!.value;
  return Math.floor((Date.parse(`${part('year')}-${part('month')}-${part('day')}T00:00:00Z`) - Date.parse(`${firstWeekDate}T00:00:00Z`)) / 604_800_000) + 1;
}

/** Conservatively remove whole availability slots overlapping any teaching week. Never add availability. */
export function subtractTimetableFromSchedule(schedule: readonly number[], lessons: readonly TimetableLesson[]): number[] {
  const minutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
  return [...new Set(schedule)].filter((slot) => Number.isInteger(slot) && slot >= 0 && slot < SLOT_COUNT).filter((slot) => {
    const [startHour, endHour] = PERIODS[slotPeriod(slot)].time.split('–').map(Number);
    return !lessons.some((lesson) => lesson.weeks.length && lesson.day - 1 === slotDay(slot)
      && LESSON_TIMES[lesson.startPeriod - 1] && LESSON_TIMES[lesson.endPeriod - 1]
      && startHour * 60 < minutes(LESSON_TIMES[lesson.endPeriod - 1][1])
      && endHour * 60 > minutes(LESSON_TIMES[lesson.startPeriod - 1][0]));
  }).sort((a, b) => a - b);
}
