import { OFFICIAL_COURSE_ROWS } from './data/officialCourses.ts';
import { SUPPLEMENTAL_COURSES } from './data/supplementalCourses.ts';

export const COURSE_CATALOG_SOURCE = 'https://course-tao.sustech.edu.cn/kcxxweb/queryKcxxwebListChinesePC';
export const COURSE_CATALOG_UPDATED_AT = '2026-10-04';
export interface SubjectOption {
  id: string;
  kind: 'course' | 'exam';
  code: string;
  name: string;
  label: string;
  department: string;
  category: string;
  family: string;
  level?: string;
  aliases: readonly string[];
}

const snapshotCodes = new Set(OFFICIAL_COURSE_ROWS.map(([code]) => code));
// A later public snapshot takes precedence if a supplemented course becomes available there.
const courseRows = [...OFFICIAL_COURSE_ROWS, ...SUPPLEMENTAL_COURSES
  .filter((course) => !snapshotCodes.has(course.code))
  .map(({ code, name, department }) => [code, name, department] as const)];
export const COURSE_OPTIONS: readonly SubjectOption[] = courseRows.map(([code, name, department]) => ({
  id: `course:${code}`, kind: 'course', code, name, label: `${code} ${name}`, department, category: '校内课程', family: department, aliases: [],
}));

// Exams have their own fixed list: university courses with similar titles are separate entries.
const EXAMS: readonly (readonly [code: string, name: string, ...aliases: string[]])[] = [
  ['IELTS', '雅思', 'IELTS'], ['TOEFL', '托福', 'TOEFL'], ['GRE', 'GRE'],
  ['CET4', '大学英语四级', '四级', 'CET-4', 'CET4', '四六级', 'CET'], ['CET6', '大学英语六级', '六级', 'CET-6', 'CET6', '四六级', 'CET'],
  ['JLPT-N2', '日语 N2', 'JLPT N2', 'JLPT-N2'],
  ['POSTGRAD-MATH1', '考研数学一', '数一'], ['POSTGRAD-MATH2', '考研数学二', '数二'], ['POSTGRAD-MATH3', '考研数学三', '数三'],
  ['POSTGRAD-ENGLISH1', '考研英语一'], ['POSTGRAD-ENGLISH2', '考研英语二'], ['POSTGRAD-POLITICS', '考研政治'],
  ['POSTGRAD-CS408', '408 计算机', '计算机408', '408计算机'], ['CPA', 'CPA', '注册会计师考试'],
  ['GMAT', 'GMAT', 'GMAT考试'],
  ['PTE-ACADEMIC', 'PTE 学术英语', 'PTE', 'PTE Academic', '培生学术英语考试'],
  ['TOEIC', '托业', 'TOEIC', '托业考试'],
  ['DET', '多邻国英语测试', 'DET', 'Duolingo English Test', '多邻国'],
  ['SAT', 'SAT', 'SAT考试'], ['ACT', 'ACT', 'ACT考试'],
  ['BEC-PRELIMINARY', 'BEC 初级', 'BEC Preliminary', '商务英语初级', '剑桥商务英语初级'],
  ['BEC-VANTAGE', 'BEC 中级', 'BEC Vantage', '商务英语中级', '剑桥商务英语中级'],
  ['BEC-HIGHER', 'BEC 高级', 'BEC Higher', '商务英语高级', '剑桥商务英语高级'],
  ['JLPT-N1', '日语 N1', 'JLPT N1', 'JLPT-N1', '日语能力考试N1'],
  ['JLPT-N3', '日语 N3', 'JLPT N3', 'JLPT-N3', '日语能力考试N3'],
  ['JLPT-N4', '日语 N4', 'JLPT N4', 'JLPT-N4', '日语能力考试N4'],
  ['JLPT-N5', '日语 N5', 'JLPT N5', 'JLPT-N5', '日语能力考试N5'],
  ['TOPIK-I', 'TOPIK I', 'TOPIK 1', '韩国语能力考试I', '韩语初级'],
  ['TOPIK-II', 'TOPIK II', 'TOPIK 2', '韩国语能力考试II', '韩语中高级'],
  ['NCRE2', '全国计算机等级考试二级', '计算机二级', 'NCRE 2', '全国计算机二级'],
  ['NCRE3', '全国计算机等级考试三级', '计算机三级', 'NCRE 3', '全国计算机三级'],
  ['NCRE4', '全国计算机等级考试四级', '计算机四级', 'NCRE 4', '全国计算机四级'],
  ['TEACHER-QUALIFICATION', '教师资格考试', '教资', '教师资格证考试'],
  ['LEGAL-QUALIFICATION', '法律职业资格考试', '法考', '司法考试'],
  ['NATIONAL-CIVIL-SERVICE', '国家公务员考试', '国考'],
  ['CFA1', 'CFA 一级', 'CFA Level 1', 'CFA Level I', '特许金融分析师一级'],
  ['CFA2', 'CFA 二级', 'CFA Level 2', 'CFA Level II', '特许金融分析师二级'],
  ['CFA3', 'CFA 三级', 'CFA Level 3', 'CFA Level III', '特许金融分析师三级'],
  ['FRM1', 'FRM 一级', 'FRM Part 1', 'FRM Part I', '金融风险管理师一级'],
  ['FRM2', 'FRM 二级', 'FRM Part 2', 'FRM Part II', '金融风险管理师二级'],
];
export const EXAM_CATEGORIES = ['大学英语', '海外升学', '小语种', '考研升学', '计算机等级', '职业资格', '公务员'] as const;
export type ExamCategory = typeof EXAM_CATEGORIES[number];
export interface ExamSeries {
  category: ExamCategory;
  family: string;
  members: readonly (readonly [code: string, level?: string])[];
}

