import { motion } from 'motion/react';
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { SPECIES } from '../../shared/species';
import { api, type Meta } from '../lib/api';
import { useAuth } from '../lib/auth';
import { cx } from '../lib/format';
import { ease } from '../lib/motion';
import { Button } from '../components/ui';
import { Plate, Stamp, Wordmark } from '../components/brand';
import { CampusPhoto, useCredits } from '../components/credits';

const CN_DIGITS = '〇一二三四五六七八九';
function edition(d = new Date()) {
  const y = String(d.getFullYear()).split('').map((c) => CN_DIGITS[Number(c)]).join('');
  const m = d.getMonth() + 1;
  return `${y}年${m >= 9 || m <= 1 ? '秋' : m >= 2 && m <= 6 ? '春' : '夏'}`;
}

const NOTES = [
  '输入学号验证校园邮箱并设置密码，接着填写搭子问卷。提交后即可查看为你推荐的同学，以后用邮箱和密码登录。',
  '每位同学的昵称，由系统从校园里常见的二十四种动植物中随机选取，后附编号，例如「白鹭 KLM23」。姓名与学号不公开，只有管理员可见。',
  '主页记录希望的学习时间、学习方式、相处方式和常去的地点。打开别人的主页时，你们共同的空闲时段会用朱色标出。',
  '推荐综合双方的共同时间、目标、学习方式、地点、节奏和兴趣，并说明契合与分歧。也可以按自我介绍关键词或高级检索主动寻找同学。',
  '联系同学前需要发起申请，双方确认后才能交换联系方式。照片默认不公开，可以在资料中主动选择展示。',
  '活动大厅用于发起招募，比如「雅思口语练习，每周两次」。感兴趣的同学可以从招募找到发起人的主页。',
  '学发定期查看新发布和修改过的内容。违规的主页或招募会被撤下，当事人会收到写明时间与原因的邮件。',
  '图版取自公有领域的博物学著作，照片取自维基共享资源，出处列在文末。',
];

