import { PendingReviewBadge } from '../components/ReviewStatus';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router';
import { Bell, Camera, Heart, ImageIcon, LogOut, MapPin, MessageCircle, ShieldAlert } from 'lucide-react';
import { GRADES } from '../../shared/options';
import { speciesOfNickname } from '../../shared/species';
import type { BuddyStatus, Checkin, CheckinStats, FeedbackItem, ForumPost, MyProfile, NotificationItem, Post, ProfileCard as Card } from '../../shared/types';
import { api, ApiError, fileUrl } from '../lib/api';
import { useAuth } from '../lib/auth';
import { cx, timeAgo } from '../lib/format';
import { useToast } from '../lib/toast';
import { Button, ConfirmDialog, Empty, Field, GroupList, Input, Modal, PageHeader, Segmented, Skeleton, Tag, Toggle } from '../components/ui';
import { Plate, IcpNotice } from '../components/brand';
import { useBack } from '../components/Shell';
import { AlertIcon, BookIcon, Chevron, GridIcon, PeopleIcon, ShieldIcon, SlidersIcon } from '../components/icons';
import { useCached } from '../lib/cache';
import { ProfileCard, splitNickname } from '../components/ProfileCard';
import { PostCard } from '../components/PostCard';
import { Illustration } from '../components/brand';
import { ROLE_LABELS, isStaff } from '../../shared/roles';

const TABS = [
  { id: 'notifications', label: '通知' },
  { id: 'preferences', label: '推荐偏好' },
  { id: 'content', label: '我的内容' },
  { id: 'settings', label: '账号' },
];

const CONTENT_VIEWS = [
  { value: 'forum', label: '帖子' },
  { value: 'checkins', label: '打卡' },
  { value: 'events', label: '招募' },
  { value: 'interested', label: '感兴趣的活动' },
  { value: 'favorites', label: '收藏' },
];

/** 旧版标签页链接（/me?tab=favorites 等）映射到新的分区 */
const LEGACY_TABS: Record<string, { tab: string; view: string }> = {
  favorites: { tab: 'content', view: 'favorites' },
  posts: { tab: 'content', view: 'events' },
  interested: { tab: 'content', view: 'interested' },
};

const errorText = (e: unknown) => (e instanceof ApiError ? e.message : '请稍后重试');

/** 按字符截取预览文字 */
function preview(s: string, n = 60) {
  const chars = Array.from(s.replace(/\s+/g, ' ').trim());
  return chars.length > n ? `${chars.slice(0, n).join('')}…` : chars.join('');
}

export function Me() {
  const [params] = useSearchParams();
  const raw = params.get('tab');
  // 旧链接：/me?tab=xxx → /me/xxx；旧的「匹配请求」已并入私聊
  if (raw === 'connections') return <Navigate to="/messages" replace />;
  if (raw) {
    const legacy = LEGACY_TABS[raw];
    const tab = legacy?.tab ?? (TABS.some((t) => t.id === raw) ? raw : 'notifications');
    const view = params.get('view') ?? legacy?.view;
    return <Navigate to={`/me/${tab}${view ? `?view=${view}` : ''}`} replace />;
  }
  return <MeHome />;
}

