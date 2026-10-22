import { useEffect, useState, type ReactNode } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router';
import { CalendarDays, ChevronLeft, MessageCircle, MessagesSquare, Shield, UsersRound } from 'lucide-react';
import type { BuddyStatus } from '../../shared/types';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { cx } from '../lib/format';
import { Logo, Plate } from './brand';
import { ROLE_LABELS, isStaff } from '../../shared/roles';

type NavItem = { to: string; label: string; icon: typeof CalendarDays; also?: string[]; badge?: 'messages' };
/** 四个分区：今天（搭子与打卡）、找搭子、社区、消息。「我的」放在头像里 */
export const NAV: NavItem[] = [
  { to: '/today', label: '今天', icon: CalendarDays },
  { to: '/match', label: '找搭子', icon: UsersRound, also: ['/u/'] },
  { to: '/community', label: '社区', icon: MessagesSquare, also: ['/events'] },
  { to: '/messages', label: '消息', icon: MessageCircle, badge: 'messages' },
];
const ADMIN: NavItem = { to: '/admin', label: '管理后台', icon: Shield };
// 按路径段匹配，避免 /messages 被当成 /me 的子路径；以 / 结尾的前缀（如 /u/）按普通前缀匹配
const isActive = (item: NavItem, path: string) =>
  [item.to, ...(item.also ?? [])].some((prefix) => (prefix.endsWith('/') ? path.startsWith(prefix) : path === prefix || path.startsWith(`${prefix}/`)));

/** 手机端显示底部标签栏的页面；其余页面是从这些页面点进去的，顶部显示返回 */
const TAB_ROOTS = new Set(['/today', '/match', '/match/search', '/match/later', '/community', '/messages']);
export const isTabRoot = (path: string) => TAB_ROOTS.has(path.replace(/\/+$/, '') || '/');
/** 自带顶栏和返回按钮的页面（聊天窗），手机端不再叠一层返回栏 */
const hasOwnBar = (path: string) => /^\/messages\/[^/]+\/?$/.test(path);

export function Shell({ children }: { children: ReactNode }) {
  const { user, refresh } = useAuth();
  const loc = useLocation();
  const root = isTabRoot(loc.pathname);
  const bar = !root && !hasOwnBar(loc.pathname);

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
    // --topbar-h / --tabbar-space：固定在顶栏下、标签栏上的元素（聊天窗、滑卡按钮、发帖按钮）按这两个值让位
    <div
      className={cx(
        'min-h-dvh md:flex md:[--tabbar-space:0px] md:[--topbar-h:0px]',
        bar ? '[--topbar-h:52px]' : '[--topbar-h:0px]',
        root ? '[--tabbar-space:calc(86px+env(safe-area-inset-bottom))]' : '[--tabbar-space:env(safe-area-inset-bottom)]',
      )}
    >
      <Sidebar />
      <div className="min-w-0 md:flex-1">
        {bar && <BackBar />}
        <main className="mx-auto w-full max-w-[1120px] px-4 pb-[calc(var(--tabbar-space)+24px)] sm:px-6 md:pb-12 lg:px-10">{children}</main>
      </div>
      {root && <TabBar />}
    </div>
  );
}

/** 头像：本人的图版（没有上传照片时按昵称显示物种博物画） */
export function MeAvatar({ className }: { className?: string }) {
  const { user } = useAuth();
  const name = user?.nickname ?? (user && isStaff(user.role) ? ROLE_LABELS[user.role] : '新同学');
  return <Plate nickname={name} className={cx('overflow-hidden rounded-full bg-mat', className)} pad="8%" />;
}

