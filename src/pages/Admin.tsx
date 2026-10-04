import { AnimatePresence, motion } from 'motion/react';
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import {
  AlertTriangle, CalendarClock, Check, CheckCheck, ExternalLink, FileText, Flag, Minus, Plus, RotateCcw, Search, ShieldX, UserRound,
} from 'lucide-react';
import {
  api, ApiError, type AdminLog, type AdminOverview, type AdminPost, type AdminProfile, type AdminReport, type AdminUser,
} from '../lib/api';
import { cx, dateTime, fullDateTime, timeAgo } from '../lib/format';
import { ease, spring } from '../lib/motion';
import { useToast } from '../lib/toast';
import { Button, PageHeader, Segmented, Skeleton } from '../components/ui';
import { Cover } from '../components/ProfileCard';
import { CategoryTag } from '../components/PostCard';
import { TakedownDialog } from '../components/moderation';

const TABS = [
  { id: 'overview', label: '概览' },
  { id: 'profiles', label: '主页审核' },
  { id: 'posts', label: '帖子审核' },
  { id: 'reports', label: '举报处理' },
  { id: 'logs', label: '撤下记录' },
  { id: 'users', label: '用户' },
];

const FILTERS = [
  { value: 'pending', label: '待审核' },
  { value: 'reported', label: '被举报' },
  { value: 'down', label: '已撤下' },
  { value: 'all', label: '全部' },
];

type Target = { type: 'profile' | 'post'; id: number; label: string };

export function Admin() {
  const [tab, setTab] = useState('overview');
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const loadOverview = useCallback(() => api.admin.overview().then(setOverview).catch(() => {}), []);
  useEffect(() => {
    loadOverview();
  }, [loadOverview, tab]);

  return (
    <div className="pt-2">
      <PageHeader title="管理后台" desc="树仁学发内部使用。定期查看新发布的主页和招募；撤下违规内容后，系统会自动给当事人发邮件。" />

      <div className="-mx-4 flex gap-6 overflow-x-auto border-b border-line px-4 no-scrollbar sm:mx-0 sm:px-0" role="tablist">
        {TABS.map((t) => {
          const on = t.id === tab;
          const badge = t.id === 'profiles' ? overview?.stats.pendingProfiles : t.id === 'posts' ? overview?.stats.pendingPosts : t.id === 'reports' ? overview?.stats.openReports : 0;
          return (
            <button key={t.id} role="tab" aria-selected={on} onClick={() => setTab(t.id)} className={cx('relative flex shrink-0 items-center gap-1.5 py-2.5 text-[14.5px] transition-colors', on ? 'font-semibold text-ink' : 'text-ink-3 hover:text-ink')}>
              {t.label}
              {!!badge && <span className="rounded-full bg-accent px-1.5 text-[11px] font-semibold text-white tabular">{badge}</span>}
              {on && <motion.span layoutId="admin-tab" transition={spring} className="absolute inset-x-0 -bottom-px h-[2px] bg-ink" />}
            </button>
          );
        })}
      </div>

      <div className="mt-5">
        <AnimatePresence mode="wait">
          <motion.div key={tab} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15, ease }}>
            {tab === 'overview' && <Overview data={overview} reload={loadOverview} go={setTab} />}
            {tab === 'profiles' && <ProfilesReview onChange={loadOverview} />}
            {tab === 'posts' && <PostsReview onChange={loadOverview} />}
            {tab === 'reports' && <Reports onChange={loadOverview} />}
            {tab === 'logs' && <Logs />}
            {tab === 'users' && <UsersTab />}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

// ---------------- 概览 ----------------

