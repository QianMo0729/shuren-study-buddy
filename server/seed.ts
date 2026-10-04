/**
 * 演示数据：npm run seed          （已存在时跳过）
 *          npm run seed -- --reset （清空后重新生成）
 * 生产环境请勿运行。
 */
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { ALL_MAJORS, gradeFromStudentId } from '../shared/majors.ts';
import { emptyPersonality, emptyProfile } from '../shared/profileRules.ts';
import { INTERESTS, MBTIS, MODES, PERIODS, PERSONALITY_ITEMS, PLACES, SPORTS, TRAITS } from '../shared/options.ts';
import type { Personality, ProfileInput, StudyFormat } from '../shared/types.ts';
import './connections.ts';
import './matches.ts';
import './community.ts';
import { config } from './config.ts';
import { db, q } from './db.ts';
import { generateNickname } from './profiles.ts';

if (config.isProd) throw new Error('生产环境禁止生成演示数据');
const reset = process.argv.includes('--reset');
if (reset) {
  // 先删没有外键关联的子表（评论、点赞按 target_id 关联帖子），再删用户；只清理已存在的表
  const tables = [
    'message_reads', 'messages', 'matches', 'match_feedback', 'preference_models',
    'forum_likes', 'forum_comments', 'forum_posts', 'checkin_sessions', 'checkins',
    'contact_requests', 'exclusions', 'notifications', 'moderation_logs', 'reports', 'contact_views', 'favorites',
    'post_interests', 'posts', 'uploads', 'profiles', 'sessions', 'email_codes', 'users', 'settings',
  ];
  for (const t of tables) {
    if (q.get("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?", t)) db.exec(`DELETE FROM ${t}`);
  }
  db.exec('DELETE FROM sqlite_sequence');
  console.log('🧹 已清空数据库');
} else if (q.get("SELECT 1 FROM users WHERE email IN ('12310000@mail.sustech.edu.cn', 'admin@sustech.edu.cn')")) {
  console.log('演示数据已存在。如需重建请运行：npm run seed -- --reset');
  process.exit(0);
}

let seed = 20260927;
const rand = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
const pick = <T>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)];
const some = <T>(xs: readonly T[], min: number, max: number) => {
  const n = min + Math.floor(rand() * (max - min + 1));
  return [...xs].sort(() => rand() - 0.5).slice(0, n);
};
/** 今天之后第 n 天（YYYY-MM-DD） */
const daysFromNow = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

interface Demo {
  bio: string;
  plan: string;
  /** 近期学习目标（PLAN_PRESETS） */
  goals: string[];
  goalOther?: string;
  subjects: string[];
  /** 目标日期：今天之后第几天 */
  deadline?: number;
  format: StudyFormat;
  /** 学习性格中能从自我介绍看出来的题，其余随机填 2–4 */
  p: Partial<Personality>;
  dislike?: string[];
  frequency?: string;
  duration?: string;
}

