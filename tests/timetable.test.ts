import assert from 'node:assert/strict';
import test from 'node:test';
import { COURSE_OPTIONS } from '../shared/courseCatalog.ts';
import {
  deduplicateLessons, formatTeachingWeeks, isValidFirstWeekDate, LESSON_TIMES, lessonTime,
  parseTeachingWeeks, parseTisTimetable, subtractTimetableFromSchedule, teachingWeek, timetableConflicts, type TimetableLesson,
} from '../shared/timetable.ts';

const lesson = (patch: Partial<TimetableLesson> = {}): TimetableLesson => ({ id: 'one', courseName: '测试课程', course: '', day: 1, startPeriod: 1, endPeriod: 2, weeks: [1, 2], location: '测试教室', ...patch });

test('TIS week lists retain standalone week 1 before even/odd range modifiers', () => {
  assert.deepEqual(parseTeachingWeeks('1,2-16双周'), [1, 2, 4, 6, 8, 10, 12, 14, 16]);
  assert.deepEqual(parseTeachingWeeks('1,5-15单周'), [1, 5, 7, 9, 11, 13, 15]);
  assert.deepEqual(parseTeachingWeeks('第3周'), [3]);
  assert.deepEqual(parseTeachingWeeks('1,3-6周'), [1, 3, 4, 5, 6]);
  assert.deepEqual(parseTeachingWeeks('1-6周(单)'), [1, 3, 5]);
  assert.deepEqual(parseTeachingWeeks('第１－４周'), [1, 2, 3, 4]);
  assert.equal(formatTeachingWeeks([1, 2, 4, 5, 6, 8]), '1-2,4-6,8');
  for (const invalid of ['', '31周', '0周', '8-2周', '1,未知周', '2-2单周', '1-4周junk']) assert.throws(() => parseTeachingWeeks(invalid));
});

test('TIS multi-record cells preserve arrangements and unknown courses without retaining teacher data', () => {
  const known = COURSE_OPTIONS[0];
  const rows = [
    ['测试课表'],
    ['节次', '周一', '周二', '周三', '周四', '周五', '周六', '周日'],
    ['第7-8节', '', '', '', '', `${known.name}\n[测试班]\n[测试教师]\n[1,5-15单周][A101][7-8节]\n未收录的测试课程\n[测试教师]\n[3周][B202][7-8节]\n${known.name}\n[测试教师]\n[2-16双周][C303][7-8节]`],
  ];
  const imported = parseTisTimetable(rows);
  assert.equal(imported.lessons.length, 3);
  assert.equal(imported.courseCount, 2);
  assert.equal(imported.lessons[0].courseName, known.name);
  assert.equal(imported.lessons[0].course, known.label);
  assert.deepEqual(imported.lessons[0].weeks, [1, 5, 7, 9, 11, 13, 15]);
  assert.equal(imported.lessons[1].course, '');
  assert.equal(imported.lessons[1].courseName, '未收录的测试课程');
  assert.equal(imported.lessons[1].location, 'B202');
  assert.equal(imported.lessons[2].day, 5);
  assert.equal(imported.lessons[2].startPeriod, 7);
  assert.equal(imported.warnings.length, 1);
  assert.ok(!JSON.stringify(imported).includes('测试教师'));
  assert.deepEqual(timetableConflicts(imported.lessons), []);
});

test('unknown or incomplete grid data is reported, and invalid weeks remain editable', () => {
  const imported = parseTisTimetable([
    ['', '星期一', '星期二', '星期三', '星期四', '星期五'],
    ['', '测试课程\n[未知周][A101][1-2节]', '无法解析的非空单元格'],
  ]);
  assert.equal(imported.lessons.length, 1);
  assert.deepEqual(imported.lessons[0].weeks, []);
  assert.ok(imported.warnings.some((warning) => warning.includes('周次')));
  assert.ok(imported.warnings.some((warning) => warning.includes('未识别到完整排课')));
  assert.throws(() => parseTisTimetable([['随意表格', '姓名']]));
});

test('reimport deduplicates exact records while retaining separate weeks and locations', () => {
  const first = lesson();
  const next = deduplicateLessons([first, { ...first, id: 'second', weeks: [2, 1, 1] }, { ...first, location: '另一教室' }, { ...first, weeks: [3] }]);
  assert.equal(next.length, 3);
  assert.equal(new Set(next.map((item) => item.id)).size, 3);
  assert.deepEqual(next[0].weeks, [1, 2]);
});

test('period times cover mornings, afternoons and evenings exactly', () => {
  assert.equal(lessonTime(lesson({ startPeriod: 5, endPeriod: 6 })), '14:00–15:50');
  assert.equal(lessonTime(lesson({ startPeriod: 9, endPeriod: 10 })), '19:00–20:50');
  assert.deepEqual(LESSON_TIMES[10], ['21:20', '22:10']);
});

test('availability only removes selected overlapping whole slots across all teaching weeks', () => {
  // Monday: 08–10, 10–12, 12–14, 14–16, 16–18, 18–20, 20–22, 22–24, 00–08; Tuesday starts at 9.
  const selected = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
  const lessons = [lesson(), lesson({ id: 'late', startPeriod: 4, endPeriod: 4, weeks: [2] }), lesson({ id: 'evening', startPeriod: 9, endPeriod: 10, weeks: [3] })];
  assert.deepEqual(subtractTimetableFromSchedule(selected, lessons), [3, 4, 7, 8, 9]);
  assert.deepEqual(subtractTimetableFromSchedule([], lessons), []);
  assert.deepEqual(subtractTimetableFromSchedule([0, 0, -1, 63], []), [0]);
  assert.deepEqual(subtractTimetableFromSchedule([6, 7], [lesson({ startPeriod: 11, endPeriod: 11 })]), []);
});

test('conflicts require overlapping weekday, periods and actual weeks', () => {
  const a = lesson();
  assert.deepEqual(timetableConflicts([a, lesson({ id: 'b', weeks: [3] })]), []);
  assert.deepEqual(timetableConflicts([a, lesson({ id: 'b', day: 2 })]), []);
  assert.deepEqual(timetableConflicts([a, lesson({ id: 'b', startPeriod: 2, endPeriod: 3 })]), [['one', 'b']]);
});

test('teaching-week dates are explicit valid Mondays and use Beijing date boundaries', () => {
  assert.ok(isValidFirstWeekDate(''));
  assert.ok(isValidFirstWeekDate('2026-09-07'));
  assert.ok(!isValidFirstWeekDate('2026-09-08'));
  assert.ok(!isValidFirstWeekDate('2026-02-30'));
  assert.equal(teachingWeek('', new Date()), null);
  assert.equal(teachingWeek('2026-09-07', new Date('2026-09-13T15:59:59Z')), 1);
  assert.equal(teachingWeek('2026-09-07', new Date('2026-09-13T16:00:00Z')), 2);
});