function Overview({ data, reload, go }: { data: AdminOverview | null; reload: () => void; go: (t: string) => void }) {
  const toast = useToast();
  const [days, setDays] = useState<number | null>(null);
  if (!data) return <Skeleton className="h-72 rounded-xl" />;
  const s = data.stats;
  const r = data.review;
  const cycle = days ?? r.cycleDays;
  const tiles = [
    { label: '已激活用户', value: s.users },
    { label: '广场展示中的主页', value: s.published },
    { label: '招募中的帖子', value: s.posts },
    { label: '近 30 天撤下', value: s.takedowns30d },
  ];
  const todo = [
    { label: '待审核主页', value: s.pendingProfiles, tab: 'profiles', icon: UserRound },
    { label: '待审核帖子', value: s.pendingPosts, tab: 'posts', icon: FileText },
    { label: '待处理举报', value: s.openReports, tab: 'reports', icon: Flag },
  ];
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {tiles.map((t) => (
          <div key={t.label} className="rounded-xl bg-surface p-5">
            <p className="text-[13px] text-ink-3">{t.label}</p>
            <p className="mt-2 text-[30px] leading-none font-semibold text-ink">{t.value.toLocaleString('zh-CN')}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-5 lg:grid-cols-[1.2fr_1fr]">
        <div className="rounded-xl bg-surface p-6">
          <p className="text-[15px] font-semibold text-ink">待办</p>
          <div className="mt-4 space-y-2">
            {todo.map((t) => (
              <button key={t.label} onClick={() => go(t.tab)} className="flex w-full items-center gap-3 rounded-2xl bg-paper-2/60 px-4 py-3 text-left transition-colors hover:bg-paper-2">
                <t.icon size={17} className="text-ink-3" />
                <span className="flex-1 text-[14px] text-ink-2">{t.label}</span>
                {t.value > 0 ? (
                  <span className="inline-flex items-center gap-1 text-[14px] font-semibold text-ink">
                    <AlertTriangle size={14} className="text-accent" /> {t.value}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-[13px] text-ink-3">
                    <Check size={14} className="text-brand-3" /> 已清空
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        <div className="rounded-xl bg-surface p-6">
          <p className="flex items-center gap-2 text-[15px] font-semibold text-ink">
            <CalendarClock size={17} /> 周期巡查
          </p>
          <p className="mt-1 text-[12.5px] leading-relaxed text-ink-3">按参与人数设定巡查周期；新发布或修改过的内容会进入「待审核」，巡查时逐条通过或撤下。</p>
          <div className="mt-5 flex items-center gap-3">
            <span className="text-[13.5px] text-ink-2">每</span>
            <div className="flex items-center rounded-full border border-line-strong/70">
              <button onClick={() => setDays(Math.max(1, cycle - 1))} className="grid size-8 place-items-center rounded-full text-ink-3 hover:text-ink" aria-label="减少">
                <Minus size={13} />
              </button>
              <span className="w-8 text-center text-[15px] font-semibold text-ink">{cycle}</span>
              <button onClick={() => setDays(Math.min(90, cycle + 1))} className="grid size-8 place-items-center rounded-full text-ink-3 hover:text-ink" aria-label="增加">
                <Plus size={13} />
              </button>
            </div>
            <span className="text-[13.5px] text-ink-2">天巡查一次</span>
            {days !== null && days !== r.cycleDays && (
              <Button
                size="sm"
                variant="soft"
                onClick={async () => {
                  await api.admin.settings(cycle);
                  setDays(null);
                  reload();
                  toast.success('巡查周期已更新');
                }}
              >
                保存
              </Button>
            )}
          </div>
          <dl className="mt-5 grid grid-cols-2 gap-3 text-[13px]">
            <div className="rounded-2xl bg-paper-2/60 px-4 py-3">
              <dt className="text-ink-3">上次巡查</dt>
              <dd className="mt-1 font-medium text-ink">{r.lastReviewAt ? dateTime(r.lastReviewAt) : '尚未开始'}</dd>
            </div>
            <div className={cx('rounded-2xl px-4 py-3', r.overdue ? 'bg-accent-soft' : 'bg-paper-2/60')}>
              <dt className="flex items-center gap-1 text-ink-3">
                下次巡查 {r.overdue && <AlertTriangle size={12} className="text-accent" />}
              </dt>
              <dd className="mt-1 font-medium text-ink">
                {r.nextReviewAt ? dateTime(r.nextReviewAt) : '—'}
                {r.overdue && <span className="ml-1 text-[12px] text-accent">已到期</span>}
              </dd>
            </div>
          </dl>
          <Button
            className="mt-4 w-full"
            variant="dark"
            icon={<CheckCheck size={16} />}
            onClick={async () => {
              await api.admin.reviewRound();
              reload();
              toast.success('已记录本轮巡查', '请前往「主页审核」「帖子审核」处理待审核内容');
              go('profiles');
            }}
          >
            开始本轮巡查
          </Button>
        </div>
      </div>
    </div>
  );
}

// ---------------- 通用 ----------------

function Toolbar({ filter, setFilter, q, setQ, extra }: { filter: string; setFilter: (v: string) => void; q: string; setQ: (v: string) => void; extra?: React.ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-3">
      <Segmented options={FILTERS} value={filter} onChange={setFilter} />
      <div className="flex h-10 min-w-56 flex-1 items-center rounded-lg border border-line-strong bg-surface px-3 sm:max-w-xs">
        <Search size={15} className="text-ink-3" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="昵称 / 姓名 / 学号 / 邮箱 / 内容" className="h-full flex-1 bg-transparent px-2 text-[13.5px] outline-none" />
      </div>
      {extra}
    </div>
  );
}

function StatusPill({ takenDown, reviewedAt, reports }: { takenDown: boolean; reviewedAt: string | null; reports: number }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {takenDown ? (
        <span className="inline-flex items-center gap-1 rounded-full bg-danger-soft px-2 py-0.5 text-[11.5px] font-medium text-danger">
          <ShieldX size={11} /> 已撤下
        </span>
      ) : reviewedAt ? (
        <span className="inline-flex items-center gap-1 rounded-full bg-brand-soft px-2 py-0.5 text-[11.5px] font-medium text-brand-text">
          <Check size={11} /> 已审核
        </span>
      ) : (
        <span className="inline-flex items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 text-[11.5px] font-medium text-accent">
          <AlertTriangle size={11} /> 待审核
        </span>
      )}
      {reports > 0 && (
        <span className="inline-flex items-center gap-1 rounded-full bg-danger-soft px-2 py-0.5 text-[11.5px] font-medium text-danger">
          <Flag size={11} /> 举报 {reports}
        </span>
      )}
    </span>
  );
}

function useList<T>(fetcher: (filter: string, q: string) => Promise<{ items: T[] }>) {
  const [filter, setFilter] = useState('pending');
  const [q, setQ] = useState('');
  const [items, setItems] = useState<T[] | null>(null);
  const load = useCallback(() => fetcher(filter, q).then((r) => setItems(r.items)), [fetcher, filter, q]);
  useEffect(() => {
    const t = setTimeout(load, q ? 250 : 0);
    return () => clearTimeout(t);
  }, [load, q]);
  return { filter, setFilter, q, setQ, items, load };
}

function Empty({ text }: { text: string }) {
  return (
    <div className="flex flex-col items-center rounded-xl border border-dashed border-line-strong py-16 text-center">
      <span className="grid size-12 place-items-center rounded-full bg-brand-soft text-brand-text">
        <Check size={20} />
      </span>
      <p className="mt-3 text-[14px] text-ink-2">{text}</p>
    </div>
  );
}

// ---------------- 主页审核 ----------------

const fetchProfiles = (f: string, q: string) => api.admin.profiles(f, q);

function ProfilesReview({ onChange }: { onChange: () => void }) {
  const toast = useToast();
  const { filter, setFilter, q, setQ, items, load } = useList<AdminProfile>(fetchProfiles);
  const [target, setTarget] = useState<Target | null>(null);
  const refresh = () => (load(), onChange());
  const pending = items?.filter((i) => !i.takenDown && !i.reviewedAt) ?? [];

  return (
    <div>
      <Toolbar
        filter={filter}
        setFilter={setFilter}
        q={q}
        setQ={setQ}
        extra={
          pending.length > 1 && (
            <Button
              size="sm"
              variant="soft"
              icon={<CheckCheck size={14} />}
              onClick={async () => {
                await api.admin.approve('profile', pending.map((p) => p.id));
                toast.success(`已通过 ${pending.length} 个主页`);
                refresh();
              }}
            >
              全部通过（{pending.length}）
            </Button>
          )
        }
      />
      {!items ? (
        <Skeleton className="h-64 rounded-xl" />
      ) : !items.length ? (
        <Empty text={filter === 'pending' ? '没有待审核的主页，辛苦了' : '没有记录'} />
      ) : (
        <div className="space-y-3">
          <AnimatePresence initial={false}>
            {items.map((p) => (
              <motion.div key={p.id} layout exit={{ opacity: 0 }} className="flex flex-col gap-4 rounded-xl bg-surface p-4 sm:flex-row sm:items-start">
                <div className="size-16 shrink-0 overflow-hidden rounded-2xl">
                  <Cover id={p.id} nickname={p.nickname} cover={p.cover} studyType="" className="h-full w-full" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[15px] font-semibold text-ink">{p.nickname}</span>
                    <StatusPill takenDown={p.takenDown} reviewedAt={p.reviewedAt} reports={p.reports} />
                  </div>
                  <p className="mt-1 text-[12.5px] text-ink-3">
                    {p.realName || '—'} · {p.studentId || '—'} · {p.email} · {p.major || '未填专业'}
                  </p>
                  {(p.bio || p.studyPlan) && <p className="mt-2 line-clamp-2 text-[13px] leading-relaxed text-ink-2">{p.bio || p.studyPlan}</p>}
                  {p.photos.length > 0 && (
                    <div className="mt-2.5 flex gap-1.5">
                      {p.photos.map((ph) => (
                        <a key={ph} href={`/api/files/${ph}`} target="_blank" rel="noreferrer" className="size-11 overflow-hidden rounded-md border border-line">
                          <img src={`/api/files/${ph}`} alt="" className="h-full w-full object-cover" />
                        </a>
                      ))}
                    </div>
                  )}
                  <p className="mt-2 text-[11.5px] text-ink-4">
                    上线 {timeAgo(p.publishedAt)} · 最近保存 {dateTime(p.savedAt)}
                    {p.takenDown && ` · 撤下于 ${dateTime(p.takenDownAt)}（${p.takedownReason}）`}
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap gap-1.5 sm:flex-col sm:items-stretch">
                  <Link to={`/u/${p.id}`} target="_blank" className="inline-flex h-8 items-center justify-center gap-1 rounded-md border border-line-strong px-3 text-[13px] text-ink-2 hover:border-ink-4">
                    <ExternalLink size={13} /> 查看
                  </Link>
                  {p.takenDown ? (
                    <Button
                      size="sm"
                      icon={<RotateCcw size={13} />}
                      onClick={async () => {
                        await api.admin.restore('profile', p.id);
                        toast.success('已恢复展示');
                        refresh();
                      }}
                    >
                      恢复
                    </Button>
                  ) : (
                    <>
                      {!p.reviewedAt && (
                        <Button
                          size="sm"
                          variant="soft"
                          icon={<Check size={13} />}
                          onClick={async () => {
                            await api.admin.approve('profile', [p.id]);
                            refresh();
                          }}
                        >
                          通过
                        </Button>
                      )}
                      <Button size="sm" variant="danger" icon={<ShieldX size={13} />} onClick={() => setTarget({ type: 'profile', id: p.id, label: p.nickname })}>
                        撤下
                      </Button>
                    </>
                  )}
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}
      {target && <TakedownDialog open onClose={() => setTarget(null)} type={target.type} id={target.id} label={target.label} onDone={refresh} />}
    </div>
  );
}

// ---------------- 帖子审核 ----------------

const fetchPosts = (f: string, q: string) => api.admin.posts(f, q);

function PostsReview({ onChange }: { onChange: () => void }) {
  const toast = useToast();
  const { filter, setFilter, q, setQ, items, load } = useList<AdminPost>(fetchPosts);
  const [target, setTarget] = useState<Target | null>(null);
  const refresh = () => (load(), onChange());
  const pending = items?.filter((i) => !i.takenDown && !i.reviewedAt) ?? [];
  return (
    <div>
      <Toolbar
        filter={filter}
        setFilter={setFilter}
        q={q}
        setQ={setQ}
        extra={
          pending.length > 1 && (
            <Button
              size="sm"
              variant="soft"
              icon={<CheckCheck size={14} />}
              onClick={async () => {
                await api.admin.approve('post', pending.map((p) => p.id));
                toast.success(`已通过 ${pending.length} 个帖子`);
                refresh();
              }}
            >
              全部通过（{pending.length}）
            </Button>
          )
        }
      />
      {!items ? (
        <Skeleton className="h-64 rounded-xl" />
      ) : !items.length ? (
        <Empty text={filter === 'pending' ? '没有待审核的帖子' : '没有记录'} />
      ) : (
        <div className="space-y-3">
          <AnimatePresence initial={false}>
            {items.map((p) => (
              <motion.div key={p.id} layout exit={{ opacity: 0 }} className="flex flex-col gap-3 rounded-xl bg-surface p-5 sm:flex-row sm:items-start">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <CategoryTag value={p.category} />
                    <StatusPill takenDown={p.takenDown} reviewedAt={p.reviewedAt} reports={p.reports} />
                  </div>
                  <p className="mt-2.5 text-[16px] font-semibold text-ink">{p.title}</p>
                  <p className="mt-1 line-clamp-2 text-[13px] leading-relaxed text-ink-2">{p.description}</p>
                  <p className="mt-2 text-[11.5px] text-ink-4">
                    {p.nickname} · {p.email} · {timeAgo(p.createdAt)}发布 · {p.timeText} · {p.location}
                    {p.takenDown && ` · 撤下于 ${dateTime(p.takenDownAt)}（${p.takedownReason}）`}
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap gap-1.5 sm:flex-col sm:items-stretch">
                  <Link to={`/events/${p.id}`} target="_blank" className="inline-flex h-8 items-center justify-center gap-1 rounded-md border border-line-strong px-3 text-[13px] text-ink-2 hover:border-ink-4">
                    <ExternalLink size={13} /> 查看
                  </Link>
                  {p.takenDown ? (
                    <Button size="sm" icon={<RotateCcw size={13} />} onClick={async () => { await api.admin.restore('post', p.id); toast.success('已恢复展示'); refresh(); }}>
                      恢复
                    </Button>
                  ) : (
                    <>
                      {!p.reviewedAt && (
                        <Button size="sm" variant="soft" icon={<Check size={13} />} onClick={async () => { await api.admin.approve('post', [p.id]); refresh(); }}>
                          通过
                        </Button>
                      )}
                      <Button size="sm" variant="danger" icon={<ShieldX size={13} />} onClick={() => setTarget({ type: 'post', id: p.id, label: p.title })}>
                        撤下
                      </Button>
                    </>
                  )}
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}
      {target && <TakedownDialog open onClose={() => setTarget(null)} type={target.type} id={target.id} label={target.label} onDone={refresh} />}
    </div>
  );
}

// ---------------- 举报 ----------------

function Reports({ onChange }: { onChange: () => void }) {
  const toast = useToast();
  const [status, setStatus] = useState('open');
  const [items, setItems] = useState<AdminReport[] | null>(null);
  const [target, setTarget] = useState<Target | null>(null);
  const load = useCallback(() => api.admin.reports(status).then((r) => setItems(r.items)), [status]);
  useEffect(() => {
    load();
  }, [load]);
  const refresh = () => (load(), onChange());
  return (
    <div>
      <div className="mb-4">
        <Segmented options={[{ value: 'open', label: '待处理' }, { value: 'all', label: '全部' }]} value={status} onChange={setStatus} />
      </div>
      {!items ? (
        <Skeleton className="h-64 rounded-xl" />
      ) : !items.length ? (
        <Empty text="没有待处理的举报" />
      ) : (
        <div className="space-y-3">
          {items.map((r) => (
            <div key={r.id} className="flex flex-col gap-3 rounded-xl bg-surface p-5 sm:flex-row sm:items-center">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-danger-soft px-2 py-0.5 text-[11.5px] font-medium text-danger">{r.reason}</span>
                  <span className="text-[12px] text-ink-3">{r.targetType === 'profile' ? '主页' : '帖子'}</span>
                  <Link to={r.targetType === 'profile' ? `/u/${r.targetId}` : `/events/${r.targetId}`} target="_blank" className="text-[14px] font-semibold text-ink hover:underline">
                    {r.targetLabel}
                  </Link>
                  {r.status !== 'open' && <span className="rounded-full bg-paper-2 px-2 py-0.5 text-[11px] text-ink-3">{r.status === 'resolved' ? '已撤下' : '已驳回'}</span>}
                </div>
                {r.detail && <p className="mt-1.5 text-[13px] text-ink-2">“{r.detail}”</p>}
                <p className="mt-1.5 text-[11.5px] text-ink-4">
                  举报人 {r.reporter} · {fullDateTime(r.createdAt)}
                </p>
              </div>
              {r.status === 'open' && (
                <div className="flex gap-1.5">
                  <Button size="sm" variant="ghost" onClick={async () => { await api.admin.dismissReport(r.id); toast.success('已驳回'); refresh(); }}>
                    驳回
                  </Button>
                  <Button size="sm" variant="danger" icon={<ShieldX size={13} />} onClick={() => setTarget({ type: r.targetType, id: r.targetId, label: r.targetLabel })}>
                    撤下对象
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {target && <TakedownDialog open onClose={() => setTarget(null)} type={target.type} id={target.id} label={target.label} onDone={refresh} />}
    </div>
  );
}

// ---------------- 撤下记录 ----------------

function Logs() {
  const [items, setItems] = useState<AdminLog[] | null>(null);
  useEffect(() => {
    api.admin.logs().then((r) => setItems(r.items));
  }, []);
  if (!items) return <Skeleton className="h-64 rounded-xl" />;
  if (!items.length) return <Empty text="还没有撤下 / 恢复记录" />;
  const mail = { sent: '已发送', logged: '已记录（未配置 SMTP）', failed: '发送失败', '': '—' } as Record<string, string>;
  return (
    <div className="overflow-x-auto rounded-xl bg-surface">
      <table className="w-full min-w-[760px] text-left text-[13px]">
        <thead className="border-b border-line text-[12px] text-ink-3">
          <tr>
            {['时间', '操作', '对象', '原因', '邮件通知', '操作人'].map((h) => (
              <th key={h} className="px-4 py-3 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {items.map((l) => (
            <tr key={l.id} className="border-b border-line last:border-0">
              <td className="tabular px-4 py-3 whitespace-nowrap text-ink-2">{fullDateTime(l.createdAt)}</td>
              <td className="px-4 py-3">
                <span className={cx('rounded-full px-2 py-0.5 text-[11.5px] font-medium', l.action === 'takedown' ? 'bg-danger-soft text-danger' : 'bg-brand-soft text-brand-text')}>{l.action === 'takedown' ? '撤下' : '恢复'}</span>
              </td>
              <td className="px-4 py-3 text-ink">
                <span className="text-ink-3">{l.targetType === 'profile' ? '主页 ' : '帖子 '}</span>
                {l.targetLabel}
              </td>
              <td className="max-w-56 px-4 py-3 text-ink-2">{l.reason || '—'}</td>
              <td className="px-4 py-3 whitespace-nowrap text-ink-3">{mail[l.emailStatus] ?? l.emailStatus}</td>
              <td className="px-4 py-3 text-ink-3">{l.admin}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------- 用户 ----------------

function UsersTab() {
  const [q, setQ] = useState('');
  const [items, setItems] = useState<AdminUser[] | null>(null);
  const toast = useToast();
  useEffect(() => {
    const t = setTimeout(() => api.admin.users(q).then((r) => setItems(r.items)).catch((e) => toast.error('加载失败', e instanceof ApiError ? e.message : undefined)), q ? 250 : 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);
  return (
    <div>
      <div className="mb-4 flex h-10 max-w-sm items-center rounded-lg border border-line-strong bg-surface px-3">
        <Search size={15} className="text-ink-3" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="邮箱 / 昵称 / 姓名 / 学号" className="h-full flex-1 bg-transparent px-2 text-[13.5px] outline-none" />
      </div>
      {!items ? (
        <Skeleton className="h-64 rounded-xl" />
      ) : (
        <div className="overflow-x-auto rounded-xl bg-surface">
          <table className="w-full min-w-[820px] text-left text-[13px]">
            <thead className="border-b border-line text-[12px] text-ink-3">
              <tr>
                {['邮箱', '昵称', '姓名', '学号', '专业', '状态', '最近登录'].map((h) => (
                  <th key={h} className="px-4 py-3 font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map((u) => (
                <tr key={u.id} className="border-b border-line last:border-0">
                  <td className="px-4 py-3 text-ink">
                    {u.email}
                    {u.role === 'admin' && <span className="ml-1.5 rounded-full bg-ink px-1.5 py-px text-[10.5px] text-paper">管理员</span>}
                  </td>
                  <td className="px-4 py-3 text-ink-2">{u.nickname || '—'}</td>
                  <td className="px-4 py-3 text-ink-2">{u.realName || '—'}</td>
                  <td className="tabular px-4 py-3 text-ink-2">{u.studentId || '—'}</td>
                  <td className="px-4 py-3 text-ink-2">{u.major || '—'}</td>
                  <td className="px-4 py-3">{u.published ? <span className="text-brand-text">广场展示中</span> : <span className="text-ink-3">未上传</span>}</td>
                  <td className="px-4 py-3 whitespace-nowrap text-ink-3">{timeAgo(u.lastLoginAt) || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