const BIOS: Demo[] = [
  { bio: '微电子大二，最近在啃模电和半导体物理。喜欢在一丹图书馆靠窗的位置，一坐就是一下午。希望找一个安静但靠谱的搭子，互相不打扰，但能一起坚持。', plan: '期末模电冲 A，寒假开始准备雅思',
    goals: ['期末复习备考', '语言考试'], subjects: ['模拟电路', '半导体物理', '雅思'], deadline: 95, format: 'offline', p: { talk: 1, noise: 1, punctual: 4, social: 2 }, dislike: ['social'], duration: 'long' },
  { bio: '准备 12 月的雅思，口语是最大短板，想找人每周两次模拟 Part 2。我可以帮你改作文～平时是个话痨，讨论题目停不下来。', plan: '雅思口语 6 → 7，写作稳定 6.5',
    goals: ['语言考试'], subjects: ['雅思', '雅思口语'], deadline: 70, format: 'both', p: { talk: 5, social: 4, giveSupervision: 4 }, dislike: ['silent'], frequency: 'weekly1', duration: 'short' },
  { bio: '数学系大三，打算保研。擅长把复杂的定理讲清楚，也希望通过讲题巩固自己。数分、线代、概率论都可以一起讨论。', plan: '保研夏令营准备 + 实变函数',
    goals: ['期末复习备考', '其他'], goalOther: '保研夏令营准备', subjects: ['数学分析', '线性代数', '概率论', '实变函数'], format: 'offline', p: { talk: 4, plan: 4, giveSupervision: 5 } },
  { bio: '计算机系，LeetCode 刷到第 300 题了。想找人每晚一起刷两道 Hot 100，互相讲思路。夜猫子一枚，23 点之后精神最好。', plan: '暑期实习面试准备',
    goals: ['技能自学', '其他'], goalOther: '暑期实习面试', subjects: ['LeetCode', '算法'], format: 'both', p: { talk: 4, social: 3 }, frequency: 'daily', duration: 'short' },
  { bio: '考研党，目标北大光华。每天 7 点到图书馆，需要一个能互相监督的搭子，早上一起打卡，晚上一起复盘今天的进度。', plan: '考研数学一轮 + 英语真题',
    goals: ['考研'], subjects: ['考研数学', '考研英语'], deadline: 77, format: 'offline', p: { talk: 1, punctual: 5, plan: 5, needSupervision: 5, giveSupervision: 4 }, dislike: ['late'], frequency: 'daily', duration: 'long' },
  { bio: '大一新生，还没决定专业，对生物和计算机都感兴趣。高数有点跟不上，希望找学长学姐或同学一起学，也欢迎约饭聊专业选择～', plan: '高数期中、决定专业方向',
    goals: ['期末复习备考', '日常课程同步学习'], subjects: ['高等数学'], deadline: 40, format: 'offline', p: { talk: 3, social: 5, needSupervision: 4 } },
  { bio: '番茄钟重度用户，25+5 严格执行。喜欢咖啡厅的白噪音，一边喝拿铁一边写报告。希望搭子也守时，不要临时放鸽子。', plan: '课程大作业 + GRE 单词',
    goals: ['日常课程同步学习', '语言考试'], subjects: ['GRE', '课程大作业'], format: 'offline', p: { noise: 4, punctual: 5, plan: 5 }, dislike: ['late'], duration: 'medium' },
  { bio: '金融数学，准备 CFA 一级和托福。学习之外喜欢打羽毛球和跑步，周末可以约球！相信运动和学习一样需要伙伴。', plan: '托福 100+，CFA 一级',
    goals: ['语言考试', '技能自学'], subjects: ['托福', 'CFA 一级'], deadline: 120, format: 'both', p: { talk: 3, social: 5 } },
  { bio: '物理系，喜欢在书院 24h 自习室刷题。比较安静，不太主动聊天，但会认真回答问题。希望找能一起长期学习的搭子。', plan: '电动力学、量子力学期末',
    goals: ['期末复习备考'], subjects: ['电动力学', '量子力学'], deadline: 95, format: 'offline', p: { talk: 1, social: 2, giveSupervision: 3 }, dislike: ['social'] },
  { bio: '生物医学工程，正在进实验室做科研入门。希望找同样在做科研的同学交流文献阅读方法，偶尔互相吐槽实验不顺。', plan: '读完 20 篇文献，学会 Python 数据分析',
    goals: ['科研/竞赛项目', '技能自学'], subjects: ['文献阅读', 'Python'], format: 'both', p: { talk: 4 }, frequency: 'weekly1' },
  { bio: '商学院，准备四六级和实习。喜欢制定计划表，清单打满勾超有成就感。可以分享我的 Notion 模板～', plan: '六级 550+，投递暑期实习',
    goals: ['语言考试', '其他'], goalOther: '暑期实习', subjects: ['六级'], deadline: 70, format: 'both', p: { punctual: 4, plan: 5 } },
  { bio: '参加数模美赛的队伍还缺一个擅长编程的队友！平时也可以一起学 MATLAB/Python，互相讲建模思路。', plan: '美赛 M 奖',
    goals: ['科研/竞赛项目'], subjects: ['数学建模', 'MATLAB', 'Python'], deadline: 120, format: 'both', p: { talk: 5, plan: 4 } },
  { bio: '临床医学，每天都要背很多东西。想找搭子一起用费曼学习法，互相考问，讲给对方听。周末偶尔去爬塘朗山放松。', plan: '系统解剖学期末',
    goals: ['期末复习备考'], subjects: ['系统解剖学'], deadline: 90, format: 'offline', p: { talk: 5, social: 4 }, frequency: 'daily' },
  { bio: '材料系大四，毕业设计 + 申请季同时进行。需要一个能互相监督的搭子，避免拖延。欢迎同样在准备出国申请的同学交流文书。', plan: '毕设 + 出国申请文书',
    goals: ['其他', '语言考试'], goalOther: '毕业设计、出国申请文书', subjects: ['雅思', '申请文书'], deadline: 60, format: 'both', p: { needSupervision: 5, giveSupervision: 4 } },
  { bio: '环境科学与工程，喜欢在户外学习——天气好的时候去湖畔。学习节奏比较慢但稳定，适合长期细水长流型的搭子。', plan: 'GIS 课程项目',
    goals: ['日常课程同步学习'], subjects: ['GIS'], format: 'offline', p: { punctual: 3, plan: 2, noise: 4 }, frequency: 'weekly1', duration: 'long' },
  { bio: '统计学，R 语言和 Python 都比较熟，可以带你入门数据分析。目前在准备统计学考研，想找一起刷题的同学。', plan: '考研 432 统计学',
    goals: ['考研'], subjects: ['统计学 432', '考研数学'], deadline: 77, format: 'offline', p: { giveSupervision: 4, plan: 4 } },
  { bio: '热爱辩论的讨论型选手，学习的时候喜欢把想法说出来。如果你也喜欢边学边聊，我们应该会很合得来。', plan: '思政课论文 + 托福口语',
    goals: ['日常课程同步学习', '语言考试'], subjects: ['托福口语', '思政课论文'], format: 'both', p: { talk: 5, social: 4, noise: 4 }, dislike: ['silent'] },
  { bio: '早八人，晨读爱好者。每天 7:30 在琳恩图书馆门口等开门，想找一个早起的搭子一起背单词。', plan: 'GRE 3000 词一刷',
    goals: ['语言考试'], subjects: ['GRE'], deadline: 150, format: 'offline', p: { punctual: 5, plan: 4 }, frequency: 'daily', duration: 'short' },
  { bio: '航空航天工程，喜欢做模型和 CAD。学习上偏安静，陪伴型。周末喜欢打篮球，欢迎来松禾体育场找我。', plan: '理论力学期末',
    goals: ['期末复习备考'], subjects: ['理论力学'], deadline: 95, format: 'offline', p: { talk: 2, social: 4 } },
  { bio: '智能科学与技术，正在学深度学习，想找人一起读论文、复现代码。可以一起组队打 Kaggle。', plan: 'CS231n 学完 + 一个 Kaggle 比赛',
    goals: ['科研/竞赛项目', '技能自学'], subjects: ['深度学习', 'CS231n', 'Kaggle'], format: 'online', p: { talk: 4 } },
  { bio: '海洋科学，喜欢潜水和游泳。学习时需要安静的环境，不喜欢被频繁打断，但休息时很乐意聊天。', plan: '海洋化学期末',
    goals: ['期末复习备考'], subjects: ['海洋化学'], deadline: 95, format: 'offline', p: { talk: 1, noise: 1, social: 4 }, dislike: ['social'] },
  { bio: '化学系，实验报告写到崩溃……想找搭子一起写报告、互相检查格式。也可以一起复习有机化学。', plan: '有机化学 + 实验报告',
    goals: ['期末复习备考', '日常课程同步学习'], subjects: ['有机化学', '实验报告'], deadline: 90, format: 'offline', p: { talk: 3, giveSupervision: 3 } },
  { bio: '工业设计，经常熬夜做模型。想找一起在咖啡厅画图、互相给反馈的搭子，也欢迎一起看展。', plan: '作品集整理',
    goals: ['其他'], goalOther: '作品集整理', subjects: ['作品集'], format: 'offline', p: { noise: 4, social: 4, plan: 2 }, duration: 'long' },
  { bio: '数据科学与大数据技术，准备考 CPA 会计科目，同时在学 SQL。喜欢按计划推进，每周复盘一次。', plan: 'CPA 会计 + SQL',
    goals: ['技能自学'], subjects: ['CPA 会计', 'SQL'], format: 'both', p: { plan: 5, punctual: 4 }, frequency: 'weekly3' },
  { bio: '光电信息科学与工程，喜欢钻研难题，一道题可以想一晚上。希望搭子也是沉浸型，可以互相陪伴安静学习。', plan: '光学期末 + 竞赛',
    goals: ['期末复习备考', '科研/竞赛项目'], subjects: ['光学', '物理竞赛'], deadline: 95, format: 'offline', p: { talk: 1, noise: 2 }, duration: 'long' },
  { bio: '口腔医学新生，对未来还很好奇。希望找到能一起适应大学学习节奏的朋友，互相督促早睡早起。', plan: '适应大学学习节奏',
    goals: ['日常课程同步学习'], subjects: ['大学化学', '高等数学'], format: 'offline', p: { needSupervision: 4, giveSupervision: 4, social: 4 } },
];

