// 前后端共享的选项与字段定义：修改这里即可同时影响表单、卡片、检索与校验。

export type Option = { value: string; label: string; hint?: string };

export const GENDERS: Option[] = [
  { value: 'male', label: '男' },
  { value: 'female', label: '女' },
  { value: 'other', label: '其他' },
];

export const BUDDY_GENDERS: Option[] = [
  { value: 'male', label: '男' },
  { value: 'female', label: '女' },
  { value: 'any', label: '皆可' },
];

export const GRADES: Option[] = [
  { value: 'y1', label: '大一' },
  { value: 'y2', label: '大二' },
  { value: 'y3', label: '大三' },
  { value: 'y4', label: '大四' },
  { value: 'grad', label: '研究生' },
];

/** 学习类型：单选，展示在广场卡片上。glyph 是印章式的单字标记 */
export const STUDY_TYPES: (Option & { glyph: string; desc: string; tone: string })[] = [
  { value: 'quiet', label: '各自安静学，偶尔交流', glyph: '静', desc: '各自专注，需要时交流', tone: '#005C65' },
  { value: 'discuss', label: '边学边讨论，互相讲题', glyph: '辩', desc: '分享思路，一起解决问题', tone: '#2F5A8F' },
  { value: 'checkin', label: '以监督打卡为主', glyph: '序', desc: '互相监督，按计划推进', tone: '#86661C' },
  { value: 'flexible', label: '灵活，视情况而定', glyph: '随', desc: '根据学习任务安排', tone: '#A9501F' },
];

/** 相处方式：多选，至少一项 */
export const MODES: Option[] = [
  { value: 'quiet', label: '安静学习，陪伴为主' },
  { value: 'discuss', label: '热情讨论，教学相长' },
  { value: 'supervise', label: '互相监督，他律为主' },
];

/** 卡片上相处方式的短标签 */
export const MODE_SHORT: Record<string, string> = {
  quiet: '安静陪伴',
  discuss: '热情讨论',
  supervise: '互相监督',
};

export const PLACES: Option[] = [
  { value: 'library', label: '图书馆' },
  { value: 'classroom', label: '空教室' },
  { value: 'youth', label: '青年之家' },
  { value: 'dorm', label: '宿舍' },
  { value: 'teaching', label: '教学楼自习区' },
  { value: 'cafe', label: '校外咖啡厅 / 书店' },
  { value: 'any', label: '不限 / 皆可' },
];

export const STUDY_METHODS: Option[] = [
  { value: 'summarize', label: '整理总结知识点' },
  { value: 'practice', label: '刷题训练' },
  { value: 'courses', label: '看网课' },
  { value: 'flexible', label: '灵活，视情况而定' },
  { value: 'other', label: '其他' },
];
export const FREQUENCIES: Option[] = [
  { value: 'daily', label: '每天' }, { value: 'weekly3', label: '每周 3–5 次' },
  { value: 'weekly1', label: '每周 1–2 次' }, { value: 'irregular', label: '不定期' },
];
export const DURATIONS: Option[] = [
  { value: 'short', label: '1–2 小时' }, { value: 'medium', label: '2–4 小时' },
  { value: 'long', label: '4 小时以上' },
];
export const INTERESTS: Option[] = [
  { value: 'sports', label: '运动健身' }, { value: 'music', label: '音乐' },
  { value: 'reading', label: '阅读' }, { value: 'games', label: '游戏' },
  { value: 'movies', label: '影视' }, { value: 'travel', label: '旅行' },
  { value: 'other', label: '其他' },
];
export const DISLIKE_OPTIONS: Option[] = [
  { value: 'late', label: '频繁迟到 / 爽约' }, { value: 'silent', label: '全程沉默，零交流' },
  { value: 'social', label: '过度社交，影响学习' }, { value: 'food', label: '在图书馆 / 自习室吃东西' },
  { value: 'other', label: '其他' },
];

export const TRAITS: Option[] = [
  { value: 'quiet', label: '安静陪伴' },
  { value: 'active', label: '积极讨论' },
  { value: 'explain', label: '讲解题目深入浅出' },
  { value: 'cheerful', label: '性格开朗' },
  { value: 'calm', label: '性格沉稳' },
  { value: 'punctual', label: '守时靠谱' },
];

export const DISLIKE_PRESETS = ['催得太紧', '公开学习内容或成绩', '迟到爽约', '学习时频繁闲聊', '外放声音', '临时放鸽子'];

