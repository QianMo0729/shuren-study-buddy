import { z } from 'zod';
import { resolveSubjectOption } from '../shared/courseCatalog.ts';
import { deduplicateLessons, isValidFirstWeekDate, LESSON_TIMES, MAX_TEACHING_WEEK, MAX_TIMETABLE_LESSONS, type PrivateTimetable, type TimetableInput } from '../shared/timetable.ts';
import { HttpError } from './auth.ts';
import { db, q } from './db.ts';
import { registerAccountCleanup } from './social.ts';

export function initTimetableSchema() {
  db.exec(`CREATE TABLE IF NOT EXISTS private_timetables (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    data TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`);
}
initTimetableSchema();

const lessonSchema = z.object({
  id: z.string().min(1).max(100).regex(/^[a-zA-Z0-9_-]+$/),
  courseName: z.string().trim().min(1).max(200),
  course: z.string().max(250).refine((value) => !value || (resolveSubjectOption(value)?.kind === 'course' && resolveSubjectOption(value)?.label === value), '请选择有效的标准课程'),
  day: z.number().int().min(1).max(7),
  startPeriod: z.number().int().min(1).max(LESSON_TIMES.length),
  endPeriod: z.number().int().min(1).max(LESSON_TIMES.length),
  weeks: z.array(z.number().int().min(1).max(MAX_TEACHING_WEEK)).min(1).max(MAX_TEACHING_WEEK),
  location: z.string().trim().max(200),
}).strict().refine((value) => value.endPeriod >= value.startPeriod, '结束节次不能早于开始节次');

const timetableSchema = z.object({
  semester: z.string().trim().min(1).max(80),
  firstWeekDate: z.string().refine(isValidFirstWeekDate, '首周日期应为真实的周一日期，或留空'),
  lessons: z.array(lessonSchema).max(MAX_TIMETABLE_LESSONS),
}).strict();

export function validateTimetable(raw: unknown): TimetableInput {
  const parsed = timetableSchema.safeParse(raw);
  if (!parsed.success) throw new HttpError(400, '课表格式不正确：请检查学期、课程、节次和周次');
  if (new Set(parsed.data.lessons.map((lesson) => lesson.id)).size !== parsed.data.lessons.length) throw new HttpError(400, '课程记录编号重复，请重新导入');
  return { ...parsed.data, lessons: deduplicateLessons(parsed.data.lessons) };
}

export function getTimetable(userId: number): PrivateTimetable | null {
  const row = q.get<{ data: string; updated_at: string }>('SELECT data, updated_at FROM private_timetables WHERE user_id = ?', userId);
  return row ? { ...JSON.parse(row.data), updatedAt: row.updated_at } : null;
}

export function saveTimetable(userId: number, raw: unknown): PrivateTimetable {
  const data = validateTimetable(raw);
  const updatedAt = new Date().toISOString();
  q.run(`INSERT INTO private_timetables (user_id, data, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`, userId, JSON.stringify(data), updatedAt);
  return { ...data, updatedAt };
}

export function deleteUserTimetable(userId: number) { q.run('DELETE FROM private_timetables WHERE user_id = ?', userId); }
registerAccountCleanup(deleteUserTimetable);