/** 「我的」：头像与资料、我的内容数量、设置列表、退出登录 */
function MeHome() {
  const { user, logout } = useAuth();
  const toast = useToast();
  const nav = useNavigate();
  const done = useBack('/today');
  const [profile, setProfile] = useState<MyProfile | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [counts, setCounts] = useState<{ forum: string; checkins: number; events: number; favorites: number } | null>(null);
  const { data: buddy } = useCached<BuddyStatus>('activity:me', () => api.activity.me());

  const load = useCallback(() => api.myProfile().then((r) => { setProfile(r.profile); setLoadError(null); }), []);
  useEffect(() => { load().catch((e) => setLoadError(errorText(e))); }, [load]);
  useEffect(() => {
    let live = true;
    Promise.all([
      api.forum.posts({ mine: true }).catch(() => ({ items: [], hasMore: false })),
      api.checkins.stats().catch(() => ({ total: 0 })),
      api.posts({ scope: 'mine' }).catch(() => ({ items: [] })),
      api.favorites().catch(() => ({ items: [] })),
    ]).then(([f, c, e, fav]) => {
      if (live) setCounts({ forum: f.hasMore ? `${f.items.length}+` : String(f.items.length), checkins: c.total, events: e.items.length, favorites: fav.items.length });
    });
    return () => { live = false; };
  }, []);

  const status = !profile ? null : profile.takenDown ? 'down' : profile.reviewPending ? 'pending' : profile.published ? 'live' : 'draft';
  const latin = profile ? speciesOfNickname(profile.nickname)?.latin : undefined;
  const staff = !!user && isStaff(user.role);

  return (
    <div className="mx-auto max-w-[560px] pt-[env(safe-area-inset-top)] md:pt-8">
      <div className="flex h-11 items-center justify-end md:hidden">
        <button type="button" onClick={done} className="-mr-2 h-11 px-2 text-[17px] font-semibold text-brand-text">完成</button>
      </div>

      <div className="flex flex-col gap-[22px]">
        {loadError && !profile ? (
          <div className="rounded-2xl bg-surface p-5">
            <p className="text-[15px] text-ink-2">资料加载失败：{loadError}</p>
            <Button size="sm" className="mt-3" onClick={() => load().catch((e) => setLoadError(errorText(e)))}>重试</Button>
          </div>
        ) : !profile ? (
          <Skeleton className="h-52 rounded-2xl" />
        ) : (
          <div className="flex flex-col items-center gap-2">
            <Plate nickname={profile.nickname} photo={profile.photos[0] ?? null} className="size-[92px] overflow-hidden rounded-full bg-mat" pad="0" fit="cover" />
            <div className="flex flex-col items-center gap-px">
              <h1 className="text-[24px] font-bold text-ink">{profile.nickname}</h1>
              {latin && <p className="latin text-[13px] text-ink-3">{latin}</p>}
              <CopyId id={profile.nickname} />
              <p className="mt-0.5 text-[15px] text-ink-3">{[buddy?.shurenMember === 'yes' ? '树仁书院' : '', profile.major, GRADES.find((g) => g.value === profile.grade)?.label, staff ? ROLE_LABELS[user!.role] : ''].filter(Boolean).join(' · ')}</p>
            </div>
            <Link to="/me/edit" className="flex h-[34px] items-center rounded-full bg-brand-soft px-4 text-[15px] font-semibold text-brand-text">编辑资料与问卷</Link>
            {status !== 'live' && (
              <p className="px-6 text-center text-[13px] text-ink-3">
                {status === 'draft' ? '主页还没有发布，发布后才会出现在推荐里。' : status === 'pending' ? '主页等待审核，通过后公开。' : `主页已被管理员撤下：${profile.takedownReason ?? ''}`}
              </p>
            )}
          </div>
        )}

        <div className="grid grid-cols-4 rounded-2xl bg-surface py-3">
          {[
            { n: counts?.forum, l: '帖子', view: 'forum' },
            { n: counts?.checkins, l: '打卡', view: 'checkins' },
            { n: counts?.events, l: '招募', view: 'events' },
            { n: counts?.favorites, l: '收藏', view: 'favorites' },
          ].map((c) => (
            <Link key={c.l} to={`/me/content?view=${c.view}`} className="flex flex-col items-center gap-0.5 text-ink">
              <span className="text-[20px] font-bold tabular">{c.n ?? '–'}</span>
              <span className="text-[12px] text-ink-3">{c.l}</span>
            </Link>
          ))}
        </div>

        <GroupList>
          <MeRow to="/buddy" icon={<PeopleIcon size={20} width={2} />} value={buddyValue(buddy)}>我的搭子</MeRow>
        </GroupList>

        <GroupList>
          <MeRow to="/me/preferences" icon={<SlidersIcon size={20} width={2} />}>推荐偏好</MeRow>
          <MeRow to="/me/reminders" icon={<Bell size={20} />}>消息提醒</MeRow>
          <MeRow to="/me/edit" icon={<GridIcon size={20} width={2} />} value={profile ? `${profile.schedule.length} 个空闲时段` : undefined}>我的空闲时间</MeRow>
          <MeRow to="/me/settings" icon={<ShieldIcon size={20} width={2} />}>账号与隐私</MeRow>
        </GroupList>

        <GroupList>
          <MeRow to="/rules" icon={<BookIcon size={20} width={2} />}>活动规则</MeRow>
          {staff && <MeRow to="/admin" icon={<AlertIcon size={20} width={2} />}>管理后台</MeRow>}
        </GroupList>

        <GroupList>
          <button
            type="button"
            onClick={async () => {
              try { await logout(); nav('/'); } catch (e) { toast.error('退出失败', errorText(e)); }
            }}
            className="h-[46px] w-full text-[17px] text-danger"
          >
            退出登录
          </button>
        </GroupList>
      </div>
    </div>
  );
}

/** 「我的搭子」一行右侧：搭子的昵称、累计积分和名次；没有搭子时显示邀请 */
function buddyValue(status: BuddyStatus | undefined): string | undefined {
  if (!status) return undefined;
  if (!status.pair) {
    const incoming = status.invites.filter((i) => i.direction === 'incoming').length;
    return incoming ? `${incoming} 个邀请` : '还没有绑定';
  }
  const parts = [splitNickname(status.pair.partner.nickname).word];
  if (status.score?.through) parts.push(`${status.score.total} 分`);
  if (status.rank) parts.push(`第 ${status.rank.rank} 名`);
  return parts.join(' · ');
}