const ARTS = ['钢琴', '摄影', '看展、电影', '吉他弹唱', '合唱', '书法', '手绘', '', '', ''];
const DISLIKES = ['催得太紧', '公开学习内容或成绩', '迟到爽约', '学习时频繁闲聊', '外放声音', '临时放鸽子'];

function randomSchedule() {
  const out = new Set<number>();
  const style = rand();
  for (let d = 0; d < 7; d++) {
    for (let p = 0; p < PERIODS.length; p++) {
      const weekend = d >= 5;
      let prob = 0.12;
      if (style < 0.33 && (p === 6 || p === 7)) prob = 0.75; // 夜猫子
      if (style >= 0.33 && style < 0.66 && (p === 0 || p === 1 || p === 2)) prob = 0.6; // 早起
      if (style >= 0.66 && weekend && p >= 1 && p <= 5) prob = 0.8; // 周末党
      if (p === 8) prob *= 0.3; // 通宵很少
      if (rand() < prob) out.add(d * PERIODS.length + p);
    }
  }
  if (!out.size) out.add(7);
  return [...out].sort((a, b) => a - b);
}

/** 自我介绍里能看出的性格直接采用，其余在 2–4 之间随机，保证每题都有答案 */
function personalityFor(known: Partial<Personality>): Personality {
  const out = emptyPersonality();
  for (const item of PERSONALITY_ITEMS) out[item.key] = known[item.key] ?? 2 + Math.floor(rand() * 3);
  return out;
}