/** 桌面端左侧边栏：分区导航、我的搭子快捷入口、本人 */
function Sidebar() {
  const { user } = useAuth();
  const loc = useLocation();
  const [buddy, setBuddy] = useState<BuddyStatus['pair']>(null);
  const signedIn = !!user;
  useEffect(() => {
    if (!signedIn) return;
    let live = true;
    api.activity.me().then((s) => { if (live) setBuddy(s.pair); }).catch(() => {});
    return () => { live = false; };
  }, [signedIn]);
  const links = isStaff(user?.role) ? [...NAV, ADMIN] : NAV;
  const name = user?.nickname ?? (user && isStaff(user.role) ? ROLE_LABELS[user.role] : '新同学');
  const badge = (user?.unreadMessages ?? 0) + (user?.unread ?? 0);

  return (
    <aside className="sticky top-0 hidden h-dvh w-[248px] shrink-0 flex-col gap-6 border-r border-line bg-paper-2/60 px-3.5 py-6 md:flex">
      <Link to="/today" aria-label="树仁搭子" className="px-2.5">
        <Logo />
      </Link>
      <nav aria-label="主导航" className="flex flex-col gap-0.5">
        {links.map((l) => {
          const active = isActive(l, loc.pathname);
          const n = l.badge === 'messages' ? badge : 0;
          return (
            <NavLink
              key={l.to}
              to={l.to}
              aria-current={active ? 'page' : undefined}
              className={cx('flex h-10 items-center gap-3 rounded-[10px] px-2.5 text-[15px] transition-colors', active ? 'bg-brand-soft font-semibold text-brand-text' : 'text-ink hover:bg-ink/[.05]')}
            >
              <l.icon size={19} strokeWidth={active ? 2.1 : 1.8} aria-hidden />
              <span className="flex-1">{l.label}</span>
              {n > 0 && <span className="grid h-5 min-w-5 place-items-center rounded-full bg-accent px-1.5 text-[11.5px] font-semibold text-white tabular" aria-label={`${n} 条未读`}>{n > 99 ? '99+' : n}</span>}
            </NavLink>
          );
        })}
      </nav>
      {buddy && (
        <div className="flex flex-col gap-0.5">
          <p className="px-2.5 pb-1 text-[12px] font-semibold text-ink-3">我的搭子</p>
          <Link to="/today" className="flex h-10 items-center gap-2.5 rounded-[10px] px-2.5 text-[15px] text-ink hover:bg-ink/[.05]">
            <Plate nickname={buddy.partner.nickname} photo={buddy.partner.cover} className="size-6 shrink-0 overflow-hidden rounded-full bg-mat" pad="8%" />
            <span className="truncate">{buddy.partner.nickname}</span>
          </Link>
        </div>
      )}
      {user && (
        <Link to="/me" className={cx('mt-auto flex items-center gap-2.5 rounded-xl px-2.5 py-2 hover:bg-ink/[.05]', loc.pathname.startsWith('/me') && 'bg-ink/[.05]')}>
          <MeAvatar className="size-8 shrink-0" />
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-[14px] font-semibold text-ink">{name}</span>
            <span className="text-[12px] text-ink-3">设置与资料</span>
          </span>
        </Link>
      )}
    </aside>
  );
}

/** 手机端二级页面的顶栏：返回上一页；直接打开链接时回到所属分区 */
function BackBar() {
  const nav = useNavigate();
  const loc = useLocation();
  const section = NAV.find((n) => isActive(n, loc.pathname))?.to ?? '/today';
  return (
    <header className="glass sticky top-0 z-40 flex h-[52px] items-center border-b border-line px-2 md:hidden">
      <button
        type="button"
        onClick={() => (window.history.state?.idx > 0 ? nav(-1) : nav(section))}
        className="flex h-11 items-center gap-0.5 rounded-lg pr-3 pl-1 text-[17px] text-brand-text active:opacity-60"
      >
        <ChevronLeft size={26} strokeWidth={2.2} aria-hidden />
        返回
      </button>
    </header>
  );
}

/** 手机端底部标签栏：悬浮的半透明胶囊，只做导航 */
function TabBar() {
  const { user } = useAuth();
  const loc = useLocation();
  const badge = (user?.unreadMessages ?? 0) + (user?.unread ?? 0);
  return (
    <nav aria-label="主导航" className="fixed inset-x-4 bottom-[calc(env(safe-area-inset-bottom)+12px)] z-50 mx-auto max-w-md md:hidden">
      <div className="glass grid h-[62px] grid-cols-4 rounded-full px-1.5 shadow-[0_8px_28px_rgba(28,35,32,0.14)] ring-1 ring-line">
        {NAV.map((t) => {
          const active = isActive(t, loc.pathname);
          const n = t.badge === 'messages' ? badge : 0;
          return (
            <NavLink
              key={t.to}
              to={t.to}
              aria-current={active ? 'page' : undefined}
              aria-label={n ? `${t.label}，${n} 条未读` : undefined}
              className={cx('relative flex flex-col items-center justify-center gap-[3px] rounded-full active:scale-95 motion-safe:transition-transform', active ? 'text-brand-text' : 'text-ink-3')}
            >
              <t.icon size={23} strokeWidth={active ? 2.1 : 1.7} aria-hidden />
              <span className="text-[10.5px] font-semibold">{t.label}</span>
              {n > 0 && <span className="absolute top-1.5 left-1/2 ml-1.5 grid h-[18px] min-w-[18px] place-items-center rounded-full border-2 border-paper bg-accent px-1 text-[10.5px] font-semibold text-white tabular">{n > 99 ? '99+' : n}</span>}
            </NavLink>
          );
        })}
      </div>
    </nav>
  );
}
