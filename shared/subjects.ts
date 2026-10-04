// 具体科目的等价判断：匹配算法（学习内容维度）与「在学的科目」检索共用。
// 注意：这里只收录真正等价的叫法（线代 = 线性代数）。shared/options.ts 的 SYNONYMS 是为关键词检索的召回准备的，
// 里面有「编程 / 刷题 / 算法」「考研 / 研究生」这类相关但不同的词，不能用来判断两个人是否在学同一门课。

/** 每组第一个是完整名称（用于包含关系判断），其余是常见简称或英文名 */
export const SUBJECT_SYNONYMS: string[][] = [
  ['线性代数', '线代'],
  ['数学分析', '数分'],
  ['高等数学', '高数', '微积分', 'calculus'],
  ['概率论与数理统计', '概率论', '概统', '概率统计'],
  ['大学物理', '大物'],
  ['模拟电子技术', '模拟电路', '模电'],
  ['数字电子技术', '数字电路', '数电'],
  ['计算机组成原理', '计组'],
  ['离散数学', '离散'],
  ['数据结构与算法', '数据结构'],
  ['大学英语四级', '四级', 'cet4', 'cet-4'],
  ['大学英语六级', '六级', 'cet6', 'cet-6'],
  ['雅思', 'ielts'],
  ['托福', 'toefl'],
  ['gre'],
  ['leetcode', '力扣'],
];

/** 标准化：全角兼容、小写、去掉空白与常见标点 */
export const subjectKey = (raw: string) =>
  String(raw ?? '').normalize('NFKC').toLowerCase().replace(/[\s·•・()（）[\]【】「」『』"'“”‘’_\-—–]+/gu, '');

const GROUPS = SUBJECT_SYNONYMS.map((group) => [...new Set(group.map(subjectKey).filter(Boolean))]);

export interface SubjectForm {
  /** 自身的标准化写法 */
  key: string;
  /** 所在同义组的完整名称（不在任何组时为自身） */
  canonical: string;
  /** 自身及全部等价写法 */
  aliases: string[];
}

export function subjectForm(raw: string): SubjectForm | null {
  const key = subjectKey(raw);
  if (!key) return null;
  const group = GROUPS.find((g) => g.includes(key));
  return { key, canonical: group?.[0] ?? key, aliases: group ?? [key] };
}

/** 包含关系也算同一科目（线性代数 ⊂ 线性代数ii）；英文短词要求两侧不是字母，避免 gre ⊂ progress */
function contains(long: string, short: string): boolean {
  if (short.length < 2 || long.length <= short.length) return false;
  const ascii = /^[\x20-\x7e]+$/.test(short);
  for (let i = long.indexOf(short); i >= 0; i = long.indexOf(short, i + 1)) {
    if (!ascii) return true;
    const before = long[i - 1] ?? '';
    const after = long[i + short.length] ?? '';
    if (!/[a-z]/.test(before) && !/[a-z]/.test(after)) return true;
  }
  return false;
}

/** 参与包含关系判断的写法：自身、完整名称，以及足够长的等价叫法（太短的简称如「数分」容易误中「函数分析」） */
function containable(form: SubjectForm): string[] {
  const longEnough = (alias: string) => (/^[\x20-\x7e]+$/.test(alias) ? alias.length >= 4 : alias.length >= 3);
  return [...new Set([form.key, form.canonical, ...form.aliases.filter(longEnough)])];
}

/**
 * 两门科目是否相同：等价写法完全一致，或者自身写法 / 完整名称 / 较长的等价叫法之间存在包含关系。
 * 只使用本文件的严格等价表，避免「考研数学刷题」因为含「刷题」被当成 LeetCode。
 */
export function sameSubject(a: SubjectForm, b: SubjectForm): boolean {
  if (a.aliases.some((x) => b.aliases.includes(x))) return true;
  const left = containable(a);
  const right = containable(b);
  return left.some((x) => right.some((y) => contains(x, y) || contains(y, x)));
}