function placesFor(bio: string): string[] {
  const derived = [/图书馆|琳恩|一丹/.test(bio) && 'library', /咖啡/.test(bio) && 'cafe', /自习室|教室/.test(bio) && 'teaching'].filter(Boolean) as string[];
  const extra = some(PLACES.map((p) => p.value).filter((v) => v !== 'any' && !derived.includes(v)), derived.length ? 0 : 1, 2);
  return [...new Set([...derived, ...extra])];
}

function interestsFor(bio: string): string[] {
  const derived = [/羽毛球|跑步|篮球|爬|潜水|游泳|运动/.test(bio) && 'sports', /看展|电影/.test(bio) && 'movies'].filter(Boolean) as string[];
  const extra = some(INTERESTS.map((o) => o.value).filter((v) => v !== 'other' && !derived.includes(v)), derived.length ? 0 : 1, 2);
  return [...new Set([...derived, ...extra])];
}

/** 每位演示同学一个随机的、不会被打印的密码哈希：可以作为推荐候选人，但没有人知道密码 */
const unusablePasswordHash = () => bcrypt.hashSync(crypto.randomBytes(32).toString('base64url'), 10);

// 管理员与空白演示账号：未设置密码，需要用学号 + 邮箱验证码激活
q.run("INSERT INTO users (email, activated, role) VALUES ('12310000@mail.sustech.edu.cn', 1, 'admin')");
// 空白演示账号：用来体验填写 → 保存 → 上传的完整流程
q.run("INSERT INTO users (email, activated) VALUES ('12210001@mail.sustech.edu.cn', 1)");

