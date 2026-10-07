import { PendingReviewBadge, PendingReviewNotice } from '../components/ReviewStatus';
import { motion } from 'motion/react';
import { useCallback, useEffect, useId, useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router';
import { Camera, Heart, ImageIcon, LogOut, MapPin, MessageCircle, ShieldAlert, Sparkles } from 'lucide-react';
import { STUDY_TYPES } from '../../shared/options';
import type { Checkin, CheckinStats, FeedbackItem, ForumPost, MyProfile, NotificationItem, Post, ProfileCard as Card } from '../../shared/types';
import { api, ApiError, fileUrl } from '../lib/api';
import { useAuth } from '../lib/auth';
import { cx, dateTime, timeAgo } from '../lib/format';
import { spring } from '../lib/motion';
import { useToast } from '../lib/toast';
import { Button, ConfirmDialog, Empty, Field, Input, Modal, PageHeader, Segmented, Skeleton, Tag } from '../components/ui';
import { Cover, Nickname, ProfileCard } from '../components/ProfileCard';
import { PostCard } from '../components/PostCard';
import { Illustration, Seal } from '../components/brand';

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
  const { user, refresh } = useAuth();
  const toast = useToast();
  const nav = useNavigate();
  const tabsId = useId();
  const [params, setParams] = useSearchParams();
  const raw = params.get('tab') ?? 'notifications';
  const legacy = LEGACY_TABS[raw];
  const tab = legacy?.tab ?? (TABS.some((t) => t.id === raw) ? raw : 'notifications');
  const viewParam = params.get('view') ?? legacy?.view ?? '';
  const view = CONTENT_VIEWS.some((v) => v.value === viewParam) ? viewParam : 'forum';
  const [profile, setProfile] = useState<MyProfile | null>(null);
  const [missing, setMissing] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [unpub, setUnpub] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(
    () =>
      api.myProfile().then((r) => {
        setProfile(r.profile);
        setMissing(r.missing.length);
        setLoadError(null);
      }),
    [],
  );
  useEffect(() => {
    load().catch((e) => setLoadError(errorText(e)));
  }, [load]);

  // 旧的「匹配请求」已并入私聊
  if (raw === 'connections') return <Navigate to="/messages" replace />;

  const status = !profile ? null : profile.reviewPending ? 'pending' : profile.takenDown ? 'down' : profile.published ? 'live' : 'draft';
  const type = STUDY_TYPES.find((t) => t.value === profile?.studyType);
  const sparse = !!profile && (!profile.subjects.length || Object.values(profile.personality).every((v) => !v));
  const goTab = (id: string) => setParams({ tab: id }, { replace: true });

  return (
    <div>
      <PageHeader title="我的" desc="个人设置：管理主页与问卷、推荐偏好、你发布的内容和账号。" />

      <div className="grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)] lg:gap-8">
        {/* 资料与问卷 */}
        <section aria-labelledby={`${tabsId}-profile`} className="lg:sticky lg:top-20 lg:h-fit">
          <h2 id={`${tabsId}-profile`} className="sr-only">资料与问卷</h2>
          {loadError && !profile ? (
            <div className="rounded-xl bg-surface p-5">
              <p className="text-[14px] text-ink-2">主页信息加载失败：{loadError}</p>
              <Button size="sm" className="mt-3" onClick={() => load().catch((e) => setLoadError(errorText(e)))}>
                重试
              </Button>
            </div>
          ) : !profile ? (
            <Skeleton className="h-[380px] rounded-xl" />
          ) : (
            <div className="overflow-hidden rounded-xl bg-surface">
              <div className="h-24 border-b border-line sm:h-32">
                <Cover id={profile.userId} nickname={profile.nickname} cover={profile.photos[0] ?? null} studyType={profile.studyType} className="h-full w-full" />
              </div>
              <div className="p-5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <Nickname name={profile.nickname} size={20} />
                    <p className="mt-0.5 truncate text-[13px] text-ink-3">{user?.email}</p>
                  </div>
                  {type && <Seal char={type.glyph} tone={type.tone} size={28} />}
                </div>
                <div className="mt-3">
                  {status === 'live' && <Tag tone="brand">已发布 · 正在参与匹配推荐</Tag>}
                  {status === 'draft' && <Tag>未发布{missing ? `，问卷还差 ${missing} 项必填` : ''}</Tag>}
                  {status === 'pending' && <PendingReviewBadge />}
                  {status === 'down' && <Tag tone="danger">已被管理员撤下</Tag>}
                </div>
                {status === 'pending' && <div className="mt-3"><PendingReviewNotice /></div>}
                {status === 'down' && (
                  <p className="mt-3 flex gap-2 text-[13.5px] leading-relaxed text-ink-2">
                    <ShieldAlert size={15} className="mt-1 shrink-0 text-danger" aria-hidden />
                    <span>
                      {dateTime(profile.takenDownAt)} 撤下，原因：{profile.takedownReason}。可修改内容，恢复展示需由管理员处理。
                    </span>
                  </p>
                )}
                {status === 'draft' && (
                  <p className="mt-3 text-[13px] leading-relaxed text-ink-3">发布主页后，系统才会为你推荐同学，其他同学也才能在推荐中看到你。</p>
                )}
                {sparse && status !== 'down' && (
                  <Link to="/me/edit#personality" className="mt-3 flex items-center gap-2 rounded-lg bg-paper-2/70 px-3 py-2 text-[13px] text-ink-2 hover:bg-paper-2">
                    <Sparkles size={14} className="shrink-0 text-brand-text" aria-hidden />
                    补充学习性格与具体科目，推荐更准
                  </Link>
                )}

                <dl className="mt-5 grid grid-cols-3 border-y border-line py-3 text-center">
                  {[
                    { n: profile.stats.views, l: '主页被浏览' },
                    { n: profile.stats.favorites, l: '被收藏' },
                    { n: profile.stats.contactViews, l: '交换联系方式' },
                  ].map((s, i) => (
                    <div key={s.l} className={cx('flex flex-col-reverse', i > 0 && 'border-l border-line')}>
                      <dt className="mt-0.5 text-[12px] text-ink-3">{s.l}</dt>
                      <dd className="text-[20px] font-semibold text-ink tabular">{s.n}</dd>
                    </div>
                  ))}
                </dl>

                <div className="mt-4 grid grid-cols-2 gap-2">
                  <Button variant="primary" onClick={() => nav('/me/edit')}>
                    编辑问卷与资料
                  </Button>
                  {status === 'live' || status === 'pending' ? (
                    <Button onClick={() => nav(`/u/${profile.userId}`)}>查看我的主页</Button>
                  ) : (
                    <Button onClick={() => nav('/me/edit')}>{status === 'down' ? '修改内容' : '去发布'}</Button>
                  )}
                </div>
                {(status === 'live' || status === 'pending') && (
                  <button type="button" onClick={() => setUnpub(true)} className="mt-3 w-full text-center text-[13px] text-ink-3 hover:text-danger">
                    暂时撤回主页
                  </button>
                )}
              </div>
            </div>
          )}
        </section>

        {/* 标签页 */}
        <div className="min-w-0">
          <div className="-mx-4 flex gap-6 overflow-x-auto border-b border-line px-4 no-scrollbar sm:mx-0 sm:px-0" role="tablist" aria-label="个人设置">
            {TABS.map((t) => {
              const on = tab === t.id;
              return (
                <button
                  key={t.id}
                  id={`${tabsId}-tab-${t.id}`}
                  type="button"
                  role="tab"
                  aria-selected={on}
                  aria-controls={`${tabsId}-panel`}
                  tabIndex={on ? 0 : -1}
                  onClick={() => goTab(t.id)}
                  onKeyDown={(e) => {
                    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
                    e.preventDefault();
                    const i = TABS.findIndex((x) => x.id === tab);
                    const next = TABS[(i + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length];
                    goTab(next.id);
                    document.getElementById(`${tabsId}-tab-${next.id}`)?.focus();
                  }}
                  className={cx('relative flex shrink-0 items-center gap-1.5 py-2.5 text-[14.5px] transition-colors', on ? 'font-semibold text-ink' : 'text-ink-3 hover:text-ink')}
                >
                  {t.label}
                  {t.id === 'notifications' && !!user?.unread && (
                    <span className="rounded-full bg-accent px-1.5 text-[11px] font-semibold text-white tabular" aria-label={`${user.unread} 条未读`}>
                      {user.unread}
                    </span>
                  )}
                  {on && <motion.span layoutId="me-tab" transition={spring} className="absolute inset-x-0 -bottom-px h-[2px] bg-ink" />}
                </button>
              );
            })}
          </div>
          <div className="mt-5" role="tabpanel" id={`${tabsId}-panel`} aria-labelledby={`${tabsId}-tab-${tab}`}>
            {tab === 'notifications' && <Notifications onRead={refresh} />}
            {tab === 'preferences' && <Preferences />}
            {tab === 'content' && (
              <div>
                <div className="-mx-4 mb-4 overflow-x-auto px-4 no-scrollbar sm:mx-0 sm:px-0">
                  <Segmented className="w-max" options={CONTENT_VIEWS} value={view} onChange={(v) => setParams({ tab: 'content', view: v }, { replace: true })} />
                </div>
                {view === 'forum' && <MyForumPosts />}
                {view === 'checkins' && <MyCheckins />}
                {view === 'events' && <MyPosts scope="mine" />}
                {view === 'interested' && <MyPosts scope="interested" />}
                {view === 'favorites' && <Favorites />}
              </div>
            )}
            {tab === 'settings' && <AccountSettings />}
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={unpub}
        title="暂时撤回主页？"
        desc="撤回后你不会再出现在其他同学的匹配推荐中，他们也打不开你的主页。资料会保留，随时可以重新发布。"
        confirmText="撤回"
        loading={busy}
        onCancel={() => setUnpub(false)}
        onConfirm={async () => {
          setBusy(true);
          try {
            await api.unpublish();
            await Promise.all([load(), refresh()]);
            toast.success('主页已撤回');
            setUnpub(false);
          } catch (e) {
            toast.error('操作失败', errorText(e));
          } finally {
            setBusy(false);
          }
        }}
      />
    </div>
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
    desc: '你选了「感兴趣」、对方还没有回应的同学。对方看不到这份名单；等对方也选了「感兴趣」，TA 会出现在「私聊」里。',
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
        desc="在校园社区的聊天区分享学习和生活，认识更多同学。"
        action={<Button variant="primary" onClick={() => nav('/community')}>去聊天区发帖</Button>}
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
                  <span>{c.reviewPending ? '审核通过后展示' : c.takenDown ? '仅本人和管理员可见' : c.visibility === 'buddies' ? '仅搭子可见' : '所有同学可见'}</span>
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
          {user?.role === 'admin' && <Tag tone="brand" className="ml-2">管理员</Tag>}
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
        <p className="text-[14px] text-ink-2">树仁搭子由树仁书院学生发展中心维护。</p>
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
