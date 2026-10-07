import assert from 'node:assert/strict';
import test from 'node:test';
import { COURSE_OPTIONS, EXAM_CATEGORIES, EXAM_OPTIONS, EXAM_SERIES, invalidSelectedSemesterCourses, invalidSelectedSubjects, normalizeSelectedSemesterCourses, normalizeSelectedSubjects, resolveSubjectOption, searchSubjectOptions } from '../shared/courseCatalog.ts';
import { SEMESTER_COURSE_LIMIT, SUBJECT_LIMIT } from '../shared/options.ts';
import { OFFICIAL_COURSE_ROWS } from '../shared/data/officialCourses.ts';
import { SUPPLEMENTAL_COURSES } from '../shared/data/supplementalCourses.ts';
import { sameSubject, subjectForm } from '../shared/subjects.ts';

test('official course snapshot and verified supplements have unique identities and readable labels', () => {
  assert.equal(OFFICIAL_COURSE_ROWS.length, 1622);
  assert.equal(COURSE_OPTIONS.length, 1623);
  assert.equal(new Set(COURSE_OPTIONS.map((course) => course.id)).size, COURSE_OPTIONS.length);
  assert.equal(resolveSubjectOption('CS109')?.label, 'CS109 计算机程序设计基础');
  assert.ok(COURSE_OPTIONS.some((course) => course.label.length > 30), 'official names must not be truncated to the former free-text limit');
});

test('CS317 supplement has official provenance and resolves timetable spacing consistently', () => {
  assert.equal(OFFICIAL_COURSE_ROWS.some(([code]) => code === 'CS317'), false, 'preserve the downloaded snapshot');
  const supplemental = SUPPLEMENTAL_COURSES.find((course) => course.code === 'CS317')!;
  assert.ok(supplemental);
  assert.equal(supplemental.verifiedAt, '2026-10-04');
  assert.equal(supplemental.sources.length, 2);
  assert.ok(supplemental.sources.every((source) => new URL(source.url).hostname.endsWith('.sustech.edu.cn') && source.page === 4));
  for (const query of ['CS317', '计算机科学与技术前沿讲座I', '计算机科学与技术前沿讲座 I', 'CS317 计算机科学与技术前沿讲座I']) {
    assert.equal(resolveSubjectOption(query)?.label, 'CS317 计算机科学与技术前沿讲座 I', query);
    assert.equal(searchSubjectOptions(query, 'course')[0]?.code, 'CS317', query);
  }
  assert.deepEqual(normalizeSelectedSubjects(['计算机科学与技术前沿讲座I', 'CS317']), ['CS317 计算机科学与技术前沿讲座 I']);
  assert.equal(resolveSubjectOption('计算机科学与技术前沿讲座II'), undefined);
  assert.equal(resolveSubjectOption('CS317')?.department, resolveSubjectOption('CS217')?.department);
});

test('search finds codes, names, departments and exams but cannot invent selections', () => {
  assert.equal(searchSubjectOptions('cs109')[0]?.code, 'CS109');
  assert.ok(searchSubjectOptions('计算机 程序设计', 'course').some((option) => option.code === 'CS109'));
  assert.ok(searchSubjectOptions('数学系', 'course').every((option) => option.department.includes('数学系')));
  assert.equal(searchSubjectOptions('IELTS', 'exam')[0]?.label, '雅思');
  assert.equal(searchSubjectOptions('不存在的新课程48797').length, 0);
  assert.equal(resolveSubjectOption('CS109 随意改名'), undefined);
  assert.deepEqual(normalizeSelectedSubjects([' ＣＳ１０９ ', 'CS109 计算机程序设计基础', 'IELTS', '雅思', '任意内容']), ['CS109 计算机程序设计基础', '雅思']);
  assert.equal(EXAM_OPTIONS.length, 40);
});

test('ambiguous legacy names require reselection and unknown drafts are not silently erased', () => {
  const duplicates = COURSE_OPTIONS.filter((course) => course.name === '模拟电路');
  assert.ok(duplicates.length > 1);
  assert.equal(resolveSubjectOption('模拟电路'), undefined);
  assert.deepEqual(invalidSelectedSubjects(['模拟电路', '旧自由科目', 'IELTS']), ['模拟电路', '旧自由科目']);
  assert.deepEqual(normalizeSelectedSubjects(['旧自由科目', '另一新值'], ['旧自由科目']), ['旧自由科目']);
});

test('semester courses use course-only identities and target normalization never silently truncates old selections', () => {
  assert.equal(SUBJECT_LIMIT, 3);
  assert.equal(SEMESTER_COURSE_LIMIT, 30);
  assert.deepEqual(normalizeSelectedSemesterCourses(['ＣＳ１０９', 'CS109 计算机程序设计基础', 'CS317']), ['CS109 计算机程序设计基础', 'CS317 计算机科学与技术前沿讲座 I']);
  assert.deepEqual(invalidSelectedSemesterCourses(['CS109', '雅思', 'IELTS', '任意课程', 42]), ['雅思', 'IELTS', '任意课程', '42']);
  assert.deepEqual(normalizeSelectedSemesterCourses(['雅思', '任意课程']), []);
  const previous = COURSE_OPTIONS.slice(0, 8).map((course) => course.label);
  assert.deepEqual(normalizeSelectedSubjects(previous), previous);
});