const majors = ALL_MAJORS.filter((m) => !['其他专业', '暂无 / 未定'].includes(m));
const years = ['23', '24', '25', '22', '24', '25'];

BIOS.forEach((b, i) => {
  const sid = `1${pick(years)}1${String(10 + ((i * 7) % 89)).padStart(2, '0')}${String(10 + i).padStart(2, '0')}`;
  const email = `${sid}@mail.sustech.edu.cn`;
  if (q.get('SELECT 1 FROM users WHERE email = ?', email)) return;
  const id = Number(q.run(
    "INSERT INTO users (email, activated, password_hash, last_login_at) VALUES (?, 1, ?, datetime('now', ?))",
    email, unusablePasswordHash(), `-${Math.floor(rand() * 20)} day`,
  ).lastInsertRowid);
  const gender = rand() < 0.45 ? 'female' : 'male';
  const major = b.bio.includes('微电子') ? '微电子科学与工程'
    : b.bio.includes('数学系') ? '数学与应用数学'
    : b.bio.includes('计算机') ? '计算机科学与技术'
    : b.bio.includes('大一新生') ? '未分专业（大类培养）'
    : b.bio.includes('金融数学') ? '金融数学'
    : b.bio.includes('物理系') ? '物理学'
    : b.bio.includes('生物医学工程') ? '生物医学工程'
    : b.bio.includes('商学院') ? '大数据管理与应用'
    : b.bio.includes('临床') ? '临床医学'
    : b.bio.includes('材料') ? '材料科学与工程'
    : b.bio.includes('环境') ? '环境科学与工程'
    : b.bio.includes('统计学') ? '统计学'
    : b.bio.includes('航空航天') ? '航空航天工程'
    : b.bio.includes('智能科学') ? '智能科学与技术'
    : b.bio.includes('海洋') ? '海洋科学'
    : b.bio.includes('化学系') ? '化学'
    : b.bio.includes('工业设计') ? '工业设计'
    : b.bio.includes('数据科学') ? '数据科学与大数据技术'
    : b.bio.includes('光电') ? '光电信息科学与工程'
    : b.bio.includes('口腔') ? '口腔医学'
    : pick(majors);
  const studyType = /讨论|讲|话痨|辩论|费曼/.test(b.bio) ? 'discuss' : /番茄/.test(b.bio) ? 'flexible' : /计划|清单|打卡|复盘|监督/.test(b.bio) ? 'checkin' : 'quiet';
  const modes = studyType === 'discuss' ? ['discuss', ...(rand() < 0.4 ? ['supervise'] : [])] : studyType === 'checkin' ? ['supervise', ...(rand() < 0.5 ? ['quiet'] : [])] : ['quiet', ...(rand() < 0.3 ? ['supervise'] : [])];
  const places = placesFor(b.bio);
  const data: ProfileInput = {
    ...emptyProfile(),
    realName: `演示同学${i + 1}`,
    studentId: sid,
    gender,
    grade: gradeFromStudentId(sid) || 'y2',
    major,
    buddyGender: pick(['any', 'any', 'any', 'any', gender]),
    schedule: randomSchedule(),
    studyPlan: b.plan,
    planTags: b.goals,
    goalOther: b.goalOther ?? '',
    goalResearch: b.goals.includes('科研/竞赛项目') ? b.plan : '',
    goalSkills: b.goals.includes('技能自学') ? b.plan : '',
    subjects: b.subjects,
    goalDeadline: b.deadline ? daysFromNow(b.deadline) : '',
    studyFormat: b.format,
    personality: personalityFor(b.p),
    mbti: rand() < 0.75 ? pick(MBTIS) : '',
    contacts: { showEmail: true, wechat: rand() < 0.6 ? `sustech_${sid.slice(-4)}` : '', qq: rand() < 0.3 ? `${Math.floor(rand() * 9e8 + 1e8)}` : '', phone: '', other: '' },
    status: pick(['seeking', 'seeking', 'seeking', 'open', 'busy']),
    futurePlan: /保研|考研/.test(b.bio + b.plan) ? 'domestic' : /雅思|托福|GRE|出国|申请/.test(b.bio + b.plan) ? 'abroad' : /实习|CPA|作品集/.test(b.bio + b.plan) ? 'job' : pick(['domestic', 'abroad', 'job']),
    bio: b.bio,
    studyType,
    privacyConsent: { policy: true, contactExchange: true, silentExclusion: true, withdrawal: true },
    studyMethods: some(['summarize', 'practice', 'courses'], 1, 2),
    frequency: b.frequency ?? pick(['weekly3', 'weekly3', 'weekly1', 'irregular']),
    duration: b.duration ?? pick(['medium', 'medium', 'short', 'long']),
    interests: interestsFor(b.bio),
    dislikeTags: b.dislike ?? [],
    modes: modes.filter((m) => MODES.some((x) => x.value === m)),
    places,
    placesOther: /湖畔/.test(b.bio) ? '湖畔' : '',
    traits: some(TRAITS.map((t) => t.value), 1, 3),
    dislikes: some(DISLIKES, 0, 2).join('、'),
    sports: some(SPORTS.map((s) => s.value), 0, 3),
    arts: pick(ARTS),
  };
  const daysAgo = Math.floor(rand() * 20);
  q.run(
    `INSERT INTO profiles (user_id, nickname, data, published, published_at, saved_at, reviewed_at, views)
     VALUES (?, ?, ?, 1, datetime('now', ?), datetime('now', ?), ?, ?)`,
    id, generateNickname(), JSON.stringify(data), `-${daysAgo} day`, `-${daysAgo} day`, rand() < 0.6 ? new Date().toISOString() : null, Math.floor(rand() * 80),
  );
});