/** 自己的 ID（系统昵称）：已经认识的同学可以在「找同学」里输入它找到你 */
function CopyId({ id }: { id: string }) {
  const toast = useToast();
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(id);
      toast.success('ID 已复制', '发给同学，对方在「找同学」里粘贴就能找到你。');
    } catch {
      toast.info(`我的 ID：${id}`, '没能自动复制，请长按选中后复制。');
    }
  };
  return (
    <button type="button" onClick={() => void copy()} className="mt-1 inline-flex h-7 items-center gap-1 rounded-full bg-paper-2 px-3 text-[13px] text-ink-2">
      复制我的 ID
    </button>
  );
}

function MeRow({ to, icon, value, children }: { to: string; icon: ReactNode; value?: string; children: ReactNode }) {
  return (
    <Link to={to} className="flex h-[46px] items-center gap-3 px-4 text-ink active:bg-paper">
      <span className="text-brand-text">{icon}</span>
      <span className="flex-1 text-[17px]">{children}</span>
      {value && <span className="text-[15px] text-ink-3">{value}</span>}
      <Chevron />
    </Link>
  );
}

const SECTION_TITLES: Record<string, string> = { notifications: '通知', reminders: '消息提醒', preferences: '推荐偏好', content: '我的内容', settings: '账号与隐私' };

/** 「我的」里点进去的分页：通知、推荐偏好、我的内容、账号与隐私 */
export function MeSection() {
  const { user, refresh } = useAuth();
  const { pathname } = useLocation();
  const [params, setParams] = useSearchParams();
  const section = pathname.split('/')[2] ?? '';
  const viewParam = params.get('view') ?? '';
  const view = CONTENT_VIEWS.some((v) => v.value === viewParam) ? viewParam : 'forum';
  if (!SECTION_TITLES[section]) return <Navigate to="/me" replace />;

  return (
    <div className="mx-auto max-w-[640px]">
      <PageHeader title={SECTION_TITLES[section]} />
      {section === 'notifications' && <Notifications onRead={refresh} />}
      {section === 'reminders' && <ReminderSettings key={user?.id} />}
      {section === 'preferences' && <Preferences />}
      {section === 'content' && (
        <div>
          <div className="-mx-4 mb-4 overflow-x-auto px-4 no-scrollbar sm:mx-0 sm:px-0">
            <Segmented className="w-max" options={CONTENT_VIEWS} value={view} onChange={(v) => setParams({ view: v }, { replace: true })} />
          </div>
          {view === 'forum' && <MyForumPosts />}
          {view === 'checkins' && <MyCheckins />}
          {view === 'events' && <MyPosts scope="mine" />}
          {view === 'interested' && <MyPosts scope="interested" />}
          {view === 'favorites' && <Favorites />}
        </div>
      )}
      {section === 'settings' && (
        <div className="flex flex-col gap-6">
          <ProfileVisibility />
          <AccountSettings />
        </div>
      )}
    </div>
  );
}

function ReminderSettings() {
  const toast = useToast();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    api.notificationPreferences().then(
      (prefs) => { if (active) setEnabled(prefs.emailEnabled); },
      (e) => { if (active) setError(errorText(e)); },
    );
    return () => { active = false; };
  }, [attempt]);

  function reload() {
    setEnabled(null);
    setError(null);
    setAttempt((n) => n + 1);
  }

  async function save(next: boolean) {
    setSaving(true);
    try {
      const prefs = await api.setNotificationPreferences(next);
      setEnabled(prefs.emailEnabled);
      toast.success(prefs.emailEnabled ? '已开启邮件提醒' : '已关闭邮件提醒');
    } catch (e) {
      toast.error('暂时无法确认邮件提醒设置', errorText(e));
      reload();
    } finally {
      setSaving(false);
    }
  }

  if (error) return <LoadError message={error} onRetry={reload} />;
  if (enabled === null) return <Skeleton className="h-24 rounded-xl" />;
  return (
    <GroupList>
      <div className="flex items-center justify-between gap-4 px-4 py-3.5">
        <div>
          <p className="text-[17px] font-semibold text-ink">邮件提醒</p>
          <p className="mt-1 text-[14px] leading-relaxed text-ink-2">有同学对你感兴趣、与你互相感兴趣或申请交换联系方式时，发邮件到你的校园邮箱。</p>
          <p className="mt-1 text-[13px] text-ink-3">关闭后仍可在站内查看这些消息。</p>
        </div>
        <Toggle checked={enabled} disabled={saving} onChange={save} label={<span className="sr-only">邮件提醒</span>} />
      </div>
    </GroupList>
  );
}