export const SPORTS: Option[] = [
  { value: 'basketball', label: '篮球' },
  { value: 'football', label: '足球' },
  { value: 'volleyball', label: '排球' },
  { value: 'badminton', label: '羽毛球' },
  { value: 'pingpong', label: '乒乓球' },
  { value: 'pickleball', label: '匹克球' },
  { value: 'running', label: '跑步' },
  { value: 'swimming', label: '游泳' },
  { value: 'gym', label: '健身' },
  { value: 'tennis', label: '网球' },
  { value: 'frisbee', label: '飞盘' },
  { value: 'hiking', label: '徒步爬山' },
];

export const FUTURE_PLANS: Option[] = [
  { value: 'domestic', label: '国内读研' },
  { value: 'abroad', label: '出国（境）深造' },
  { value: 'job', label: '就业' },
  { value: 'other', label: '其他' },
];

/** 目前状态：决定卡片上的状态灯 */
export const STATUSES: (Option & { color: string })[] = [
  { value: 'seeking', label: '正在找搭子', hint: '欢迎随时来约', color: '#2F9E6B' },
  { value: 'open', label: '已有搭子，仍可再约', hint: '可以多一个伙伴', color: '#D9A23B' },
  { value: 'busy', label: '暂时忙碌', hint: '近期回复可能较慢', color: '#9AA39E' },
];

export const MBTIS = [
  'INTJ', 'INTP', 'ENTJ', 'ENTP',
  'INFJ', 'INFP', 'ENFJ', 'ENFP',
  'ISTJ', 'ISFJ', 'ESTJ', 'ESFJ',
  'ISTP', 'ISFP', 'ESTP', 'ESFP',
];

/** 线上 / 线下：线下与线上互不兼容，「都可以」兼容两者；未填写按「都可以」处理 */
export const STUDY_FORMATS: Option[] = [
  { value: 'offline', label: '线下一起学' },
  { value: 'online', label: '线上连麦 / 共享进度' },
  { value: 'both', label: '都可以' },
];

/**
 * 学习性格：每题 1–5 分（0 = 未回答）。
 * mode = 'similar' 表示双方越接近越合拍；'need' / 'give' 是互补的一对：我需要被监督的程度应由对方愿意监督的程度满足。
 */
export const PERSONALITY_ITEMS: { key: import('./types.ts').PersonalityKey; label: string; low: string; high: string; mode: 'similar' | 'need' | 'give' }[] = [
  { key: 'talk', label: '学习时的交流', low: '几乎不说话', high: '边学边聊', mode: 'similar' },
  { key: 'noise', label: '能接受的环境声音', low: '需要很安静', high: '嘈杂也没关系', mode: 'similar' },
  { key: 'punctual', label: '对守时的要求', low: '时间随意', high: '必须准时', mode: 'similar' },
  { key: 'plan', label: '学习的计划性', low: '随性而为', high: '严格按计划', mode: 'similar' },
  { key: 'social', label: '学习之外一起玩的意愿', low: '只学习', high: '也想一起吃饭运动', mode: 'similar' },
  { key: 'needSupervision', label: '需要被督促的程度', low: '完全自觉', high: '需要有人催', mode: 'need' },
  { key: 'giveSupervision', label: '愿意督促对方的程度', low: '不想管别人', high: '乐意当监督员', mode: 'give' },
];

export const PLAN_PRESETS = ['期末复习备考', '日常课程同步学习', '语言考试', '科研/竞赛项目', '技能自学', '考研', '其他'];

/** 具体科目 / 课程 / 考试的输入建议：按已选的近期目标给出常见写法（自由填写也可以） */
export const SUBJECT_SUGGESTIONS: Record<string, string[]> = {
  期末复习备考: ['高等数学', '线性代数', '概率论与数理统计', '大学物理', '数学分析', '数据结构', '有机化学'],
  日常课程同步学习: ['高等数学', '线性代数', '大学物理', 'C 语言程序设计', '模拟电路', '离散数学'],
  语言考试: ['雅思', '托福', 'GRE', '四六级', '日语 N2'],
  '科研/竞赛项目': ['数学建模', '电子设计竞赛', 'ACM-ICPC', '文献阅读'],
  技能自学: ['Python', '机器学习', 'LeetCode', 'CPA', 'SQL'],
  考研: ['考研数学一', '考研英语一', '考研政治', '408 计算机'],
};
export const SUBJECT_LIMIT = 8;