const authors = q.all<{ user_id: number }>('SELECT user_id FROM profiles WHERE published = 1').map((r) => r.user_id);
const POSTS = [
  { title: '雅思口语练习 · 每周两次模考', category: 'lang', timeText: '每周二、四晚 19:00', location: '一丹图书馆研讨间', capacity: 4, tags: ['雅思', '口语'], description: '每次 1 小时：抽 Part 2 题卡轮流作答，互相计时、纠音、给反馈。目标 6.5–7 分，希望能坚持到 12 月考试。' },
  { title: '数学分析期中互助小组', category: 'course', timeText: '周六下午 14:00', location: '书院 24h 自习室', capacity: 6, tags: ['数分', '期中'], description: '每人负责讲一章的重点和易错题，讲不明白的地方一起讨论。欢迎大一同学加入！' },
  { title: '考研自习 · 早 7 点打卡', category: 'grad', timeText: '每天早上 7:00', location: '琳恩图书馆', capacity: 5, tags: ['考研', '打卡'], description: '每天固定时间到馆，开始和结束在群里打卡，互相监督，周日晚交流一次进度。' },
  { title: 'LeetCode Hot 100 夜刷', category: 'career', timeText: '工作日晚上 22:00', location: '线上连麦', capacity: 0, tags: ['编程', '刷题', 'leetcode'], description: '每晚两道题，先各自做 30 分钟，然后轮流讲思路。适合准备实习面试的同学。' },
  { title: '周末羽毛球 · 学累了动一动', category: 'sport', timeText: '周日上午 10:00', location: '松禾体育馆', capacity: 8, tags: ['羽毛球'], description: '学习之余一起打球放松，水平不限，开心就好。球拍可以借。' },
  { title: '美赛组队：缺一名编程队友', category: 'contest', timeText: '寒假集训 + 每周一次讨论', location: '荔园', capacity: 1, tags: ['数模', '美赛', '竞赛'], description: '队伍已有建模手和写作手，希望找熟悉 Python/MATLAB 的同学。一起冲 M 奖！' },
  { title: 'GRE 单词晨读小队', category: 'lang', timeText: '每天 7:30–8:00', location: '琳恩图书馆门口', capacity: 5, tags: ['GRE', '背单词', '早起'], description: '每天早起一起背 100 个单词，互相抽查，风雨无阻。' },
  { title: '托福听力精听打卡', category: 'lang', timeText: '每周一、三、五 21:00', location: '线上连麦', capacity: 4, tags: ['托福', '听力'], description: '每次精听一篇 TPO lecture，逐句听写，最后交流笔记方法。' },
  { title: '线性代数期末复习局', category: 'course', timeText: '考前两周每晚', location: '空教室（一教）', capacity: 6, tags: ['线代', '期末'], description: '按章节刷往年题，重点攻克特征值与二次型。可以一起整理错题本。' },
  { title: '文献阅读小组 · 科研入门', category: 'other', timeText: '每周四晚 20:00', location: '书院活动室（二期 15 栋）', capacity: 6, tags: ['科研', '文献'], description: '每周一人分享一篇论文，学习如何快速读文献、做笔记。跨专业欢迎。' },
];
POSTS.forEach((p, i) => {
  const author = authors[i % authors.length];
  const id = Number(
    q.run(
      `INSERT INTO posts (user_id, title, category, description, time_text, location, capacity, tags, created_at, updated_at, reviewed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now', ?), datetime('now', ?), ?)`,
      author, p.title, p.category, p.description, p.timeText, p.location, p.capacity, JSON.stringify(p.tags), `-${i * 9} hour`, `-${i * 9} hour`, i % 3 ? new Date().toISOString() : null,
    ).lastInsertRowid,
  );
  for (const u of some(authors.filter((a) => a !== author), 0, Math.min(5, p.capacity || 5))) {
    q.run('INSERT OR IGNORE INTO post_interests (post_id, user_id) VALUES (?, ?)', id, u);
  }
});