/** 暂时撤回已发布的主页（原在「我的」首页） */
function ProfileVisibility() {
  const { refresh } = useAuth();
  const toast = useToast();
  const [profile, setProfile] = useState<MyProfile | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => api.myProfile().then((r) => setProfile(r.profile)).catch(() => {}), []);
  useEffect(() => { void load(); }, [load]);
  if (!profile || !(profile.published || profile.reviewPending) || profile.takenDown) return null;
  return (
    <section>
      <h3 className="text-[15px] font-semibold text-ink">主页</h3>
      <p className="mt-1 text-[14px] text-ink-3">撤回后你不会出现在推荐中，其他同学也打不开你的主页；资料会保留，随时可以重新发布。</p>
      <Button size="sm" className="mt-3" onClick={() => setOpen(true)}>暂时撤回主页</Button>
      <ConfirmDialog
        open={open}
        title="暂时撤回主页？"
        desc="撤回后你不会再出现在其他同学的匹配推荐中，他们也打不开你的主页。资料会保留，随时可以重新发布。"
        confirmText="撤回"
        loading={busy}
        onCancel={() => setOpen(false)}
        onConfirm={async () => {
          setBusy(true);
          try {
            await api.unpublish();
            await Promise.all([load(), refresh()]);
            toast.success('主页已撤回');
            setOpen(false);
          } catch (e) {
            toast.error('操作失败', errorText(e));
          } finally {
            setBusy(false);
          }
        }}
      />
    </section>
  );
}

// ---------------- 通用 ----------------

function LoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="rounded-xl bg-surface p-5" role="alert">
      <p className="text-[14px] text-ink-2">加载失败：{message}</p>
      <Button size="sm" className="mt-3" onClick={onRetry}>
        重试
      </Button>
    </div>
  );
}