export function Landing() {
  const { user } = useAuth();
  const nav = useNavigate();
  const [meta, setMeta] = useState<Meta | null>(null);
  const credits = useCredits();

  useEffect(() => {
    api.meta().then(setMeta).catch(() => {});
  }, []);

  const go = () => nav(user ? '/square' : '/login');
  const counts = meta?.breakdown?.species ?? {};
  const published = meta?.stats.profiles ?? 0;
  const kinds = Object.keys(counts).length;

  return (
    <div className="min-h-dvh">
      <header className="mx-auto flex h-16 max-w-[1180px] items-center justify-between px-5 sm:px-8">
        <Link to="/" aria-label="树仁搭子">
          <Wordmark />
        </Link>
        <nav className="flex items-center gap-6 text-[14px]">
          {user && (
            <>
              <Link to="/square" className="hidden text-ink-2 hover:text-ink sm:inline">
                搭子广场
              </Link>
              <Link to="/events" className="hidden text-ink-2 hover:text-ink sm:inline">
                活动大厅
              </Link>
            </>
          )}
          <Button size="sm" variant={user ? 'primary' : 'secondary'} onClick={go}>
            {user ? '进入广场' : '登录'}
          </Button>
        </nav>
      </header>

      {/* 扉页 */}
      <section className="mx-auto max-w-[1180px] px-5 pt-8 sm:px-8 sm:pt-14">
        <div className="flex flex-wrap items-end justify-between gap-x-10 gap-y-3 border-b border-ink pb-5">
          <motion.h1
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, ease }}
            className="font-display text-[clamp(48px,9.5vw,124px)] leading-[0.98] tracking-[-0.03em] text-ink"
          >
            树仁搭子图鉴
          </motion.h1>
          <div className="pb-2 text-[14px] leading-relaxed text-ink-2 sm:text-right">
            <p className="text-[17px] font-bold text-ink">{edition()}</p>
            <p>南方科技大学树仁书院 学生发展中心 编</p>
          </div>
        </div>

        <figure className="mt-6">
          <motion.div
            initial={{ clipPath: 'inset(0 0 100% 0)' }}
            animate={{ clipPath: 'inset(0 0 0% 0)' }}
            transition={{ duration: 1.1, ease, delay: 0.15 }}
          >
            <CampusPhoto file="dusk.jpg" className="aspect-[16/9] w-full sm:aspect-[21/9]" priority />
          </motion.div>
          <CampusCaption file="dusk.jpg" credits={credits} />
        </figure>

        <div className="mt-10 grid gap-x-16 gap-y-6 pb-20 md:grid-cols-[1.1fr_1fr] md:pb-28">
          <p className="font-display text-[clamp(26px,3.3vw,40px)] leading-[1.35] tracking-[-0.02em] text-ink">
            在南科大，找一个
            <br className="hidden sm:inline" />
            和你一起学习的人。
          </p>
          <div>
            <p className="text-[16px] leading-[1.85] text-ink-2">
              这是树仁书院同学的学习搭子广场。激活账号后填写学习问卷，我们会根据双方的时间、目标和学习偏好推荐合拍的同学。你也可以主动检索，或在活动大厅发起一场招募。
            </p>
            <div className="mt-7 flex flex-wrap items-center gap-3">
              <Button variant="primary" size="lg" onClick={go}>
                {user ? '进入搭子广场' : '邮箱与密码登录'}
              </Button>
              <a href="#notes" className="text-[15px] text-ink-2 underline decoration-line-strong underline-offset-4 hover:text-ink hover:decoration-ink">
                先读凡例
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* 本期收录 */}
      <section className="border-t border-line bg-surface">
        <div className="mx-auto max-w-[1180px] px-5 py-16 sm:px-8 sm:py-24">
          <div className="flex flex-wrap items-baseline justify-between gap-x-8 gap-y-2">
            <h2 className="font-display text-[34px] tracking-[-0.02em] text-ink sm:text-[46px]">本期收录</h2>
            <p className="text-[15px] text-ink-2">
              {meta ? (
                published ? (
                  <>
                    广场上现在有 <b className="font-semibold text-ink tabular">{published}</b> 位同学，以 <b className="font-semibold text-ink tabular">{kinds}</b> 种校园动植物为名。
                  </>
                ) : (
                  '广场上还没有人。第一位同学会以其中一种动植物为名。'
                )
              ) : (
                '　'
              )}
            </p>
          </div>
          <ol className="mt-10 grid grid-cols-3 gap-x-4 gap-y-8 sm:grid-cols-4 md:grid-cols-6 lg:gap-x-6">
            {SPECIES.map((s, i) => {
              const n = counts[s.slug] ?? 0;
              return (
                <li key={s.slug} className={cx('min-w-0', !n && meta && 'opacity-55')}>
                  <Plate nickname={s.zh} className="aspect-[4/5] rounded-sm" reveal delay={(i % 6) * 0.07} pad="8%" />
                  <p className="mt-2 flex items-baseline justify-between gap-1.5">
                    <span className="truncate font-display text-[17px] text-ink">{s.zh}</span>
                    <span className="shrink-0 text-[13px] text-ink-3 tabular">{n ? `${n} 位` : '暂无'}</span>
                  </p>
                  <p className="latin truncate text-[12.5px] text-ink-3">{s.latin}</p>
                </li>
              );
            })}
          </ol>
        </div>
      </section>

      {/* 凡例 */}
      <section id="notes" className="scroll-mt-6 border-t border-line">
        <div className="mx-auto grid max-w-[1180px] gap-x-16 gap-y-8 px-5 py-16 sm:px-8 sm:py-24 md:grid-cols-[220px_minmax(0,1fr)]">
          <div className="flex items-start gap-4 md:flex-col">
            <h2 className="font-display text-[34px] tracking-[-0.02em] text-ink sm:text-[46px]">凡例</h2>
            <Stamp text="树仁书院" size={58} white={false} rotate={-4} className="mt-1 md:mt-4" />
          </div>
          <ol className="max-w-[40em] space-y-4 text-[16px] leading-[1.85] text-ink">
            {NOTES.map((n, i) => (
              <li key={i} className="grid grid-cols-[2.4em_minmax(0,1fr)]">
                <span className="font-display text-ink-2">{'一二三四五六七八九十'[i]}、</span>
                <span>{n}</span>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* 尾图 */}
      <section className="mx-auto max-w-[1180px] px-5 sm:px-8">
        <figure>
          <CampusPhoto file="lake-sunset.jpg" className="aspect-[16/9] w-full sm:aspect-[2.4/1]" />
          <CampusCaption file="lake-sunset.jpg" credits={credits} />
        </figure>
        <div className="flex flex-wrap items-center justify-between gap-5 py-12 sm:py-16">
          <p className="font-display text-[26px] tracking-[-0.03em] text-ink sm:text-[32px]">轮到你写自己的那一页了。</p>
          <Button variant="primary" size="lg" onClick={go}>
            {user ? '编辑我的主页' : '登录并填写'}
          </Button>
        </div>
      </section>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-[1180px] flex-col gap-6 px-5 py-10 sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <div className="flex items-center gap-4">
            <img src="/assets/brand/shuren-lockup.png" alt="南方科技大学树仁书院" className="h-10 w-auto dark:hidden" />
            <img src="/assets/brand/shuren-mark-white.png" alt="南方科技大学树仁书院" className="hidden h-10 w-auto opacity-80 dark:block" />
            <p className="text-[15px] leading-relaxed font-bold text-ink-2">
              居高怀仁　止于至善
              <br />
              <span className="font-sans text-[13px] text-ink-3">由树仁书院学生发展中心维护</span>
            </p>
          </div>
          <Link to="/credits" className="text-[14px] text-ink-2 underline decoration-line-strong underline-offset-4 hover:text-ink hover:decoration-ink">
            图版与照片出处
          </Link>
        </div>
      </footer>
    </div>
  );
}

function CampusCaption({ file, credits }: { file: string; credits: ReturnType<typeof useCredits> }) {
  const c = credits.campus.find((x) => x.file === file);
  if (!c) return <figcaption className="mt-2 h-5" />;
  return (
    <figcaption className="mt-2 flex flex-wrap justify-between gap-x-6 gap-y-1 text-[13px] text-ink-3">
      <span className="text-[14px] font-medium text-ink-2">{c.subject}。</span>
      <span>
        摄影 {c.author}，
        <a href={c.sourceUrl} target="_blank" rel="noreferrer" className="underline decoration-line-strong underline-offset-2 hover:text-ink">
          {c.license}
        </a>
      </span>
    </figcaption>
  );
}
