/**
 * 演示数据：npm run seed          （已存在时跳过）
 *          npm run seed -- --reset （清空后重新生成）
 * 生产环境请勿运行。
 */
import { ALL_MAJORS, gradeFromStudentId } from '../shared/majors.ts';
import { emptyProfile, pickProfileInput } from '../shared/profileRules.ts';
import { MBTIS, MODES, PERIODS, PLACES, SPORTS, TRAITS } from '../shared/options.ts';
import type { ProfileInput } from '../shared/types.ts';
import './connections.ts';
import { config } from './config.ts';
import { db, q } from './db.ts';
import { generateNickname } from './profiles.ts';

if (config.isProd) throw new Error('生产环境禁止生成演示数据');
const reset = process.argv.includes('--reset');
if (reset) {
  for (const t of ['contact_requests', 'exclusions', 'notifications', 'moderation_logs', 'reports', 'contact_views', 'favorites', 'post_interests', 'posts', 'uploads', 'profiles', 'sessions', 'email_codes', 'users', 'settings']) {
    db.exec(`DELETE FROM ${t}`);
  }
  db.exec("DELETE FROM sqlite_sequence");
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

const BIOS = [
  { bio: '微电子大二，最近在啃模电和半导体物理。喜欢在一丹图书馆靠窗的位置，一坐就是一下午。希望找一个安静但靠谱的搭子，互相不打扰，但能一起坚持。', plan: '期末模电冲 A，寒假开始准备雅思', tags: ['期末复习', '雅思'] },
  { bio: '准备 12 月的雅思，口语是最大短板，想找人每周两次模拟 Part 2。我可以帮你改作文～平时是个话痨，讨论题目停不下来。', plan: '雅思口语 6 → 7，写作稳定 6.5', tags: ['雅思'] },
  { bio: '数学系大三，打算保研。擅长把复杂的定理讲清楚，也希望通过讲题巩固自己。数分、线代、概率论都可以一起讨论。', plan: '保研夏令营准备 + 实变函数', tags: ['保研', '期末复习'] },
  { bio: '计算机系，LeetCode 刷到第 300 题了。想找人每晚一起刷两道 Hot 100，互相讲思路。夜猫子一枚，23 点之后精神最好。', plan: '暑期实习面试准备', tags: ['编程刷题', '实习求职'] },
  { bio: '考研党，目标北大光华。每天 7 点到图书馆，需要一个能互相监督的搭子，早上一起打卡，晚上一起复盘今天的进度。', plan: '考研数学一轮 + 英语真题', tags: ['考研'] },
  { bio: '大一新生，还没决定专业，对生物和计算机都感兴趣。高数有点跟不上，希望找学长学姐或同学一起学，也欢迎约饭聊专业选择～', plan: '高数期中、决定专业方向', tags: ['期末复习'] },
  { bio: '番茄钟重度用户，25+5 严格执行。喜欢咖啡厅的白噪音，一边喝拿铁一边写报告。希望搭子也守时，不要临时放鸽子。', plan: '课程大作业 + GRE 单词', tags: ['GRE'] },
  { bio: '金融数学，准备 CFA 一级和托福。学习之外喜欢打羽毛球和跑步，周末可以约球！相信运动和学习一样需要伙伴。', plan: '托福 100+，CFA 一级', tags: ['托福'] },
  { bio: '物理系，喜欢在书院 24h 自习室刷题。比较安静，不太主动聊天，但会认真回答问题。希望找能一起长期学习的搭子。', plan: '电动力学、量子力学期末', tags: ['期末复习'] },
  { bio: '生物医学工程，正在进实验室做科研入门。希望找同样在做科研的同学交流文献阅读方法，偶尔互相吐槽实验不顺。', plan: '读完 20 篇文献，学会 Python 数据分析', tags: ['科研入门'] },
  { bio: '商学院，准备四六级和实习。喜欢制定计划表，清单打满勾超有成就感。可以分享我的 Notion 模板～', plan: '六级 550+，投递暑期实习', tags: ['四六级', '实习求职'] },
  { bio: '参加数模美赛的队伍还缺一个擅长编程的队友！平时也可以一起学 MATLAB/Python，互相讲建模思路。', plan: '美赛 M 奖', tags: ['学科竞赛'] },
  { bio: '临床医学，每天都要背很多东西。想找搭子一起用费曼学习法，互相考问，讲给对方听。周末偶尔去爬塘朗山放松。', plan: '系统解剖学期末', tags: ['期末复习'] },
  { bio: '材料系大四，毕业设计 + 申请季同时进行。需要一个能互相监督的搭子，避免拖延。欢迎同样在准备出国申请的同学交流文书。', plan: '毕设 + 出国申请文书', tags: ['雅思'] },
  { bio: '环境科学与工程，喜欢在户外学习——天气好的时候去湖畔。学习节奏比较慢但稳定，适合长期细水长流型的搭子。', plan: 'GIS 课程项目', tags: ['期末复习'] },
  { bio: '统计学，R 语言和 Python 都比较熟，可以带你入门数据分析。目前在准备统计学考研，想找一起刷题的同学。', plan: '考研 432 统计学', tags: ['考研'] },
  { bio: '热爱辩论的讨论型选手，学习的时候喜欢把想法说出来。如果你也喜欢边学边聊，我们应该会很合得来。', plan: '思政课论文 + 托福口语', tags: ['托福'] },
  { bio: '早八人，晨读爱好者。每天 7:30 在琳恩图书馆门口等开门，想找一个早起的搭子一起背单词。', plan: 'GRE 3000 词一刷', tags: ['GRE'] },
  { bio: '航空航天工程，喜欢做模型和 CAD。学习上偏安静，陪伴型。周末喜欢打篮球，欢迎来松禾体育场找我。', plan: '理论力学期末', tags: ['期末复习'] },
  { bio: '智能科学与技术，正在学深度学习，想找人一起读论文、复现代码。可以一起组队打 Kaggle。', plan: 'CS231n 学完 + 一个 Kaggle 比赛', tags: ['科研入门', '编程刷题'] },
  { bio: '海洋科学，喜欢潜水和游泳。学习时需要安静的环境，不喜欢被频繁打断，但休息时很乐意聊天。', plan: '海洋化学期末', tags: ['期末复习'] },
  { bio: '化学系，实验报告写到崩溃……想找搭子一起写报告、互相检查格式。也可以一起复习有机化学。', plan: '有机化学 + 实验报告', tags: ['期末复习'] },
  { bio: '工业设计，经常熬夜做模型。想找一起在咖啡厅画图、互相给反馈的搭子，也欢迎一起看展。', plan: '作品集整理', tags: ['实习求职'] },
  { bio: '数据科学与大数据技术，准备考 CPA 会计科目，同时在学 SQL。喜欢按计划推进，每周复盘一次。', plan: 'CPA 会计 + SQL', tags: ['CPA'] },
  { bio: '光电信息科学与工程，喜欢钻研难题，一道题可以想一晚上。希望搭子也是沉浸型，可以互相陪伴安静学习。', plan: '光学期末 + 竞赛', tags: ['学科竞赛'] },
  { bio: '口腔医学新生，对未来还很好奇。希望找到能一起适应大学学习节奏的朋友，互相督促早睡早起。', plan: '适应大学学习节奏', tags: ['期末复习'] },
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
      if (style < 0.33 && (p === 7 || p === 8)) prob = 0.75; // 夜猫子
      if (style >= 0.33 && style < 0.66 && (p === 1 || p === 2 || p === 0)) prob = 0.6; // 早起
      if (style >= 0.66 && weekend && p >= 1 && p <= 5) prob = 0.8; // 周末党
      if (p === 9) prob *= 0.3;
      if (rand() < prob) out.add(d * PERIODS.length + p);
    }
  }
  if (!out.size) out.add(7);
  return [...out].sort((a, b) => a - b);
}

