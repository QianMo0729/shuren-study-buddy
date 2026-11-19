// 搭子打卡活动的规则参数与文字。服务端计分、后台设置、规则页和打卡页共用这一份，避免各处写的数字不一致。

export interface ActivityConfig {
  /** 赛季第一天，从这一天开始计分（北京时间日期 YYYY-MM-DD）。可以不是周一：计分周仍是周一到周日，第一周从这一天算到周日 */
  seasonStart: string;
  /** 赛季最后一天（周日） */
  seasonEnd: string;
  /** 两人打卡时间差不超过多少分钟算一次相同事件打卡 */
  windowMinutes: number;
  /** 两人打卡位置相距不超过多少米算一次相同事件打卡；0 表示不检查距离 */
  distanceMeters: number;
  /** 打卡定位误差超过多少米时，这次打卡不计分（定位不准就没法核对距离） */
  accuracyMeters: number;
  /** 每周最多计几次相同事件打卡 */
  weeklyCap: number;
  /** 阶梯分：ladder[n] 是当周计入 n 次时的得分，长度 = weeklyCap + 1，ladder[0] = 0 */
  ladder: number[];
  /** 计分打卡的说明至少几个字（不含空白） */
  captionMin: number;
  /** 每次 Bonus 加几分 */
  bonusPoints: number;
  /** 每个组合每周最多申请几次 Bonus */
  bonusWeeklyMax: number;
  /** 整个赛季 Bonus 最多加几分 */
  bonusSeasonMax: number;
  /** 每周随机抽检的比例（%） */
  auditRate: number;
  /** 获奖组合数（发奖前全部复核） */
  prizePairs: number;
  /** 判无效后多少小时内可以申诉 */
  appealHours: number;
  /** 一个组合累计几次无效打卡后取消本赛季评奖资格 */
  strikeLimit: number;
}

