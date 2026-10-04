import { motion } from 'motion/react';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { LogOut, ShieldAlert } from 'lucide-react';
import { STUDY_TYPES } from '../../shared/options';
import type { MyProfile, NotificationItem, Post, ProfileCard as Card } from '../../shared/types';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { cx, dateTime, timeAgo } from '../lib/format';
import { spring } from '../lib/motion';
import { useToast } from '../lib/toast';
import { Button, ConfirmDialog, Empty, Field, Input, Modal, PageHeader, Skeleton, Tag } from '../components/ui';
import { ContactRequests } from '../components/ContactRequests';
import { Cover, Nickname, ProfileCard } from '../components/ProfileCard';
import { PostCard } from '../components/PostCard';
import { Illustration, Seal } from '../components/brand';

const TABS = [
  { id: 'notifications', label: '通知' },
  { id: 'connections', label: '匹配请求' },
  { id: 'favorites', label: '收藏' },
  { id: 'posts', label: '我的招募' },
  { id: 'interested', label: '感兴趣的活动' },
  { id: 'settings', label: '账号' },
];

export function Me() {
  const { user, refresh } = useAuth();
  const toast = useToast();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') ?? 'notifications';
  const [profile, setProfile] = useState<MyProfile | null>(null);
  const [missing, setMissing] = useState(0);
  const [unpub, setUnpub] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = () =>
    api.myProfile().then((r) => {
      setProfile(r.profile);
      setMissing(r.missing.length);
    });
  useEffect(() => {
    load().catch(() => {});
  }, []);

  const status = !profile ? null : profile.takenDown ? 'down' : profile.published ? 'live' : 'draft';
  const type = STUDY_TYPES.find((t) => t.value === profile?.studyType);

  return (
    <div>
      <PageHeader title="我的" />

      <div className="grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)] lg:gap-8">
        {/* 我的主页概览 */}
        <div className="lg:sticky lg:top-20 lg:h-fit">
          {!profile ? (
            <Skeleton className="h-[380px] rounded-xl" />
          ) : (
            <div className="overflow-hidden rounded-xl bg-surface">
              <div className="h-32 border-b border-line">
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
                  {status === 'live' && <Tag tone="brand">已在搭子广场上</Tag>}
                  {status === 'draft' && <Tag>还没有上传{missing ? `，还差 ${missing} 项必填` : ''}</Tag>}
                  {status === 'down' && <Tag tone="danger">已被管理员撤下</Tag>}
                </div>
                {status === 'down' && (
                  <p className="mt-3 flex gap-2 text-[13.5px] leading-relaxed text-ink-2">
                    <ShieldAlert size={15} className="mt-1 shrink-0 text-danger" />
                    <span>
                      {dateTime(profile.takenDownAt)} 撤下，原因：{profile.takedownReason}
                    </span>
                  </p>
                )}

                <dl className="mt-5 grid grid-cols-3 border-y border-line py-3 text-center">
                  {[
                    { n: profile.stats.views, l: '主页被浏览' },
                    { n: profile.stats.favorites, l: '被收藏' },
                    { n: profile.stats.contactViews, l: '联系方式被获取' },
                  ].map((s, i) => (
                    <div key={s.l} className={cx(i > 0 && 'border-l border-line')}>
                      <dd className="text-[20px] font-semibold text-ink tabular">{s.n}</dd>
                      <dt className="mt-0.5 text-[12px] text-ink-3">{s.l}</dt>
                    </div>
                  ))}
                </dl>

                <div className="mt-4 grid grid-cols-2 gap-2">
                  <Button variant="primary" onClick={() => nav('/me/edit')}>
                    编辑主页
                  </Button>
                  {status === 'live' ? (
                    <Button onClick={() => nav(`/u/${profile.userId}`)}>查看主页</Button>
                  ) : (
                    <Button onClick={() => nav('/me/edit')}>{status === 'down' ? '修改后重新上传' : '去上传'}</Button>
                  )}
                </div>
                {status === 'live' && (
                  <button onClick={() => setUnpub(true)} className="mt-3 w-full text-center text-[13px] text-ink-3 hover:text-danger">
                    暂时从广场撤回我的主页
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        {/* 标签页 */}
        <div className="min-w-0">
          <div className="-mx-4 flex gap-6 overflow-x-auto border-b border-line px-4 no-scrollbar sm:mx-0 sm:px-0" role="tablist">
            {TABS.map((t) => {
              const on = tab === t.id;
              return (
                <button
                  key={t.id}
                  role="tab"
                  aria-selected={on}
                  onClick={() => setParams({ tab: t.id }, { replace: true })}
                  className={cx('relative flex shrink-0 items-center gap-1.5 py-2.5 text-[14.5px] transition-colors', on ? 'font-semibold text-ink' : 'text-ink-3 hover:text-ink')}
                >
                  {t.label}
                  {t.id === 'notifications' && !!user?.unread && <span className="rounded-full bg-accent px-1.5 text-[11px] font-semibold text-white tabular">{user.unread}</span>}
                  {on && <motion.span layoutId="me-tab" transition={spring} className="absolute inset-x-0 -bottom-px h-[2px] bg-ink" />}
                </button>
              );
            })}
          </div>
          <div className="mt-5">
            {tab === 'notifications' && <Notifications onRead={refresh} />}
            {tab === 'connections' && <ContactRequests />}
            {tab === 'favorites' && <Favorites />}
            {tab === 'posts' && <MyPosts scope="mine" />}
            {tab === 'interested' && <MyPosts scope="interested" />}
            {tab === 'settings' && <AccountSettings />}
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={unpub}
        title="从搭子广场撤回主页？"
        desc="撤回后其他同学在广场上看不到你。资料会保留，随时可以重新上传。"
        confirmText="撤回"
        loading={busy}
        onCancel={() => setUnpub(false)}
        onConfirm={async () => {
          setBusy(true);
          try {
            await api.unpublish();
            await Promise.all([load(), refresh()]);
            toast.success('已从广场撤回');
            setUnpub(false);
          } catch (e) {
            toast.error('操作失败', e instanceof ApiError ? e.message : undefined);
          } finally {
            setBusy(false);
          }
        }}
      />
    </div>
  );
}

function Notifications({ onRead }: { onRead: () => void }) {
  const nav = useNavigate();
  const [items, setItems] = useState<NotificationItem[] | null>(null);
  useEffect(() => {
    api.notifications().then((r) => {
      setItems(r.items);
      if (r.items.some((i) => !i.read)) setTimeout(() => api.readAll().then(onRead), 1200);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (!items) return <Skeleton className="h-60 rounded-xl" />;
  if (!items.length) return <Empty title="没有通知" desc="有同学发起匹配请求、处理你的申请、对招募感兴趣，或者内容被管理员处理时，会在这里提醒你。" />;
  return (
    <ul className="overflow-hidden rounded-xl bg-surface">
      {items.map((n, i) => (
        <li key={n.id} className={cx(i > 0 && 'border-t border-line')}>
          <button onClick={() => n.link && nav(n.link)} disabled={!n.link} className="flex w-full gap-3 px-5 py-3.5 text-left transition-colors enabled:hover:bg-surface-2">
            <span className={cx('mt-[9px] size-[7px] shrink-0 rounded-full', n.read ? 'bg-transparent' : 'bg-accent')} aria-label={n.read ? undefined : '未读'} />
            <span className="min-w-0 flex-1">
              <span className="flex items-baseline justify-between gap-3">
                <span className={cx('text-[15px] text-ink', !n.read && 'font-semibold')}>{n.title}</span>
                <span className="shrink-0 text-[12.5px] text-ink-3">{timeAgo(n.createdAt)}</span>
              </span>
              <span className="mt-0.5 block text-[14px] leading-relaxed text-ink-2">{n.body}</span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function Favorites() {
  const nav = useNavigate();
  const [items, setItems] = useState<Card[] | null>(null);
  useEffect(() => {
    api.favorites().then((r) => setItems(r.items));
  }, []);
  if (!items) return <Skeleton className="h-60 rounded-xl" />;
  if (!items.length)
    return (
      <Empty
        art={<Illustration name="mascot-empty" className="mb-4 size-24" />}
        title="还没有收藏"
        desc="在搭子广场遇到合拍的同学，点「收藏」就会出现在这里。"
        action={<Button onClick={() => nav('/square')}>去搭子广场</Button>}
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
  useEffect(() => {
    setItems(null);
    api.posts({ scope }).then((r) => setItems(r.items));
  }, [scope]);
  if (!items) return <Skeleton className="h-60 rounded-xl" />;
  if (!items.length)
    return scope === 'mine' ? (
      <Empty title="还没有发起过招募" desc="比如「雅思口语练习，每周两次」或「数分期末互助」。" action={<Button variant="primary" onClick={() => nav('/events/new')}>发起招募</Button>} />
    ) : (
      <Empty title="还没有感兴趣的活动" desc="去活动大厅看看大家在招募什么。" action={<Button onClick={() => nav('/events')}>去活动大厅</Button>} />
    );
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {items.map((p) => (
        <div key={p.id}>
          {p.takenDown && <p className="mb-1.5 text-[13px] text-danger">这条招募已被管理员撤下{p.takedownReason ? `：${p.takedownReason}` : ''}</p>}
          <PostCard post={p} onOpen={() => nav(`/events/${p.id}`)} onChange={(x) => setItems((xs) => xs!.map((i) => (i.id === p.id ? { ...i, ...x } : i)))} />
        </div>
      ))}
    </div>
  );
}

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
        <p className="mt-1 text-[15px] text-ink">
          {user?.email}
          {user?.role === 'admin' && <Tag tone="brand" className="ml-2">管理员</Tag>}
        </p>
        <p className="mt-1 text-[13.5px] text-ink-3">邮箱用于校园身份验证，不能修改；仅在双方确认交换联系方式后向对方展示。</p>
      </section>

      <section className="rounded-xl bg-surface p-5">
        <h3 className="text-[15px] font-semibold text-ink">登录方式</h3>
        <p className="mt-1 text-[13.5px] text-ink-3">使用学校邮箱和密码登录。修改或忘记密码时，通过学校邮箱验证码重设。</p>
        <Link to={`/login?mode=reset&email=${encodeURIComponent(user?.email ?? '')}&next=${encodeURIComponent('/me?tab=settings')}`} className="mt-3 inline-block text-[14px] text-brand-text underline">通过邮箱重设密码</Link>
      </section>

      <section className="rounded-xl border border-danger/20 bg-surface p-5">
        <h3 className="text-[15px] font-semibold text-ink">注销账号</h3>
        <p className="mt-1 text-[13.5px] leading-relaxed text-ink-3">注销将撤回公开主页和招募内容，撤销登录状态及联系方式交换。操作前请确认已保存需要保留的信息。</p>
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
            toast.success('账号已注销', '公开内容已撤回');
            nav('/', { replace: true });
          } catch (cause) { setError(cause instanceof ApiError ? cause.message : '注销失败，请稍后重试'); }
          finally { setBusy(false); }
        }}>
          <p className="text-[14px] leading-relaxed text-ink-2">此操作会撤回你的公开内容并终止联系方式交换，无法通过撤销按钮恢复。请输入当前密码确认本人操作。</p>
          <Field label="当前密码"><Input type="password" name="password" autoComplete="current-password" aria-label="当前密码" value={password} onChange={(event) => { setPassword(event.target.value); setError(null); }} required disabled={busy} /></Field>
          <label className="flex items-start gap-2 text-[13.5px] text-ink-2"><input type="checkbox" className="mt-1 accent-brand" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} disabled={busy} required /><span>我确认注销账号，并撤回我的公开内容。</span></label>
          {error && <p role="alert" className="text-[13.5px] text-danger">{error}</p>}
          <div className="flex justify-end gap-2"><Button type="button" disabled={busy} onClick={() => { setDeleting(false); setPassword(''); }}>取消</Button><Button type="submit" variant="danger" loading={busy} disabled={!confirmed || !password}>确认注销</Button></div>
        </form>
      </Modal>
    </div>
  );
}