/** Navigation structure: preparation category → exam series → level (when applicable). */
export const EXAM_SERIES: readonly ExamSeries[] = [
  { category: '大学英语', family: '大学英语等级考试 CET', members: [['CET4', '四级'], ['CET6', '六级']] },
  { category: '海外升学', family: '雅思 IELTS', members: [['IELTS']] },
  { category: '海外升学', family: '托福 TOEFL', members: [['TOEFL']] },
  { category: '海外升学', family: 'PTE 学术英语', members: [['PTE-ACADEMIC']] },
  { category: '海外升学', family: '托业 TOEIC', members: [['TOEIC']] },
  { category: '海外升学', family: '多邻国英语测试 DET', members: [['DET']] },
  { category: '小语种', family: '日语能力考试 JLPT', members: [['JLPT-N1', 'N1'], ['JLPT-N2', 'N2'], ['JLPT-N3', 'N3'], ['JLPT-N4', 'N4'], ['JLPT-N5', 'N5']] },
  { category: '小语种', family: '韩国语能力考试 TOPIK', members: [['TOPIK-I', 'I（初级）'], ['TOPIK-II', 'II（中高级）']] },
  { category: '考研升学', family: '考研数学', members: [['POSTGRAD-MATH1', '数学一'], ['POSTGRAD-MATH2', '数学二'], ['POSTGRAD-MATH3', '数学三']] },
  { category: '考研升学', family: '考研英语', members: [['POSTGRAD-ENGLISH1', '英语一'], ['POSTGRAD-ENGLISH2', '英语二']] },
  { category: '考研升学', family: '考研政治', members: [['POSTGRAD-POLITICS']] },
  { category: '考研升学', family: '计算机考研 408', members: [['POSTGRAD-CS408']] },
  { category: '海外升学', family: 'GRE', members: [['GRE']] },
  { category: '海外升学', family: 'GMAT', members: [['GMAT']] },
  { category: '海外升学', family: 'SAT', members: [['SAT']] },
  { category: '海外升学', family: 'ACT', members: [['ACT']] },
  { category: '计算机等级', family: '全国计算机等级考试', members: [['NCRE2', '二级'], ['NCRE3', '三级'], ['NCRE4', '四级']] },
  { category: '职业资格', family: '剑桥商务英语 BEC', members: [['BEC-PRELIMINARY', '初级'], ['BEC-VANTAGE', '中级'], ['BEC-HIGHER', '高级']] },
  { category: '职业资格', family: '注册会计师 CPA', members: [['CPA']] },
  { category: '职业资格', family: '教师资格考试', members: [['TEACHER-QUALIFICATION']] },
  { category: '职业资格', family: '法律职业资格考试', members: [['LEGAL-QUALIFICATION']] },
  { category: '职业资格', family: '特许金融分析师 CFA', members: [['CFA1', '一级'], ['CFA2', '二级'], ['CFA3', '三级']] },
  { category: '职业资格', family: '金融风险管理师 FRM', members: [['FRM1', '一级'], ['FRM2', '二级']] },
  { category: '公务员', family: '国家公务员考试', members: [['NATIONAL-CIVIL-SERVICE']] },
];
const examClassification = new Map(EXAM_SERIES.flatMap(({ category, family, members }) => members.map(([code, level]) => [code, { category, family, ...(level ? { level } : {}) }] as const)));
export const EXAM_OPTIONS: readonly SubjectOption[] = EXAMS.map(([code, name, ...aliases]) => {
  const classification = examClassification.get(code);
  if (!classification) throw new Error(`Missing exam classification: ${code}`);
  return { id: `exam:${code}`, kind: 'exam', code, name, label: name, department: '标准考试', ...classification, aliases: [...new Set([code, ...aliases])] };
});
export const SUBJECT_OPTIONS: readonly SubjectOption[] = [...COURSE_OPTIONS, ...EXAM_OPTIONS];