export const DEFAULT_ACTIVITY_CONFIG: ActivityConfig = {
  seasonStart: '2026-11-26',
  seasonEnd: '2027-01-10',
  windowMinutes: 30,
  distanceMeters: 300,
  accuracyMeters: 150,
  weeklyCap: 7,
  // 策划案 2.0 的阶梯分：1 次 1 分 … 7 次 10 分
  ladder: [0, 1, 3, 4, 6, 7, 8, 10],
  captionMin: 5,
  bonusPoints: 2,
  bonusWeeklyMax: 1,
  bonusSeasonMax: 10,
  auditRate: 3,
  prizePairs: 15,
  appealHours: 48,
  strikeLimit: 3,
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

/** YYYY-MM-DD 是星期几（0 = 周日） */
export function weekdayOf(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** 所在周的周一 */
export function mondayOf(date: string): string {
  return addDays(date, -((weekdayOf(date) + 6) % 7));
}

/** 北京时间日期（中国不实行夏令时，固定 UTC+8） */
export function beijingDay(d = new Date()): string {
  return new Date(d.getTime() + 8 * 3600_000).toISOString().slice(0, 10);
}

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
/** 「周四」 */
export const weekdayLabel = (date: string) => WEEKDAYS[weekdayOf(date)];

/** 「11月23日」 */
export function shortDate(date: string): string {
  const [, m, d] = date.split('-').map(Number);
  return `${m}月${d}日`;
}

const int = (v: unknown, min: number, max: number): number | null => {
  const n = Number(v);
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
};

/** 校验后台提交的设置；返回错误文字或规范化后的设置 */
export function validateActivityConfig(input: unknown): { config: ActivityConfig } | { error: string } {
  const src = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const seasonStart = String(src.seasonStart ?? '');
  const seasonEnd = String(src.seasonEnd ?? '');
  if (!DATE_RE.test(seasonStart) || Number.isNaN(Date.parse(seasonStart))) return { error: '请填写赛季开始日期' };
  if (!DATE_RE.test(seasonEnd) || Number.isNaN(Date.parse(seasonEnd)) || weekdayOf(seasonEnd) !== 0) return { error: '赛季结束日期必须是周日' };
  if (seasonEnd <= seasonStart) return { error: '赛季结束日期要晚于开始日期' };
  const windowMinutes = int(src.windowMinutes, 1, 180);
  const distanceMeters = int(src.distanceMeters, 0, 5000);
  const accuracyMeters = int(src.accuracyMeters, 10, 2000);
  const weeklyCap = int(src.weeklyCap, 1, 7);
  const captionMin = int(src.captionMin, 0, 100);
  const bonusPoints = int(src.bonusPoints, 0, 20);
  const bonusWeeklyMax = int(src.bonusWeeklyMax, 0, 7);
  const bonusSeasonMax = int(src.bonusSeasonMax, 0, 100);
  const auditRate = int(src.auditRate, 0, 50);
  const prizePairs = int(src.prizePairs, 0, 200);
  const appealHours = int(src.appealHours, 1, 720);
  const strikeLimit = int(src.strikeLimit, 1, 50);
  if (windowMinutes === null) return { error: '时间窗应为 1–180 分钟' };
  if (distanceMeters === null) return { error: '距离应为 0–5000 米（0 表示不检查距离）' };
  if (accuracyMeters === null) return { error: '定位误差上限应为 10–2000 米' };
  if (weeklyCap === null) return { error: '每周上限应为 1–7 次' };
  if (captionMin === null) return { error: '说明字数下限应为 0–100' };
  if (bonusPoints === null || bonusWeeklyMax === null || bonusSeasonMax === null) return { error: 'Bonus 设置不正确' };
  if (auditRate === null) return { error: '抽检比例应为 0–50%' };
  if (prizePairs === null) return { error: '获奖组合数应为 0–200' };
  if (appealHours === null) return { error: '申诉期限应为 1–720 小时' };
  if (strikeLimit === null) return { error: '无效次数上限应为 1–50' };
  const rawLadder = Array.isArray(src.ladder) ? src.ladder : [];
  if (rawLadder.length !== weeklyCap + 1) return { error: `阶梯分需要填写 0–${weeklyCap} 次各自的分数` };
  const ladder = rawLadder.map((v) => int(v, 0, 100));
  if (ladder.some((v) => v === null)) return { error: '阶梯分应为 0–100 的整数' };
  if (ladder[0] !== 0) return { error: '0 次的得分必须是 0' };
  for (let i = 1; i < ladder.length; i++) if (ladder[i]! < ladder[i - 1]!) return { error: '阶梯分不能随次数增加而减少' };
  return {
    config: {
      seasonStart, seasonEnd, windowMinutes, distanceMeters, accuracyMeters, weeklyCap, ladder: ladder as number[], captionMin,
      bonusPoints, bonusWeeklyMax, bonusSeasonMax, auditRate, prizePairs, appealHours, strikeLimit,
    },
  };
}

/** 说明的有效字数（不含空白） */
export const captionLength = (caption: string) => Array.from(caption.replace(/\s+/gu, '')).length;

// ---------- 打卡照片要求 ----------

export const PHOTO_MUST = [
  { title: '能看到正在学的内容', desc: '打开的书、笔记、试卷，电脑或平板上的学习界面，实验器材等。' },
  { title: '本人的手或手臂入镜', desc: '证明人在现场，例如握笔的手、翻书的手。' },
  { title: '画面清楚', desc: '不黑、不糊，没有大面积遮挡。' },
];

export const PHOTO_INVALID = [
  '只拍了桌面、天花板、风景、食物，或没有学习内容的自拍',
  '翻拍屏幕上或照片里的旧图',
  '屏幕上是游戏、视频等和学习无关的内容',
  '一个人替两个人拍',
];

// ---------- 判无效的理由 ----------

export const INVALID_REASONS = [
  '画面中没有学习内容',
  '画面看不清，无法判断',
  '翻拍或不是现场拍摄',
  '画面与说明不符',
  '疑似代打卡',
] as const;
export const INVALID_OTHER = '其他';

// ---------- Bonus ----------

export const BONUS_MIN_CHARS = 300;
export const BONUS_MIN_CHARS_WITH_IMAGE = 150;

export const BONUS_RULES = [
  '原创、和学习有关：笔记整理、错题总结、学习方法、资料推荐、阶段复盘',
  `正文不少于 ${BONUS_MIN_CHARS} 字，或不少于 ${BONUS_MIN_CHARS_WITH_IMAGE} 字并附至少 1 张自己整理的笔记图`,
  '写明是两人一起完成或讨论的内容',
  '明显照搬网络或 AI 生成的内容不通过',
];

export const BONUS_REJECT_REASONS = [
  '字数或图片不符合要求',
  '与学习无关',
  '内容非原创或照搬',
  '没有体现两人共同完成或讨论',
] as const;

// ---------- 私聊敏感词 ----------

export type SensitiveCategory = 'politics' | 'porn' | 'gore' | 'violence';

export const SENSITIVE_LABELS: Record<SensitiveCategory, string> = {
  politics: '政治敏感',
  porn: '色情',
  gore: '血腥',
  violence: '暴力',
};

/** 这些类别直接拦截；其余类别发送前提醒、对方收到时提示 */
export const BLOCKED_CATEGORIES: SensitiveCategory[] = ['politics'];

export const SENSITIVE_CATEGORIES = Object.keys(SENSITIVE_LABELS) as SensitiveCategory[];