// 管理员
q.run("INSERT INTO users (email, activated, role) VALUES ('12310000@mail.sustech.edu.cn', 1, 'admin')");
// 空白演示账号：用来体验填写 → 保存 → 上传的完整流程
q.run("INSERT INTO users (email, activated) VALUES ('12210001@mail.sustech.edu.cn', 1)");

const majors = ALL_MAJORS.filter((m) => !['其他专业', '暂无 / 未定'].includes(m));
const years = ['23', '24', '25', '22', '24', '25'];

BIOS.forEach((b, i) => {
  const sid = `1${pick(years)}1${String(10 + ((i * 7) % 89)).padStart(2, '0')}${String(10 + i).padStart(2, '0')}`;
  const email = `${sid}@mail.sustech.edu.cn`;
  if (q.get('SELECT 1 FROM users WHERE email = ?', email)) return;
  const id = Number(q.run('INSERT INTO users (email, activated) VALUES (?, 1)', email).lastInsertRowid);
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
  const studyType = /讨论|讲|话痨|辩论|费曼/.test(b.bio) ? 'talk' : /番茄/.test(b.bio) ? 'pomodoro' : /计划|清单|打卡|复盘/.test(b.bio) ? 'plan' : 'deep';
  const modes = studyType === 'talk' ? ['discuss', ...(rand() < 0.4 ? ['supervise'] : [])] : studyType === 'plan' ? ['supervise', ...(rand() < 0.5 ? ['quiet'] : [])] : ['quiet', ...(rand() < 0.3 ? ['supervise'] : [])];
  const data: ProfileInput = {
    ...emptyProfile(),
    realName: `演示同学${i + 1}`,
    studentId: sid,
    gender,
    grade: gradeFromStudentId(sid) || 'y2',
    major,
    buddyGender: pick(['any', 'any', 'any', gender]),
    schedule: randomSchedule(),
    studyPlan: b.plan,
    planTags: pickProfileInput({ planTags: b.tags }).planTags,
    mbti: rand() < 0.75 ? pick(MBTIS) : '',
    contacts: { showEmail: true, wechat: rand() < 0.6 ? `sustech_${sid.slice(-4)}` : '', qq: rand() < 0.3 ? `${Math.floor(rand() * 9e8 + 1e8)}` : '', phone: '', other: '' },
    status: pick(['seeking', 'seeking', 'seeking', 'open', 'busy']),
    futurePlan: /保研|考研/.test(b.bio + b.plan) ? 'domestic' : /雅思|托福|GRE|出国|申请/.test(b.bio + b.plan) ? 'abroad' : /实习|CPA|作品集/.test(b.bio + b.plan) ? 'job' : pick(['domestic', 'abroad', 'job']),
    bio: b.bio,
    studyType: ({ deep: 'quiet', talk: 'discuss', pomodoro: 'flexible', plan: 'checkin' } as Record<string,string>)[studyType],
    privacyConsent: { policy: true, contactExchange: true, silentExclusion: true, withdrawal: true },
    studyMethods: ['practice'], frequency: 'weekly3', duration: 'medium',
    interests: ['sports', 'reading'],
    modes: modes.filter((m) => MODES.some((x) => x.value === m)),
    places: some(PLACES.map((p) => p.value), 1, 3),
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

// 一条待处理的举报，方便体验管理后台
q.run("INSERT INTO reports (reporter_id, target_type, target_id, reason, detail) VALUES (?, 'profile', ?, '广告或营销', '主页里留了代写广告（演示数据）')", authors[1], authors[authors.length - 1]);

console.log(`
✅ 演示数据已生成：${BIOS.length} 位同学、${POSTS.length} 条招募

   管理员学号   12310000
   空白演示学号 12210001   （还没有主页，可体验完整填写流程）
   演示账号首次使用请用学号 + 邮箱验证码激活并设置自己的密码；之后用邮箱 + 密码登录。
`);
