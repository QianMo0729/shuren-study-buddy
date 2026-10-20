// 南方科技大学本科专业（依据《2025 级本科人才培养方案》，按学院 / 系分组），用于下拉框与「院系」检索。
// 学校专业设置有变化时，直接修改此文件即可，无需改动其他代码。

export interface MajorGroup {
  college: string;
  majors: string[];
}

export const UNDECIDED = '暂无 / 未定';

export const MAJOR_GROUPS: MajorGroup[] = [
  { college: '数学系', majors: ['数学与应用数学', '金融数学'] },
  { college: '物理系', majors: ['物理学', '应用物理学'] },
  { college: '化学系', majors: ['化学'] },
  { college: '地球与空间科学系', majors: ['地球物理学'] },
  { college: '统计与数据科学系', majors: ['统计学', '数据科学与大数据技术'] },
  { college: '力学与航空航天工程系', majors: ['理论与应用力学', '航空航天工程'] },
  { college: '机械与能源工程系', majors: ['机械工程', '机器人工程', '新能源科学与工程'] },
  { college: '材料科学与工程系', majors: ['材料科学与工程', '光电信息材料与器件'] },
  { college: '电子与电气工程系', majors: ['通信工程', '光电信息科学与工程', '信息工程'] },
  { college: '计算机科学与工程系', majors: ['计算机科学与技术', '智能科学与技术'] },
  { college: '海洋科学与工程系', majors: ['海洋科学', '海洋工程与技术'] },
  { college: '生物医学工程系', majors: ['生物医学工程', '智能医学工程'] },
  { college: '环境科学与工程学院', majors: ['环境科学与工程', '水文与水资源工程'] },
  { college: '深港微电子学院', majors: ['微电子科学与工程'] },
  { college: '自动化与智能制造学院', majors: ['自动化'] },
  { college: '创新创意设计学院', majors: ['工业设计'] },
  { college: '工学院', majors: ['人工智能'] },
  { college: '生命科学学院', majors: ['生物科学', '生物信息学'] },
  { college: '医学院', majors: ['生物医学科学', '临床医学', '口腔医学'] },
  { college: '南科大伦敦国王学院医学院', majors: ['生物医学科学（中外合作）', '生物医学工程（中外合作）'] },
  { college: '商学院', majors: ['金融学', '金融工程', '大数据管理与应用', '工业工程'] },
  { college: '其他', majors: ['未分专业（大类培养）', UNDECIDED, '其他专业'] },
];

const MAJOR_TO_COLLEGE = new Map<string, string>();
for (const g of MAJOR_GROUPS) for (const m of g.majors) MAJOR_TO_COLLEGE.set(m, g.college);

export const ALL_MAJORS = [...MAJOR_TO_COLLEGE.keys()];
export const COLLEGES = MAJOR_GROUPS.filter((g) => g.college !== '其他').map((g) => g.college);
export const isKnownMajor = (v: unknown): v is string => typeof v === 'string' && MAJOR_TO_COLLEGE.has(v);
export const collegeOf = (major: string) => MAJOR_TO_COLLEGE.get(major) ?? '';

const majorKey = (value: string) => value.normalize('NFKC').replace(/\s+/g, '').toLowerCase();
const STANDARD_MAJORS = new Map(ALL_MAJORS.map((major) => [majorKey(major), major]));
const MAJOR_ALIASES: Record<string, string> = {
  '计科': '计算机科学与技术', '计算机专业': '计算机科学与技术', 'cs': '计算机科学与技术',
  '未分专业': '未分专业（大类培养）', '暂未确定': UNDECIDED, '未定': UNDECIDED,
};

/** Only unambiguous aliases migrate; department names must not guess a degree. */
export function canonicalMajor(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const key = majorKey(value);
  if (!key) return '';
  return STANDARD_MAJORS.get(key) ?? (Object.hasOwn(MAJOR_ALIASES, key) ? MAJOR_ALIASES[key] : null);
}

/** 南科大学号：8 位，首位 1 表示学生，第 2–3 位为入学年份，第 4 位 1 = 本科、3 = 研究生 */
export const STUDENT_ID_RE = /^1\d{7}$/;

/** 根据学号推断年级（每年 9 月进入新学年） */
export function gradeFromStudentId(id: string, now = new Date()): string {
  if (!STUDENT_ID_RE.test(id)) return '';
  if (id[3] === '3') return 'grad';
  const entry = 2000 + Number(id.slice(1, 3));
  const academicYear = now.getMonth() >= 8 ? now.getFullYear() : now.getFullYear() - 1;
  const n = academicYear - entry + 1;
  return n >= 1 && n <= 4 ? `y${n}` : '';
}
