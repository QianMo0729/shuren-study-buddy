import { AnimatePresence, motion } from 'motion/react';
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import {
  AlertTriangle, CalendarClock, Check, CheckCheck, ExternalLink, FileText, Flag, MessagesSquare, Minus, Plus, RotateCcw, Search, ShieldX, UserRound,
} from 'lucide-react';
import type { ModerationTargetType, ReportTargetType } from '../../shared/types';
import {
  api, ApiError, fileUrl, type AdminContent, type AdminContentType, type AdminLog, type AdminOverview, type AdminPost, type AdminProfile,
  type AdminReport, type AdminUser,
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
  { id: 'posts', label: '招募审核' },
  { id: 'community', label: '社区内容' },
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

/** 各类对象在后台中的称呼 */
const TYPE_TEXT: Record<ReportTargetType, string> = {
  profile: '主页', post: '招募', forum_post: '社区帖子', comment: '评论', checkin: '打卡', message: '私聊消息',
};

const isModeration = (t: ReportTargetType): t is ModerationTargetType => t !== 'message';

type Target = { type: ModerationTargetType; id: number; label: string };

const errorText = (e: unknown) => (e instanceof ApiError ? e.message : '请稍后重试');

export function Admin() {
  const [tab, setTab] = useState('overview');
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const loadOverview = useCallback(() => api.admin.overview().then(setOverview).catch(() => {}), []);
  useEffect(() => {
    loadOverview();
  }, [loadOverview, tab]);

  return (
    <div className="pt-2">
      <PageHeader title="管理后台" desc="树仁学发内部使用。定期查看新发布的主页、招募和社区内容；撤下违规内容后，系统会自动给当事人发站内通知和邮件。" />

      <div className="-mx-4 flex gap-6 overflow-x-auto border-b border-line px-4 no-scrollbar sm:mx-0 sm:px-0" role="tablist">
        {TABS.map((t) => {
          const on = t.id === tab;
          const badge =
            t.id === 'profiles' ? overview?.stats.pendingProfiles
            : t.id === 'posts' ? overview?.stats.pendingPosts
            : t.id === 'community' ? overview?.stats.pendingCommunity
            : t.id === 'reports' ? overview?.stats.openReports
            : 0;
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
            {tab === 'community' && <CommunityReview pending={overview?.pendingContent} onChange={loadOverview} />}
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
    { label: '已发布的主页', value: s.published },
    { label: '招募中', value: s.posts },
    { label: '社区帖子', value: s.forumPosts },
    { label: '今日打卡', value: s.checkinsToday },
    { label: '近 30 天撤下', value: s.takedowns30d },
  ];
  const todo = [
    { label: '待审核主页', value: s.pendingProfiles, tab: 'profiles', icon: UserRound },
    { label: '待审核招募', value: s.pendingPosts, tab: 'posts', icon: FileText },
    { label: '待审核社区内容', value: s.pendingCommunity, tab: 'community', icon: MessagesSquare },
    { label: '待处理举报', value: s.openReports, tab: 'reports', icon: Flag },
  ];
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
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
          <p className="mt-1 text-[12.5px] leading-relaxed text-ink-3">内容默认直接公开，只有系统判定为极高风险的内容会暂缓公开并进入「待审核」。巡查时可复核这些内容或处理举报。</p>
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
              toast.success('已记录本轮巡查', '请前往「主页审核」「招募审核」「社区内容」处理待审核内容');
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

function Toolbar({ filter, setFilter, q, setQ, extra, placeholder }: { filter: string; setFilter: (v: string) => void; q: string; setQ: (v: string) => void; extra?: React.ReactNode; placeholder?: string }) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-3">
      <Segmented options={FILTERS} value={filter} onChange={setFilter} />
      <div className="flex h-10 min-w-56 flex-1 items-center rounded-lg border border-line-strong bg-surface px-3 sm:max-w-xs">
        <Search size={15} className="text-ink-3" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder ?? '昵称 / 姓名 / 学号 / 邮箱 / 内容'} aria-label="搜索" maxLength={100} className="h-full flex-1 bg-transparent px-2 text-[13.5px] outline-none" />
      </div>
      {extra}
    </div>
  );
}

function StatusPill({ takenDown, reviewPending, reports }: { takenDown: boolean; reviewPending: boolean; reports: number }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {reviewPending ? (
        <span className="inline-flex items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 text-[11.5px] font-medium text-accent">
          <AlertTriangle size={11} /> 待审核 · 暂未公开
        </span>
      ) : takenDown ? (
        <span className="inline-flex items-center gap-1 rounded-full bg-danger-soft px-2 py-0.5 text-[11.5px] font-medium text-danger">
          <ShieldX size={11} /> 已撤下
        </span>
      ) : (
        <span className="inline-flex items-center gap-1 rounded-full bg-brand-soft px-2 py-0.5 text-[11.5px] font-medium text-brand-text">
          <Check size={11} /> 已公开
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

function ReviewReasons({ reasons, pending }: { reasons: string[]; pending: boolean }) {
  if (!pending) return null;
  return <span className="basis-full text-[12.5px] leading-relaxed text-accent">自动暂存原因：{reasons.length ? reasons.join('；') : '极高风险内容，等待人工复核'}</span>;
}

function useList<T>(fetcher: (filter: string, q: string) => Promise<{ items: T[] }>) {
  const toast = useToast();
  const [filter, setFilter] = useState('pending');
  const [q, setQ] = useState('');
  const [items, setItems] = useState<T[] | null>(null);
  const load = useCallback(
    () => fetcher(filter, q).then((r) => setItems(r.items)).catch((e) => toast.error('加载失败', errorText(e))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fetcher, filter, q],
  );
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
  const pending = items?.filter((i) => i.reviewPending) ?? [];

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
                    <StatusPill takenDown={p.takenDown} reviewPending={p.reviewPending} reports={p.reports} />
                    <ReviewReasons reasons={p.reviewReasons} pending={p.reviewPending} />
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
                    {p.reviewPending ? '提交' : '上线'} {timeAgo(p.publishedAt)} · 最近保存 {dateTime(p.savedAt)}
                    {p.takenDown && !p.reviewPending && ` · 撤下于 ${dateTime(p.takenDownAt)}（${p.takedownReason}）`}
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap gap-1.5 sm:flex-col sm:items-stretch">
                  <Link to={`/u/${p.id}`} target="_blank" className="inline-flex h-8 items-center justify-center gap-1 rounded-md border border-line-strong px-3 text-[13px] text-ink-2 hover:border-ink-4">
                    <ExternalLink size={13} /> 查看
                  </Link>
                  {p.takenDown && !p.reviewPending ? (
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
                      {p.reviewPending && (
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
  const pending = items?.filter((i) => i.reviewPending) ?? [];
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
                toast.success(`已通过 ${pending.length} 个招募`);
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
        <Empty text={filter === 'pending' ? '没有待审核的招募' : '没有记录'} />
      ) : (
        <div className="space-y-3">
          <AnimatePresence initial={false}>
            {items.map((p) => (
              <motion.div key={p.id} layout exit={{ opacity: 0 }} className="flex flex-col gap-3 rounded-xl bg-surface p-5 sm:flex-row sm:items-start">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <CategoryTag value={p.category} />
                    <StatusPill takenDown={p.takenDown} reviewPending={p.reviewPending} reports={p.reports} />
                    <ReviewReasons reasons={p.reviewReasons} pending={p.reviewPending} />
                  </div>
                  <p className="mt-2.5 text-[16px] font-semibold text-ink">{p.title}</p>
                  <p className="mt-1 line-clamp-2 text-[13px] leading-relaxed text-ink-2">{p.description}</p>
                  <p className="mt-2 text-[11.5px] text-ink-4">
                    {p.nickname} · {p.email} · {timeAgo(p.createdAt)}发布 · {p.timeText} · {p.location}
                    {p.takenDown && !p.reviewPending && ` · 撤下于 ${dateTime(p.takenDownAt)}（${p.takedownReason}）`}
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap gap-1.5 sm:flex-col sm:items-stretch">
                  <Link to={`/events/${p.id}`} target="_blank" className="inline-flex h-8 items-center justify-center gap-1 rounded-md border border-line-strong px-3 text-[13px] text-ink-2 hover:border-ink-4">
                    <ExternalLink size={13} /> 查看
                  </Link>
                  {p.takenDown && !p.reviewPending ? (
                    <Button size="sm" icon={<RotateCcw size={13} />} onClick={async () => { await api.admin.restore('post', p.id); toast.success('已恢复展示'); refresh(); }}>
                      恢复
                    </Button>
                  ) : (
                    <>
                      {p.reviewPending && (
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

// ---------------- 社区内容 ----------------

const CONTENT_TYPES: { value: AdminContentType; label: string }[] = [
  { value: 'forum_post', label: '帖子' },
  { value: 'comment', label: '评论' },
  { value: 'checkin', label: '打卡' },
];

function CommunityReview({ pending, onChange }: { pending?: Record<AdminContentType, number>; onChange: () => void }) {
  const toast = useToast();
  const [type, setType] = useState<AdminContentType>('forum_post');
  const [filter, setFilter] = useState('pending');
  const [q, setQ] = useState('');
  const [items, setItems] = useState<AdminContent[] | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [target, setTarget] = useState<Target | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(
    () =>
      api.admin
        .content(type, filter, q)
        .then((r) => {
          setItems(r.items);
          // 列表刷新后只保留仍待审核的勾选项
          setSelected((s) => new Set(r.items.filter((i) => s.has(i.id) && i.reviewPending).map((i) => i.id)));
        })
        .catch((e) => toast.error('加载失败', errorText(e))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [type, filter, q],
  );
  useEffect(() => {
    const t = setTimeout(load, q ? 250 : 0);
    return () => clearTimeout(t);
  }, [load, q]);

  const switchType = (v: string) => {
    setType(v as AdminContentType);
    setItems(null);
    setSelected(new Set());
  };
  const refresh = () => (load(), onChange());
  const pendingItems = items?.filter((i) => i.reviewPending) ?? [];
  const typeLabel = CONTENT_TYPES.find((t) => t.value === type)!.label;

  const approve = async (ids: number[]) => {
    if (!ids.length) return;
    setBusy(true);
    try {
      await api.admin.approve(type, ids);
      toast.success(ids.length > 1 ? `已通过 ${ids.length} 条${typeLabel}` : '已通过');
      setSelected(new Set());
      refresh();
    } catch (e) {
      toast.error('操作失败', errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const restore = async (item: AdminContent) => {
    try {
      await api.admin.restore(item.type, item.id);
      toast.success('已恢复展示');
      refresh();
    } catch (e) {
      toast.error('操作失败', errorText(e));
    }
  };
  const toggle = (id: number) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div>
      <div className="mb-3 overflow-x-auto no-scrollbar">
        <Segmented
          options={CONTENT_TYPES.map((t) => ({ value: t.value, label: pending?.[t.value] ? `${t.label} · ${pending[t.value]}` : t.label }))}
          value={type}
          onChange={switchType}
        />
      </div>
      <Toolbar
        filter={filter}
        setFilter={(v) => (setFilter(v), setItems(null), setSelected(new Set()))}
        q={q}
        setQ={setQ}
        placeholder="昵称 / 邮箱 / 正文"
        extra={
          selected.size > 0 ? (
            <div className="flex items-center gap-1.5">
              <Button size="sm" variant="soft" icon={<CheckCheck size={14} />} loading={busy} onClick={() => approve([...selected])}>
                通过所选（{selected.size}）
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
                取消选择
              </Button>
            </div>
          ) : (
            pendingItems.length > 1 && (
              <Button size="sm" variant="soft" icon={<CheckCheck size={14} />} loading={busy} onClick={() => approve(pendingItems.map((i) => i.id))}>
                全部通过（{pendingItems.length}）
              </Button>
            )
          )
        }
      />
      {!items ? (
        <Skeleton className="h-64 rounded-xl" />
      ) : !items.length ? (
        <Empty text={filter === 'pending' ? `没有待审核的${typeLabel}` : '没有记录'} />
      ) : (
        <div className="space-y-3">
          <AnimatePresence initial={false}>
            {items.map((c) => {
              const isPending = c.reviewPending;
              const label = c.title || c.body.slice(0, 30) || typeLabel;
              return (
                <motion.div key={`${c.type}-${c.id}`} layout exit={{ opacity: 0 }} className="flex gap-3 rounded-xl bg-surface p-4 sm:p-5">
                  {isPending ? (
                    <input
                      type="checkbox"
                      className="mt-1 size-4 shrink-0 accent-brand"
                      checked={selected.has(c.id)}
                      onChange={() => toggle(c.id)}
                      aria-label={`选择「${label}」`}
                    />
                  ) : (
                    <span className="w-4 shrink-0" aria-hidden />
                  )}
                  <div className="flex min-w-0 flex-1 flex-col gap-3 sm:flex-row sm:items-start">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <StatusPill takenDown={c.takenDown} reviewPending={c.reviewPending} reports={c.reports} />
                        <ReviewReasons reasons={c.reviewReasons} pending={c.reviewPending} />
                        {c.title && <span className={cx('min-w-0 truncate', c.type === 'forum_post' ? 'text-[15px] font-semibold text-ink' : 'text-[12.5px] text-ink-3')}>{c.title}</span>}
                      </div>
                      {c.body ? (
                        <p className="mt-2 line-clamp-4 text-[13.5px] leading-relaxed whitespace-pre-line text-ink-2">{c.body}</p>
                      ) : (
                        <p className="mt-2 text-[13px] text-ink-4">（没有文字说明）</p>
                      )}
                      {c.images.length > 0 && (
                        <div className="mt-2.5 flex flex-wrap gap-1.5">
                          {c.images.map((img, i) => (
                            <a
                              key={img}
                              href={fileUrl(img)}
                              target="_blank"
                              rel="noreferrer"
                              className={cx('overflow-hidden rounded-md border border-line bg-paper-2', c.type === 'checkin' ? 'size-24' : 'size-14')}
                              aria-label={`查看第 ${i + 1} 张图片原图`}
                            >
                              <img src={fileUrl(img)} alt="" loading="lazy" className="h-full w-full object-cover" />
                            </a>
                          ))}
                        </div>
                      )}
                      <p className="mt-2 text-[11.5px] text-ink-4">
                        {c.nickname || '—'} · {c.email} · {timeAgo(c.createdAt)}发布
                        {c.takenDown && !c.reviewPending && ` · 撤下于 ${dateTime(c.takenDownAt)}（${c.takedownReason}）`}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-1.5 sm:flex-col sm:items-stretch">
                      {c.link && (
                        <Link to={c.link} target="_blank" className="inline-flex h-8 items-center justify-center gap-1 rounded-md border border-line-strong px-3 text-[13px] text-ink-2 hover:border-ink-4">
                          <ExternalLink size={13} /> {c.type === 'comment' ? '查看原帖' : '查看'}
                        </Link>
                      )}
                      {c.takenDown && !c.reviewPending ? (
                        <Button size="sm" icon={<RotateCcw size={13} />} onClick={() => restore(c)}>
                          恢复
                        </Button>
                      ) : (
                        <>
                          {isPending && (
                            <Button size="sm" variant="soft" icon={<Check size={13} />} disabled={busy} onClick={() => approve([c.id])}>
                              通过
                            </Button>
                          )}
                          <Button size="sm" variant="danger" icon={<ShieldX size={13} />} onClick={() => setTarget({ type: c.type, id: c.id, label })}>
                            撤下
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      )}
      {target && <TakedownDialog open onClose={() => setTarget(null)} type={target.type} id={target.id} label={target.label} onDone={refresh} />}
    </div>
  );
}

// ---------------- 举报 ----------------

const STATE_TEXT = { down: '对象已撤下', deleted: '对象已删除' } as const;

function Reports({ onChange }: { onChange: () => void }) {
  const toast = useToast();
  const [status, setStatus] = useState('open');
  const [items, setItems] = useState<AdminReport[] | null>(null);
  const [target, setTarget] = useState<Target | null>(null);
  const load = useCallback(
    () => api.admin.reports(status).then((r) => setItems(r.items)).catch((e) => toast.error('加载失败', errorText(e))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [status],
  );
  useEffect(() => {
    load();
  }, [load]);
  const refresh = () => (load(), onChange());
  const close = async (r: AdminReport, how: 'dismiss' | 'resolve') => {
    try {
      await (how === 'dismiss' ? api.admin.dismissReport(r.id) : api.admin.resolveReport(r.id));
      toast.success(how === 'dismiss' ? '已驳回' : '已标记为已处理');
      refresh();
    } catch (e) {
      toast.error('操作失败', errorText(e));
    }
  };
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
          {items.map((r) => {
            const canTakedown = isModeration(r.targetType) && r.targetState === 'visible';
            return (
              <div key={r.id} className="flex flex-col gap-3 rounded-xl bg-surface p-5 sm:flex-row sm:items-start">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-danger-soft px-2 py-0.5 text-[11.5px] font-medium text-danger">{r.reason}</span>
                    <span className="text-[12px] text-ink-3">{TYPE_TEXT[r.targetType] ?? r.targetType}</span>
                    {r.link ? (
                      <Link to={r.link} target="_blank" className="min-w-0 truncate text-[14px] font-semibold text-ink hover:underline">
                        {r.targetLabel}
                      </Link>
                    ) : (
                      <span className="min-w-0 truncate text-[14px] font-semibold text-ink">{r.targetLabel}</span>
                    )}
                    {r.targetState !== 'visible' && <span className="rounded-full bg-paper-2 px-2 py-0.5 text-[11px] text-ink-3">{STATE_TEXT[r.targetState]}</span>}
                    {r.status !== 'open' && <span className="rounded-full bg-paper-2 px-2 py-0.5 text-[11px] text-ink-3">{r.status === 'resolved' ? '已处理' : '已驳回'}</span>}
                  </div>
                  {r.snapshot !== null && (
                    <figure className="mt-2.5 rounded-lg border border-line bg-paper-2/60 px-3.5 py-2.5">
                      <figcaption className="text-[11.5px] text-ink-3">举报时留存的内容原文</figcaption>
                      <blockquote className="mt-1 max-h-40 overflow-y-auto text-[13.5px] leading-relaxed break-words whitespace-pre-wrap text-ink">{r.snapshot || '（空）'}</blockquote>
                    </figure>
                  )}
                  {r.note && <p className="mt-1.5 text-[13px] break-words whitespace-pre-wrap text-ink-2">举报人补充：“{r.note}”</p>}
                  <p className="mt-1.5 text-[11.5px] text-ink-4">
                    {r.owner && (
                      <>
                        被举报人 {r.owner.nickname}
                        {r.owner.email && ` · ${r.owner.email}`} ·{' '}
                      </>
                    )}
                    举报人 {r.reporter} · {fullDateTime(r.createdAt)}
                  </p>
                </div>
                {r.status === 'open' && (
                  <div className="flex shrink-0 flex-wrap gap-1.5">
                    <Button size="sm" variant="ghost" onClick={() => close(r, 'dismiss')}>
                      驳回
                    </Button>
                    {canTakedown ? (
                      <Button size="sm" variant="danger" icon={<ShieldX size={13} />} onClick={() => isModeration(r.targetType) && setTarget({ type: r.targetType, id: r.targetId, label: r.targetLabel })}>
                        撤下对象
                      </Button>
                    ) : (
                      <Button size="sm" variant="soft" icon={<Check size={13} />} onClick={() => close(r, 'resolve')}>
                        标记已处理
                      </Button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
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
  const mail = { sent: '已发送', logged: '已记录（未配置邮件服务）', failed: '发送失败', skipped: '未发送（账号已注销）', '': '—' } as Record<string, string>;
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
                <span className="text-ink-3">{TYPE_TEXT[l.targetType as ReportTargetType] ?? l.targetType} </span>
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
                  <td className="px-4 py-3">{u.published ? <span className="text-brand-text">主页已发布</span> : <span className="text-ink-3">未发布</span>}</td>
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