/** 推荐契合度档位（rules-v2：score ≥ 80 很合拍，≥ 65 较合拍，其余可以聊聊） */
export const RECOMMENDATION_TIERS: Record<'great' | 'good' | 'fair', { label: string; min: number }> = {
  great: { label: '很合拍', min: 80 },
  good: { label: '较合拍', min: 65 },
  fair: { label: '可以聊聊', min: 0 },
};

export const BIO_PROMPTS = ['我最近在忙…', '我学习时的小习惯是…', '理想的搭子是…', '和我一起学习你会收获…'];

/** 学习时间表：7 天 × 9 个时段。通宵指当日 00–08 点。 */
export const DAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
export const PERIODS: { label: string; time: string; hours: number }[] = [
  { label: '上午 ①', time: '08–10', hours: 2 },
  { label: '上午 ②', time: '10–12', hours: 2 },
  { label: '午间', time: '12–14', hours: 2 },
  { label: '下午 ①', time: '14–16', hours: 2 },
  { label: '下午 ②', time: '16–18', hours: 2 },
  { label: '晚上 ①', time: '18–20', hours: 2 },
  { label: '晚上 ②', time: '20–22', hours: 2 },
  { label: '晚上 ③', time: '22–24', hours: 2 },
  { label: '通宵', time: '00–08', hours: 8 },
];
export const SLOT_COUNT = DAYS.length * PERIODS.length;
export const slotIndex = (day: number, period: number) => day * PERIODS.length + period;
export const slotDay = (slot: number) => Math.floor(slot / PERIODS.length);
export const slotPeriod = (slot: number) => slot % PERIODS.length;
export const slotsHours = (slots: number[]) => slots.reduce((h, s) => h + (PERIODS[slotPeriod(s)]?.hours ?? 0), 0);
export const overlapSlots = (a: number[], b: number[]) => {
  const set = new Set(b);
  return a.filter((s) => set.has(s)).sort((x, y) => x - y);
};

/** 活动大厅分类 */
export const POST_CATEGORIES: (Option & { glyph: string; tone: string })[] = [
  { value: 'lang', label: '语言考试', glyph: '语', tone: '#2F5A8F' },
  { value: 'grad', label: '考研保研', glyph: '研', tone: '#005C65' },
  { value: 'course', label: '课程互助', glyph: '课', tone: '#5E4A8C' },
  { value: 'contest', label: '竞赛科研', glyph: '赛', tone: '#A9501F' },
  { value: 'career', label: '实习求职', glyph: '职', tone: '#86661C' },
  { value: 'sport', label: '运动健身', glyph: '动', tone: '#2C7A6A' },
  { value: 'other', label: '其他', glyph: '杂', tone: '#5D6660' },
];

export const REPORT_REASONS = ['信息虚假或冒充他人', '不当言论或骚扰', '广告或营销', '涉及违规内容', '其他'];
export const TAKEDOWN_REASONS = ['信息不实或冒用身份', '包含不当 / 冒犯性内容', '广告、营销或与学习无关', '泄露他人隐私', '多次被举报核实'];

/** 检索同义词，扩展关键词检索的召回 */
export const SYNONYMS: string[][] = [
  ['雅思', 'ielts'],
  ['托福', 'toefl'],
  ['gre', 'GRE'],
  ['四六级', '四级', '六级', 'cet', 'cet4', 'cet6'],
  ['考研', '读研', '研究生', '保研', '推免'],
  ['出国', '留学', '外申', '申请', '深造'],
  ['口语', 'speaking', '口语练习'],
  ['数分', '数学分析'],
  ['线代', '线性代数'],
  ['高数', '高等数学', '微积分', 'calculus'],
  ['概率论', '概统', '概率统计'],
  ['编程', '刷题', 'leetcode', '算法', 'coding'],
  ['图书馆', '琳恩', '一丹', 'library'],
  ['咖啡', '咖啡厅', 'cafe'],
  ['夜猫子', '晚上', '深夜', '熬夜'],
  ['早起', '晨读', '早上', '早八'],
  ['健身', '撸铁', 'gym'],
  ['羽毛球', '羽球'],
  ['乒乓球', '乒乓'],
  ['求职', '实习', '找工作', '就业'],
  ['竞赛', '比赛', '数模', '建模'],
  ['大物', '大学物理'],
  ['模电', '模拟电路', '模拟电子技术'],
  ['数电', '数字电路', '数字电子技术'],
  ['计组', '计算机组成原理'],
  ['离散', '离散数学'],
  ['数据结构', '数据结构与算法'],
];

export const optionLabel = (list: Option[], value: string | null | undefined) =>
  list.find((o) => o.value === value)?.label ?? '';