const clean = (raw: string) => raw.normalize('NFKC').replace(/[\p{Cc}\p{Cf}]/gu, '').replace(/\s+/gu, ' ').trim();
const keyOf = (raw: string) => clean(raw).toLocaleLowerCase().replace(/\s+/gu, '');
const byLabel = new Map(SUBJECT_OPTIONS.map((option) => [keyOf(option.label), option]));
// Keep spaces in bare codes so the official CET 4 course does not swallow the CET4 exam alias.
const byCode = new Map(COURSE_OPTIONS.map((option) => [clean(option.code).toLowerCase(), option]));
const byName = new Map<string, SubjectOption[]>();
for (const option of SUBJECT_OPTIONS) {
  for (const alias of new Set([option.name, ...option.aliases].map(keyOf))) {
    byName.set(alias, [...(byName.get(alias) ?? []), option]);
  }
}

/** Preserve course identity; names shared by several course codes require an explicit choice. */
export function resolveSubjectOption(raw: string): SubjectOption | undefined {
  const key = keyOf(raw);
  const exact = byLabel.get(key) ?? byCode.get(clean(raw).toLowerCase());
  if (exact) return exact;
  const named = byName.get(key);
  return named?.length === 1 ? named[0] : undefined;
}

export function invalidSelectedSubjects(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && !!clean(item) && !resolveSubjectOption(item)) : [];
}

/** Normalize without truncation; write/publication boundaries enforce the current limit. */
export function normalizeSelectedSubjects(value: unknown, legacySubjects: string[] = []): string[] {
  if (!Array.isArray(value)) return [];
  const legacy = new Set(legacySubjects.map(keyOf));
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of value) {
    if (typeof raw !== 'string') continue;
    const option = resolveSubjectOption(raw);
    const label = option?.label ?? (legacy.has(keyOf(raw)) ? clean(raw) : '');
    const id = option?.id ?? keyOf(label);
    if (!label || seen.has(id)) continue;
    seen.add(id); out.push(label);
  }
  return out;
}

export function invalidSelectedSemesterCourses(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item) => typeof item !== 'string' || resolveSubjectOption(item)?.kind !== 'course').map(String);
}

/** Timetable selections use course identities only; exams never become courses. */
export function normalizeSelectedSemesterCourses(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const selected = new Map<string, string>();
  for (const raw of value) {
    if (typeof raw !== 'string') continue;
    const option = resolveSubjectOption(raw);
    if (option?.kind === 'course') selected.set(option.id, option.label);
  }
  return [...selected.values()];
}

/** Search accepts text; only returned catalog entries can become answers. */
export function searchSubjectOptions(query: string, kind: 'all' | 'course' | 'exam' = 'all', limit = 30): SubjectOption[] {
  const keys = clean(query).toLocaleLowerCase().split(/\s+/u).filter(Boolean);
  const compact = keyOf(query);
  return SUBJECT_OPTIONS.filter((option) => {
    if (kind !== 'all' && option.kind !== kind) return false;
    const text = keyOf([option.code, option.name, option.department, option.category, option.family, option.level ?? '', ...option.aliases].join(' '));
    return keys.every((key) => text.includes(keyOf(key)));
  }).sort((a, b) => {
    const rank = (option: SubjectOption) => compact && [option.code, option.name, ...option.aliases].some((alias) => keyOf(alias) === compact) ? 0 : 1;
    return rank(a) - rank(b);
  }).slice(0, limit);
}
