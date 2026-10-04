import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router';
import { Bell, Camera, LogOut, Megaphone, MessageCircle, MessagesSquare, PenLine, Shield, Sparkles, UserRound } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { useToast } from '../lib/toast';
import { cx } from '../lib/format';
import { ease, spring } from '../lib/motion';
import { Logo } from './brand';

type NavItem = { to: string; label: string; short: string; icon: typeof Sparkles; also?: string[]; badge?: 'messages' };
const NAV: NavItem[] = [
  { to: '/match', label: '匹配推荐', short: '匹配', icon: Sparkles, also: ['/u/'] },
  { to: '/community', label: '校园社区', short: '社区', icon: MessagesSquare, also: ['/events'] },
  { to: '/messages', label: '私聊', short: '私聊', icon: MessageCircle, badge: 'messages' },
  { to: '/me', label: '我的', short: '我的', icon: UserRound },
];
const ADMIN: NavItem = { to: '/admin', label: '管理后台', short: '管理', icon: Shield };
// 按路径段匹配，避免 /messages 被当成 /me 的子路径；以 / 结尾的前缀（如 /u/）按普通前缀匹配
const isActive = (item: NavItem, path: string) =>
  [item.to, ...(item.also ?? [])].some((prefix) => (prefix.endsWith('/') ? path.startsWith(prefix) : path === prefix || path.startsWith(`${prefix}/`)));

export function Shell({ children }: { children: ReactNode }) {
  const { user, refresh } = useAuth();
  const loc = useLocation();

  // 切换页面时顺便刷新未读数；页面可见时每 30 秒刷新一次私聊未读角标
  useEffect(() => {
    if (user) refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loc.pathname]);
  const signedIn = !!user;
  useEffect(() => {
    if (!signedIn) return;
    const timer = setInterval(() => { if (document.visibilityState === 'visible') void refresh(); }, 30_000);
    return () => clearInterval(timer);
  }, [signedIn, refresh]);

  return (
    <div className="min-h-dvh">
      <TopBar />
      <main className="mx-auto w-full max-w-[1200px] px-4 pb-28 sm:px-6 md:pb-24 lg:px-10">{children}</main>
      <TabBar />
    </div>
  );
}

function TopBar() {
  const { user } = useAuth();
  const loc = useLocation();
  const links = user?.role === 'admin' ? [...NAV, ADMIN] : NAV;

  return (
    <header className="glass sticky top-0 z-40 border-b border-line">
      <div className="mx-auto flex h-14 max-w-[1200px] items-center gap-10 px-4 sm:px-6 lg:px-10">
        <Link to="/match" aria-label="树仁搭子">
          <Logo />
        </Link>
        <nav className="hidden h-full items-stretch gap-7 md:flex">
          {links.map((l) => {
            const active = isActive(l, loc.pathname);
            const badge = l.badge === 'messages' ? user?.unreadMessages ?? 0 : 0;
            return (
              <NavLink key={l.to} to={l.to} className={cx('relative flex items-center gap-1.5 text-[14.5px] transition-colors', active ? 'text-ink' : 'text-ink-3 hover:text-ink')}>
                {l.label}
                {badge > 0 && <span className="grid h-4 min-w-4 place-items-center rounded-full bg-accent px-1 text-[10px] font-semibold text-white tabular" aria-label={`${badge} 条未读私聊`}>{badge > 99 ? '99+' : badge}</span>}
                {active && <motion.span layoutId="nav-underline" transition={spring} className="absolute inset-x-0 -bottom-px h-[2px] bg-ink" />}
              </NavLink>
            );
          })}
        </nav>
        <div className="ml-auto flex items-center gap-1">
          <Link
            to="/me?tab=notifications"
            className="relative grid size-10 place-items-center rounded-lg text-ink-2 transition-colors hover:bg-ink/[.05] hover:text-ink"
            aria-label={user?.unread ? `通知，${user.unread} 条未读` : '通知'}
          >
            <Bell size={18} strokeWidth={1.8} />
            <AnimatePresence>
              {!!user?.unread && (
                <motion.span
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  exit={{ scale: 0 }}
                  transition={spring}
                  className="absolute top-1.5 right-1 grid h-4 min-w-4 place-items-center rounded-full bg-accent px-1 text-[10px] font-semibold text-white tabular"
                >
                  {user.unread > 99 ? '99+' : user.unread}
                </motion.span>
              )}
            </AnimatePresence>
          </Link>
          <UserMenu />
        </div>
      </div>
    </header>
  );
}