// 社区聊天区：生活分享帖、评论与点赞（不含图片，图片需要真实上传）
const FORUM_POSTS: { title: string; body: string; comments: string[] }[] = [
  { title: '琳恩三楼的晚霞', body: '自习到六点抬头，窗外整片都是橘粉色的晚霞，整层楼的人都在拍照。今天的线代作业也因此没那么痛苦了。', comments: ['三楼靠窗的位置太难抢了！', '同一时间我在一丹，也看到了，确实绝美'] },
  { title: '荔园新窗口小测评', body: '二楼新开的米线窗口试了三次：酸汤的最好吃，番茄的偏甜，麻辣的不算辣。中午 11:40 之前去基本不用排队。', comments: ['酸汤 +1，加一份炸蛋更香', '求问晚上几点关门？'] },
  { title: '湖边又看到白鹭了', body: '早上去跑步，在湖边看到三只白鹭站在浅水里一动不动，像在开组会。原来昵称里的「白鹭」真的在校园里常出没。', comments: ['我的昵称就是白鹭，突然有了归属感'] },
  { title: '期末周宵夜求推荐', body: '每天自习到十点多就开始饿，校内还有哪里能买到热乎的宵夜？最好走路十分钟以内。', comments: ['书院楼下的便利店有关东煮', '外卖记得别在图书馆里吃哈', '欣园那边有一家粥铺开到很晚'] },
  { title: '分享一个番茄钟歌单', body: '自己整理的 25 分钟纯音乐歌单，没有人声，结尾有一段轻微的提示音，正好提醒休息。用了两周专注度明显变好，需要的话评论区说一声。', comments: ['想要！最近总是刷手机分心'] },
  { title: '周末爬塘朗山', body: '上周六从学校出发爬了塘朗山，上山大概一个半小时，山顶能看到整个南山。学了一周脑子发胀，出去走走真的会好很多。', comments: ['下次可以约一起吗？', '记得带水，后半段台阶很多'] },
  { title: '第一次在书院自习室学到凌晨', body: '本来只想把实验报告写完，结果一抬头已经一点了。自习室里还有十几个人，大家都很安静，有种奇妙的并肩作战的感觉。还是要早点睡！', comments: ['同款熬夜人，第二天早八直接睡过头'] },
  { title: '雨天的校园', body: '今天下了一整天雨，从教学楼走回宿舍的路上，路灯照着湿漉漉的台阶，木棉叶子掉了一地。突然觉得在这里读书挺幸运的。', comments: [] },
];
let forumComments = 0;
let forumLikes = 0;
FORUM_POSTS.forEach((p, i) => {
  const author = authors[(i * 5 + 3) % authors.length];
  const hoursAgo = 2 + i * 7;
  const id = Number(q.run(
    `INSERT INTO forum_posts (user_id, title, body, images, created_at, updated_at, reviewed_at)
     VALUES (?, ?, ?, '[]', datetime('now', ?), datetime('now', ?), ?)`,
    author, p.title, p.body, `-${hoursAgo} hour`, `-${hoursAgo} hour`, i % 4 === 3 ? null : new Date().toISOString(),
  ).lastInsertRowid);
  const others = authors.filter((a) => a !== author);
  p.comments.forEach((body, j) => {
    q.run(
      "INSERT INTO forum_comments (target_type, target_id, user_id, body, created_at, reviewed_at) VALUES ('post', ?, ?, ?, datetime('now', ?), ?)",
      id, others[(i * 3 + j * 7) % others.length], body, `-${Math.max(hoursAgo - 1 - j, 0)} hour`, new Date().toISOString(),
    );
    forumComments++;
  });
  for (const u of some(others, 2, 6)) {
    q.run("INSERT OR IGNORE INTO forum_likes (target_type, target_id, user_id) VALUES ('post', ?, ?)", id, u);
    forumLikes++;
  }
});

// 一条待处理的举报，方便体验管理后台
q.run("INSERT INTO reports (reporter_id, target_type, target_id, reason, detail) VALUES (?, 'profile', ?, '广告或营销', '主页里留了代写广告（演示数据）')", authors[1], authors[authors.length - 1]);

console.log(`
✅ 演示数据已生成：${BIOS.length} 位同学、${POSTS.length} 条招募、${FORUM_POSTS.length} 条社区帖子（${forumComments} 条评论、${forumLikes} 个赞）

   管理员学号   12310000
   空白演示学号 12210001   （还没有主页，可体验完整填写流程）
   以上两个账号首次使用请用学号 + 邮箱验证码激活并设置自己的密码；之后用邮箱 + 密码登录。
   演示同学账号各自带有一个随机生成、不会显示的密码（因此会出现在匹配推荐里）；没有统一演示密码。
   如需以演示同学身份登录，请在登录页使用「找回密码」，通过邮箱验证码重设密码。
`);