/** 按 id 游标分页的列表（帖子、打卡） */
function usePaged<T extends { id: number }>(fetchPage: (before?: number) => Promise<{ items: T[]; hasMore: boolean }>) {
  const [items, setItems] = useState<T[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const reload = useCallback(() => {
    setError(null);
    setItems(null);
    fetchPage()
      .then((r) => {
        setItems(r.items);
        setHasMore(r.hasMore);
      })
      .catch((e) => setError(errorText(e)));
  }, [fetchPage]);
  useEffect(reload, [reload]);
  const more = async () => {
    if (!items?.length || loadingMore) return;
    setLoadingMore(true);
    try {
      const r = await fetchPage(items[items.length - 1].id);
      setItems((xs) => [...(xs ?? []), ...r.items.filter((i) => !xs?.some((x) => x.id === i.id))]);
      setHasMore(r.hasMore);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setLoadingMore(false);
    }
  };
  return { items, hasMore, error, reload, more, loadingMore };
}

function MoreButton({ show, loading, onClick }: { show: boolean; loading: boolean; onClick: () => void }) {
  if (!show) return null;
  return (
    <div className="mt-4 flex justify-center">
      <Button size="sm" loading={loading} onClick={onClick}>
        加载更多
      </Button>
    </div>
  );
}

function TakenDownNote({ reason, what }: { reason?: string | null; what: string }) {
  return (
    <p className="mt-1.5 flex items-start gap-1.5 text-[12.5px] text-danger">
      <ShieldAlert size={13} className="mt-0.5 shrink-0" aria-hidden />
      这条{what}已被管理员撤下{reason ? `：${reason}` : ''}，其他同学看不到
    </p>
  );
}

// ---------------- 通知 ----------------

function Notifications({ onRead }: { onRead: () => void }) {
  const nav = useNavigate();
  const [items, setItems] = useState<NotificationItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    setError(null);
    api
      .notifications()
      .then((r) => {
        setItems(r.items);
        if (r.items.some((i) => !i.read)) setTimeout(() => api.readAll().then(onRead).catch(() => {}), 1200);
      })
      .catch((e) => setError(errorText(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(load, [load]);
  if (error) return <LoadError message={error} onRetry={load} />;
  if (!items) return <Skeleton className="h-60 rounded-xl" />;
  if (!items.length) return <Empty title="没有通知" desc="有同学和你互相感兴趣、评论你的帖子或打卡、对你的招募感兴趣，或者内容被管理员处理时，会在这里提醒你。" />;
  return (
    <ul className="overflow-hidden rounded-xl bg-surface">
      {items.map((n, i) => (
        <li key={n.id} className={cx(i > 0 && 'border-t border-line')}>
          <button type="button" onClick={() => n.link && nav(n.link)} disabled={!n.link} className="flex w-full gap-3 px-5 py-3.5 text-left transition-colors enabled:hover:bg-surface-2">
            <span className={cx('mt-[9px] size-[7px] shrink-0 rounded-full', n.read ? 'bg-transparent' : 'bg-accent')} aria-label={n.read ? undefined : '未读'} />
            <span className="min-w-0 flex-1">
              <span className="flex items-baseline justify-between gap-3">
                <span className={cx('text-[15px] text-ink', !n.read && 'font-semibold')}>{n.title}</span>
                <span className="shrink-0 text-[12.5px] text-ink-3">{timeAgo(n.createdAt)}</span>
              </span>
              <span className="mt-0.5 block text-[14px] leading-relaxed break-words text-ink-2">{n.body}</span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

// ---------------- 推荐偏好 ----------------

function Preferences() {
  return (
    <div className="space-y-4">
      <Link to="/match/later" className="block rounded-xl bg-surface p-5 text-brand-text hover:underline">查看稍后再看的同学 →</Link>
      <FeedbackList action="like" />
      <FeedbackList action="dislike" />
      <ExclusionList />
    </div>
  );
}

const FEEDBACK_PAGE = 20;

const FEEDBACK_LISTS = {
  like: {
    id: 'pref-liked',
    title: '我感兴趣、等待回应的同学',
    desc: '你选了「感兴趣」、对方还没有回应的同学。对方会在「消息 → 联系请求」里看到你对 TA 感兴趣，撤回后就不再显示；等对方也选了「感兴趣」，TA 会出现在「私聊」里。',
    empty: '没有正在等待回应的同学。',
    note: (p: FeedbackItem) => `${timeAgo(p.createdAt)}表示感兴趣`,
    button: '撤回',
    label: (name: string) => `撤回对 ${name} 的感兴趣`,
    done: ['已撤回', (name: string) => `${name} 之后可能会再次出现在你的推荐里`] as const,
  },
  dislike: {
    id: 'pref-disliked',
    title: '不感兴趣的同学',
    desc: '标记为「不感兴趣」的同学和你解除配对的同学不会再推荐给你，对方也不会知道。放回推荐后，TA 可能会重新出现在你的推荐里；要重新私聊，需要双方再次选「感兴趣」。',
    empty: '还没有标记过不感兴趣的同学。',
    note: (p: FeedbackItem) => (p.closedMatch ? `${timeAgo(p.createdAt)}解除配对` : `${timeAgo(p.createdAt)}标记`),
    button: '放回推荐',
    label: (name: string) => `把 ${name} 放回推荐`,
    done: ['已放回推荐', (name: string) => `${name} 之后可能会再次出现在你的推荐里`] as const,
  },
};

/** 自己在匹配推荐里做过的选择：可以查看，也可以收回 */
function FeedbackList({ action }: { action: 'like' | 'dislike' }) {
  const copy = FEEDBACK_LISTS[action];
  const toast = useToast();
  const [items, setItems] = useState<FeedbackItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [shown, setShown] = useState(FEEDBACK_PAGE);
  const load = useCallback(() => {
    setError(null);
    api.match
      .feedbackList(action)
      .then((r) => setItems(r.items))
      .catch((e) => setError(errorText(e)));
  }, [action]);
  useEffect(load, [load]);

  return (
    <section className="rounded-xl bg-surface p-5" aria-labelledby={copy.id}>
      <h3 id={copy.id} className="text-[15px] font-semibold text-ink">
        {copy.title}{items?.length ? <span className="ml-1.5 font-normal text-ink-3 tabular">{items.length}</span> : null}
      </h3>
      <p className="mt-1 text-[13.5px] leading-relaxed text-ink-3">{copy.desc}</p>
      <div className="mt-4">
        {error ? (
          <LoadError message={error} onRetry={load} />
        ) : !items ? (
          <Skeleton className="h-24 rounded-lg" />
        ) : !items.length ? (
          <p className="rounded-lg bg-paper-2/60 px-4 py-3 text-[13.5px] text-ink-3">{copy.empty}</p>
        ) : (
          <>
            <ul className="divide-y divide-line rounded-lg border border-line">
              {items.slice(0, shown).map((p) => (
                <li key={p.targetId} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <Link to={`/u/${p.targetId}`} className="block truncate text-[14.5px] text-ink hover:underline">
                      {p.remarkName || p.nickname}{p.remarkName && <span className="ml-2 text-[12px] text-ink-3">{p.nickname}</span>}
                    </Link>
                    <p className="text-[12px] text-ink-3">{copy.note(p)}</p>
                  </div>
                  <Button
                    size="sm"
                    loading={busyId === p.targetId}
                    disabled={busyId !== null}
                    aria-label={copy.label(p.nickname)}
                    onClick={async () => {
                      setBusyId(p.targetId);
                      try {
                        await api.match.undoFeedback(p.targetId);
                        setItems((xs) => xs?.filter((x) => x.targetId !== p.targetId) ?? null);
                        toast.success(copy.done[0], copy.done[1](p.nickname));
                      } catch (e) {
                        toast.error('操作失败', errorText(e));
                      } finally {
                        setBusyId(null);
                      }
                    }}
                  >
                    {copy.button}
                  </Button>
                </li>
              ))}
            </ul>
            {items.length > shown && (
              <div className="mt-3 flex justify-center">
                <Button size="sm" variant="ghost" onClick={() => setShown((n) => n + FEEDBACK_PAGE)}>
                  显示更多（还有 {items.length - shown} 位）
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}

function ExclusionList() {
  const toast = useToast();
  const [items, setItems] = useState<{ id: number; nickname: string }[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const load = useCallback(() => {
    setError(null);
    api
      .connections()
      .then((r) => setItems(r.exclusions))
      .catch((e) => setError(errorText(e)));
  }, []);
  useEffect(load, [load]);

  return (
    <section className="rounded-xl bg-surface p-5" aria-labelledby="pref-excluded">
      <h3 id="pref-excluded" className="text-[15px] font-semibold text-ink">
        已排除的同学{items?.length ? <span className="ml-1.5 font-normal text-ink-3 tabular">{items.length}</span> : null}
      </h3>
      <p className="mt-1 text-[13.5px] leading-relaxed text-ink-3">排除后，你们互相看不到对方的主页、帖子和打卡，不会出现在彼此的推荐里，私聊也会关闭。对方不会收到提示。</p>
      <div className="mt-4">
        {error ? (
          <LoadError message={error} onRetry={load} />
        ) : !items ? (
          <Skeleton className="h-24 rounded-lg" />
        ) : !items.length ? (
          <p className="rounded-lg bg-paper-2/60 px-4 py-3 text-[13.5px] text-ink-3">没有排除的同学。可以在同学主页或私聊的「更多」菜单中排除。</p>
        ) : (
          <ul className="divide-y divide-line rounded-lg border border-line">
            {items.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <span className="min-w-0 truncate text-[14.5px] text-ink">{p.nickname}</span>
                <Button
                  size="sm"
                  loading={busyId === p.id}
                  disabled={busyId !== null}
                  aria-label={`取消排除 ${p.nickname}`}
                  onClick={async () => {
                    setBusyId(p.id);
                    try {
                      await api.restoreConnection(p.id);
                      setItems((xs) => xs?.filter((x) => x.id !== p.id) ?? null);
                      toast.success('已取消排除', '你们又可以看到彼此的主页和社区内容了');
                    } catch (e) {
                      toast.error('操作失败', errorText(e));
                    } finally {
                      setBusyId(null);
                    }
                  }}
                >
                  取消排除
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

// ---------------- 我的内容 ----------------

const fetchMyForumPosts = (before?: number) => api.forum.posts({ mine: true, before });

function MyForumPosts() {
  const nav = useNavigate();
  const { items, hasMore, error, reload, more, loadingMore } = usePaged<ForumPost>(fetchMyForumPosts);
  if (error && !items) return <LoadError message={error} onRetry={reload} />;
  if (!items) return <Skeleton className="h-60 rounded-xl" />;
  if (!items.length)
    return (
      <Empty
        art={<Illustration name="mascot-empty" className="mb-4 size-24" />}
        title="还没有发过帖子"
        desc="在社区分享学习和生活，认识更多同学。"
        action={<Button variant="primary" onClick={() => nav('/community')}>去社区发帖</Button>}
      />
    );
  return (
    <div>
      <ul className="overflow-hidden rounded-xl bg-surface">
        {items.map((p, i) => (
          <li key={p.id} className={cx(i > 0 && 'border-t border-line')}>
            <Link to={`/community/posts/${p.id}`} className="flex gap-3 px-5 py-4 transition-colors hover:bg-surface-2">
              <div className="min-w-0 flex-1">
                {p.title && <p className="truncate text-[15px] font-semibold text-ink">{p.title}</p>}
                <p className={cx('text-[14px] leading-relaxed break-words text-ink-2', p.title ? 'mt-0.5 line-clamp-2' : 'line-clamp-3')}>{preview(p.body, 120)}</p>
                {p.reviewPending ? <PendingReviewBadge /> : p.takenDown && <TakenDownNote reason={p.takedownReason} what="帖子" />}
                <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-ink-3">
                  <span>{timeAgo(p.createdAt)}</span>
                  <span className="inline-flex items-center gap-1">
                    <Heart size={12} aria-hidden /> <span className="sr-only">点赞</span>
                    {p.likeCount}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <MessageCircle size={12} aria-hidden /> <span className="sr-only">评论</span>
                    {p.commentCount}
                  </span>
                  {p.images.length > 0 && (
                    <span className="inline-flex items-center gap-1">
                      <ImageIcon size={12} aria-hidden /> {p.images.length} 张图
                    </span>
                  )}
                </p>
              </div>
              {p.images[0] && (
                <img src={fileUrl(p.images[0])} alt="" loading="lazy" className="size-16 shrink-0 rounded-md border border-line object-cover" />
              )}
            </Link>
          </li>
        ))}
      </ul>
      {error && <p className="mt-3 text-[13px] text-danger" role="alert">{error}</p>}
      <MoreButton show={hasMore} loading={loadingMore} onClick={more} />
    </div>
  );
}

const fetchMyCheckins = (before?: number) => api.checkins.list({ scope: 'mine', before });

function MyCheckins() {
  const nav = useNavigate();
  const { items, hasMore, error, reload, more, loadingMore } = usePaged<Checkin>(fetchMyCheckins);
  const [stats, setStats] = useState<CheckinStats | null>(null);
  useEffect(() => {
    api.checkins.stats().then(setStats).catch(() => {});
  }, []);
  const header = (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
      <p className="text-[13.5px] text-ink-2">
        {stats ? (
          <>
            连续打卡 <b className="font-semibold text-ink tabular">{stats.streak}</b> 天 · 共 <b className="font-semibold text-ink tabular">{stats.total}</b> 次
            {stats.checkedInToday ? ' · 今天已打卡' : ' · 今天还没打卡'}
          </>
        ) : (
          '照片由网页实时拍摄，位置和北京时间由服务器盖章。'
        )}
      </p>
      <Button size="sm" variant="primary" icon={<Camera size={14} />} onClick={() => nav('/community/checkin/new')}>
        拍照打卡
      </Button>
    </div>
  );
  if (error && !items) return <LoadError message={error} onRetry={reload} />;
  if (!items) return <Skeleton className="h-60 rounded-xl" />;
  if (!items.length)
    return (
      <Empty
        art={<Illustration name="mascot-cheer" className="mb-4 size-24" />}
        title="还没有打卡"
        desc="打开摄像头实时拍一张学习照，服务器会在右下角盖上位置和北京时间。"
        action={<Button variant="primary" icon={<Camera size={15} />} onClick={() => nav('/community/checkin/new')}>拍照打卡</Button>}
      />
    );
  return (
    <div>
      {header}
      <ul className="overflow-hidden rounded-xl bg-surface">
        {items.map((c, i) => (
          <li key={c.id} className={cx(i > 0 && 'border-t border-line')}>
            <Link to={`/community/checkins/${c.id}`} className="flex gap-3 px-5 py-4 transition-colors hover:bg-surface-2">
              <img src={fileUrl(c.image)} alt="" loading="lazy" className="size-20 shrink-0 rounded-md border border-line bg-paper-2 object-cover" />
              <div className="min-w-0 flex-1">
                <p className={cx('line-clamp-2 text-[14.5px] leading-relaxed break-words', c.caption ? 'text-ink' : 'text-ink-3')}>{c.caption || '（没有写说明）'}</p>
                <p className="mt-1 flex items-center gap-1 truncate text-[12.5px] text-ink-3">
                  <MapPin size={12} className="shrink-0" aria-hidden />
                  <span className="truncate">{c.placeLabel} · {c.stampText}</span>
                </p>
                {c.reviewPending ? <PendingReviewBadge /> : c.takenDown && <TakenDownNote reason={c.takedownReason} what="打卡" />}
                <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-ink-3">
                  <span>{c.reviewPending ? '审核通过后展示' : c.takenDown ? '仅本人和管理员可见' : c.visibility === 'buddies' ? '仅私聊的同学可见' : '所有同学可见'}</span>
                  <span className="inline-flex items-center gap-1">
                    <Heart size={12} aria-hidden /> <span className="sr-only">点赞</span>
                    {c.likeCount}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <MessageCircle size={12} aria-hidden /> <span className="sr-only">评论</span>
                    {c.commentCount}
                  </span>
                </p>
              </div>
            </Link>
          </li>
        ))}
      </ul>
      {error && <p className="mt-3 text-[13px] text-danger" role="alert">{error}</p>}
      <MoreButton show={hasMore} loading={loadingMore} onClick={more} />
    </div>
  );
}

function Favorites() {
  const nav = useNavigate();
  const [items, setItems] = useState<Card[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    setError(null);
    api
      .favorites()
      .then((r) => setItems(r.items))
      .catch((e) => setError(errorText(e)));
  }, []);
  useEffect(load, [load]);
  if (error) return <LoadError message={error} onRetry={load} />;
  if (!items) return <Skeleton className="h-60 rounded-xl" />;
  if (!items.length)
    return (
      <Empty
        art={<Illustration name="mascot-empty" className="mb-4 size-24" />}
        title="还没有收藏"
        desc="在匹配推荐或同学主页点「收藏」，就会出现在这里。"
        action={<Button onClick={() => nav('/match')}>去匹配推荐</Button>}
      />
    );
  return (
    <div className="grid grid-cols-2 gap-3 xl:grid-cols-3">
      {items.map((c) => (
        <ProfileCard key={c.id} card={c} onOpen={() => nav(`/u/${c.id}`)} />
      ))}
    </div>
  );
}

function MyPosts({ scope }: { scope: 'mine' | 'interested' }) {
  const nav = useNavigate();
  const [items, setItems] = useState<Post[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    setError(null);
    setItems(null);
    api
      .posts({ scope })
      .then((r) => setItems(r.items))
      .catch((e) => setError(errorText(e)));
  }, [scope]);
  useEffect(load, [load]);
  if (error) return <LoadError message={error} onRetry={load} />;
  if (!items) return <Skeleton className="h-60 rounded-xl" />;
  if (!items.length)
    return scope === 'mine' ? (
      <Empty title="还没有发起过招募" desc="比如「雅思口语练习，每周两次」或「数分期末互助」。" action={<Button variant="primary" onClick={() => nav('/events/new')}>发起招募</Button>} />
    ) : (
      <Empty title="还没有感兴趣的活动" desc="去社区的招募里看看大家在组织什么。" action={<Button onClick={() => nav('/community?tab=events')}>去看招募</Button>} />
    );
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {items.map((p) => (
        <div key={p.id}>
          {!p.reviewPending && p.takenDown && <p className="mb-1.5 text-[13px] text-danger">这条招募已被管理员撤下{p.takedownReason ? `：${p.takedownReason}` : ''}</p>}
          <PostCard post={p} onOpen={() => nav(`/events/${p.id}`)} onChange={(x) => setItems((xs) => xs!.map((i) => (i.id === p.id ? { ...i, ...x } : i)))} />
        </div>
      ))}
    </div>
  );
}

// ---------------- 账号 ----------------

function AccountSettings() {
  const { user, logout, setUser } = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  const [deleting, setDeleting] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="space-y-3">
      <section className="rounded-xl bg-surface p-5">
        <h3 className="text-[15px] font-semibold text-ink">登录邮箱</h3>
        <p className="mt-1 text-[15px] break-all text-ink">
          {user?.email}
          {user && isStaff(user.role) && <Tag tone="brand" className="ml-2">{ROLE_LABELS[user.role]}</Tag>}
        </p>
        <p className="mt-1 text-[13.5px] text-ink-3">邮箱用于校园身份验证，不能修改；只有在私聊中双方同意交换联系方式、且你选择了展示校园邮箱时，才会让对方看到。</p>
      </section>

      <section className="rounded-xl bg-surface p-5">
        <h3 className="text-[15px] font-semibold text-ink">登录方式</h3>
        <p className="mt-1 text-[13.5px] text-ink-3">使用学校邮箱和密码登录。修改或忘记密码时，通过学校邮箱验证码重设。</p>
        <Link to={`/login?mode=reset&email=${encodeURIComponent(user?.email ?? '')}&next=${encodeURIComponent('/me?tab=settings')}`} className="mt-3 inline-block text-[14px] text-brand-text underline">通过邮箱重设密码</Link>
      </section>

      <section className="rounded-xl border border-danger/20 bg-surface p-5">
        <h3 className="text-[15px] font-semibold text-ink">注销账号</h3>
        <p className="mt-1 text-[13.5px] leading-relaxed text-ink-3">注销会删除你的主页、社区帖子、打卡、评论和私聊记录，撤回招募内容并终止联系方式交换。操作前请确认已保存需要保留的信息。</p>
        <Button variant="dangerOutline" size="sm" className="mt-3" onClick={() => { setPassword(''); setConfirmed(false); setError(null); setDeleting(true); }}>申请注销</Button>
      </section>

      <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-surface p-5">
        <p className="text-[14px] text-ink-2">树仁搭子由树仁书院学生发展中心维护。<br /><IcpNotice className="text-[13px] text-ink-3" /></p>
        <Link to="/" className="text-[14px] text-brand-text hover:underline">
          查看首页
        </Link>
      </section>

      <Button
        variant="ghost"
        icon={<LogOut size={16} />}
        className="w-full text-danger hover:bg-danger-soft hover:text-danger"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try { await logout(); nav('/'); }
          catch (cause) { toast.error('退出失败', cause instanceof ApiError ? cause.message : '请稍后重试'); }
          finally { setBusy(false); }
        }}
      >
        退出登录
      </Button>
      <Modal open={deleting} onClose={() => { if (!busy) { setDeleting(false); setPassword(''); } }} title="确认注销账号" size="sm" dismissible={!busy}>
        <form className="space-y-4 px-6 pt-4 pb-6" onSubmit={async (event) => {
          event.preventDefault();
          if (!confirmed || !password || busy) return;
          setBusy(true);
          setError(null);
          try {
            await api.deleteAccount(password);
            setPassword('');
            setUser(null);
            toast.success('账号已注销', '公开内容与私聊记录已删除');
            nav('/', { replace: true });
          } catch (cause) { setError(cause instanceof ApiError ? cause.message : '注销失败，请稍后重试'); }
          finally { setBusy(false); }
        }}>
          <p className="text-[14px] leading-relaxed text-ink-2">此操作会删除你的主页、帖子、打卡和私聊记录，并终止联系方式交换，无法恢复。请输入当前密码确认本人操作。</p>
          <Field label="当前密码"><Input type="password" name="password" autoComplete="current-password" aria-label="当前密码" value={password} onChange={(event) => { setPassword(event.target.value); setError(null); }} required disabled={busy} /></Field>
          <label className="flex items-start gap-2 text-[13.5px] text-ink-2"><input type="checkbox" className="mt-1 accent-brand" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} disabled={busy} required /><span>我确认注销账号，并删除我发布的内容和私聊记录。</span></label>
          {error && <p role="alert" className="text-[13.5px] text-danger">{error}</p>}
          <div className="flex justify-end gap-2"><Button type="button" disabled={busy} onClick={() => { setDeleting(false); setPassword(''); }}>取消</Button><Button type="submit" variant="danger" loading={busy} disabled={!confirmed || !password}>确认注销</Button></div>
        </form>
      </Modal>
    </div>
  );
}