function UserMenu() {
  const { user, logout } = useAuth();
  const toast = useToast();
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const on = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener('pointerdown', on);
    return () => window.removeEventListener('pointerdown', on);
  }, [open]);
  if (!user) return null;
  const name = user.nickname ?? (user.role === 'admin' ? '管理员' : '新同学');
  return (
    <div ref={ref} className="relative hidden md:block">
      <button onClick={() => setOpen((v) => !v)} className="flex h-10 items-center gap-2.5 rounded-lg px-2.5 transition-colors hover:bg-ink/[.05]" aria-expanded={open}>
        <span className="max-w-32 truncate text-[14px] text-ink-2">{name}</span>
        <span className="grid size-7 place-items-center rounded-[5px] bg-ink font-display text-[13px] text-paper">{name.slice(0, 1)}</span>
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4, transition: { duration: 0.12 } }}
            transition={{ duration: 0.18, ease }}
            className="absolute top-12 right-0 w-60 overflow-hidden rounded-xl border border-line bg-surface shadow-lg"
          >
            <div className="border-b border-line px-4 py-3">
              <p className="text-[14px] font-semibold text-ink">{name}</p>
              <p className="mt-0.5 truncate text-[12.5px] text-ink-3">{user.email}</p>
            </div>
            <div className="p-1.5">
              {[
                { label: '我的设置', icon: UserRound, to: '/me' },
                { label: '编辑问卷与资料', icon: PenLine, to: '/me/edit' },
                { label: '拍照打卡', icon: Camera, to: '/community/checkin/new' },
                { label: '发起招募', icon: Megaphone, to: '/events/new' },
                ...(user.role === 'admin' ? [{ label: '管理后台', icon: Shield, to: '/admin' }] : []),
              ].map((i) => (
                <button
                  key={i.to}
                  onClick={() => {
                    setOpen(false);
                    nav(i.to);
                  }}
                  className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[14px] text-ink-2 hover:bg-paper-2 hover:text-ink"
                >
                  <i.icon size={16} strokeWidth={1.8} /> {i.label}
                </button>
              ))}
            </div>
            <div className="border-t border-line p-1.5">
              <button
                onClick={async () => {
                  try { await logout(); nav('/'); } catch (e) { toast.error('退出失败', e instanceof Error ? e.message : undefined); }
                }}
                className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[14px] text-ink-3 hover:bg-danger-soft hover:text-danger"
              >
                <LogOut size={16} strokeWidth={1.8} /> 退出登录
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** 移动端底部标签栏：只做导航（发布类操作放在各页面里） */
function TabBar() {
  const { user } = useAuth();
  const loc = useLocation();
  const tabs = user?.role === 'admin' ? [...NAV, ADMIN] : NAV;
  return (
    <nav className="fixed inset-x-0 bottom-0 z-50 border-t border-line bg-paper/95 backdrop-blur-md md:hidden safe-bottom">
      <div className="mx-auto flex h-[58px] max-w-md items-stretch justify-around">
        {tabs.map((t) => {
          const active = isActive(t, loc.pathname);
          const badge = t.badge === 'messages' ? user?.unreadMessages ?? 0 : 0;
          return (
            <NavLink key={t.to} to={t.to} className="relative flex min-w-16 flex-col items-center justify-center gap-[3px]" aria-label={badge ? `${t.short}，${badge} 条未读` : undefined}>
              <t.icon size={22} strokeWidth={active ? 2.1 : 1.6} className={active ? 'text-brand' : 'text-ink-3'} />
              <span className={cx('text-[11px]', active ? 'font-semibold text-brand' : 'text-ink-3')}>{t.short}</span>
              {badge > 0 && <span className="absolute top-1.5 left-1/2 ml-1.5 grid h-4 min-w-4 place-items-center rounded-full bg-accent px-1 text-[10px] font-semibold text-white tabular">{badge > 99 ? '99+' : badge}</span>}
            </NavLink>
          );
        })}
      </div>
    </nav>
  );
}