test('matching compares selected official course identities, not shared titles or substrings', () => {
  const same = (a: string, b: string) => sameSubject(subjectForm(a)!, subjectForm(b)!);
  const duplicates = COURSE_OPTIONS.filter((course) => course.name === '模拟电路');
  assert.equal(same(duplicates[0].label, duplicates[1].label), false);
  assert.equal(same('CS109', 'CS109 计算机程序设计基础'), true);
  assert.equal(same('CS109 计算机程序设计基础', '计算机程序设计基础'), true);
  assert.equal(same('CET 4 大学英语四级辅导课', '大学英语四级'), false);
  assert.equal(same('雅思', 'IELTS'), true);
  assert.equal(same('考研数学一', '考研数学二'), false);
});

test('common campus exams are searchable by Chinese names, English names and abbreviations', () => {
  const examples: [string, string][] = [
    ['IELTS', 'IELTS'], ['托福', 'TOEFL'], ['四级', 'CET4'], ['CET-6', 'CET6'],
    ['GMAT', 'GMAT'], ['PTE Academic', 'PTE-ACADEMIC'], ['托业', 'TOEIC'], ['多邻国', 'DET'],
    ['SAT', 'SAT'], ['ACT', 'ACT'], ['BEC Vantage', 'BEC-VANTAGE'],
    ['日语能力考试N1', 'JLPT-N1'], ['TOPIK 2', 'TOPIK-II'], ['计算机三级', 'NCRE3'],
    ['教资', 'TEACHER-QUALIFICATION'], ['法考', 'LEGAL-QUALIFICATION'], ['国考', 'NATIONAL-CIVIL-SERVICE'],
    ['CFA Level II', 'CFA2'], ['FRM Part I', 'FRM1'],
  ];
  for (const [query, code] of examples) {
    assert.equal(resolveSubjectOption(query)?.id, `exam:${code}`, query);
    assert.equal(searchSubjectOptions(query, 'exam')[0]?.code, code, query);
  }
  assert.deepEqual(searchSubjectOptions('四六级', 'exam').map((exam) => exam.code), ['CET4', 'CET6']);
  assert.equal(resolveSubjectOption('四六级'), undefined, 'a broad search must still require choosing a specific exam');
});

test('exam levels retain distinct identities and never match through name containment', () => {
  const levels = [
    ['BEC 初级', 'BEC 中级', 'BEC 高级'],
    ['日语 N1', '日语 N2', '日语 N3', '日语 N4', '日语 N5'],
    ['TOPIK I', 'TOPIK II'], ['计算机二级', '计算机三级', '计算机四级'],
    ['CFA Level I', 'CFA Level II', 'CFA Level III'], ['FRM Part I', 'FRM Part II'],
  ];
  for (const group of levels) {
    assert.equal(new Set(group.map((name) => resolveSubjectOption(name)?.id)).size, group.length);
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        assert.equal(sameSubject(subjectForm(group[i])!, subjectForm(group[j])!), false, `${group[i]} versus ${group[j]}`);
      }
    }
  }
  assert.equal(EXAM_OPTIONS.length, new Set(EXAM_OPTIONS.map((exam) => exam.id)).size);
});

test('every selectable answer belongs to an explicit multilevel course or preparation category', () => {
  assert.ok(COURSE_OPTIONS.every((course) => course.category === '校内课程' && course.family === course.department && !!course.family && course.level === undefined));
  const classifiedCodes = EXAM_SERIES.flatMap((series) => series.members.map(([code]) => code));
  assert.equal(classifiedCodes.length, EXAM_OPTIONS.length);
  assert.equal(new Set(classifiedCodes).size, EXAM_OPTIONS.length, 'each exam appears in exactly one series');
  assert.deepEqual(new Set(classifiedCodes), new Set(EXAM_OPTIONS.map((exam) => exam.code)));
  assert.deepEqual(new Set(EXAM_OPTIONS.map((exam) => exam.category)), new Set(EXAM_CATEGORIES));
  for (const series of EXAM_SERIES) {
    for (const [code, level] of series.members) {
      const exam = EXAM_OPTIONS.find((option) => option.code === code)!;
      assert.equal(exam.category, series.category);
      assert.equal(exam.family, series.family);
      assert.equal(exam.level, level);
      assert.equal(series.members.length > 1, !!level, `${code} needs an explicit level only in a multilevel series`);
    }
  }
  assert.equal(resolveSubjectOption('雅思')?.level, undefined);
  assert.equal(resolveSubjectOption('CFA Level II')?.level, '二级');
});

test('global search can discover classifications and series without changing selected identities', () => {
  const language = searchSubjectOptions('小语种', 'all');
  assert.equal(language.length, 7);
  assert.ok(language.every((option) => option.category === '小语种'));
  assert.equal(searchSubjectOptions('日语能力考试 JLPT', 'exam').length, 5);
  assert.deepEqual(searchSubjectOptions('职业资格 CFA 二级', 'all').map((option) => option.code), ['CFA2']);
  assert.deepEqual(searchSubjectOptions('计算机等级 三级', 'exam').map((option) => option.code), ['NCRE3']);
});
