import { useEffect, useState, type ReactNode } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router';
import type { BuddyStatus } from '../../shared/types';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { cx } from '../lib/format';
import { Plate } from './brand';
import { BackChevron, BubbleIcon, CommunityIcon, PeopleIcon, ShieldIcon, TodayIcon } from './icons';
import { ROLE_LABELS, isStaff } from '../../shared/roles';

type NavItem = { to: string; label: string; icon: (p: { size?: number }) => ReactNode; also?: string[]; badge?: boolean };
/** 四个分区：今天、找搭子、社区、消息。「我的」在右上角头像里 */
export const NAV: NavItem[] = [
  { to: '/today', label: '今天', icon: TodayIcon, also: ['/buddy'] },
  { to: '/match', label: '找搭子', icon: PeopleIcon, also: ['/u/'] },
  { to: '/community', label: '社区', icon: CommunityIcon, also: ['/events'] },
  { to: '/messages', label: '消息', icon: BubbleIcon, badge: true },
];
const ADMIN: NavItem = { to: '/admin', label: '管理后台', icon: ShieldIcon };
// 按路径段匹配，避免 /messages 被当成 /me 的子路径；以 / 结尾的前缀（如 /u/）按普通前缀匹配
const isActive = (item: NavItem, path: string) =>
  [item.to, ...(item.also ?? [])].some((prefix) => (prefix.endsWith('/') ? path.startsWith(prefix) : path === prefix || path.startsWith(`${prefix}/`)));

/** 手机端显示底部标签栏的页面；其余页面是从这些页面点进去的，顶部显示返回 */
const TAB_ROOTS = new Set(['/today', '/match', '/match/later', '/community', '/messages']);
export const isTabRoot = (path: string) => TAB_ROOTS.has(path.replace(/\/+$/, '') || '/');
/** 自带顶栏的页面（聊天窗、我的、我的搭子、拍照打卡），手机端不再叠一层返回栏 */
const hasOwnBar = (path: string) => /^\/(messages\/[^/]+|me|buddy|community\/checkin\/new)\/?$/.test(path);

/** 未读角标：私聊未读 + 通知未读（通知在消息页第一行） */
export const useBadge = () => {
  const { user } = useAuth();
  return (user?.unreadMessages ?? 0) + (user?.unread ?? 0);
};

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
    // --topbar-h / --tabbar-space：固定在顶栏下、标签栏上的元素（聊天窗、滑卡按钮）按这两个值让位
    <div
      className={cx(
        'min-h-dvh md:flex md:[--tabbar-space:0px] md:[--topbar-h:0px]',
        bar ? '[--topbar-h:44px]' : '[--topbar-h:0px]',
        root ? '[--tabbar-space:calc(90px+env(safe-area-inset-bottom))]' : '[--tabbar-space:env(safe-area-inset-bottom)]',
      )}
    >
      <Sidebar />
      <div className="min-w-0 md:flex-1">
        {bar && <BackBar />}
        <main className="mx-auto w-full max-w-[1120px] px-4 pb-[calc(var(--tabbar-space)+20px)] md:px-10 md:pb-12">{children}</main>
      </div>
      {root && <TabBar />}
    </div>
  );
}

/** 头像：本人的图版（没有上传照片时按昵称显示物种博物画） */
export function MeAvatar({ className }: { className?: string }) {
  const { user } = useAuth();
  const name = user?.nickname ?? (user && isStaff(user.role) ? ROLE_LABELS[user.role] : '新同学');
  return <Plate nickname={name} className={cx('overflow-hidden rounded-full bg-mat', className)} pad="0" fit="cover" />;
}

/** 返回上一页；直接打开链接（没有上一页）时回到 fallback */
export function useBack(fallback: string) {
  const nav = useNavigate();
  return () => (window.history.state?.idx > 0 ? nav(-1) : nav(fallback));
}

/** 手机端二级页面的顶栏：「‹ 所属分区」，右侧可放一个文字按钮 */
export function NavBar({ label, to, right, className }: { label?: string; to?: string; right?: ReactNode; className?: string }) {
  const loc = useLocation();
  // 「我的」里的分页返回「我的」；其余返回所属分区
  const section = loc.pathname.startsWith('/me/') ? { to: '/me', label: '我的' } : NAV.find((n) => isActive(n, loc.pathname)) ?? NAV[0];
  const back = useBack(to ?? section.to);
  return (
    <div className={cx('flex h-11 items-center justify-between', className)}>
      <button type="button" onClick={back} className="-ml-2 flex h-11 items-center gap-1 px-2 text-[17px] text-brand-text active:opacity-50">
        <BackChevron />
        {label ?? section.label}
      </button>
      {right}
    </div>
  );
}

function BackBar() {
  return (
    <header className="glass sticky top-0 z-40 px-4 md:hidden">
      <NavBar />
    </header>
  );
}

/** 桌面端左侧边栏：分区导航、我的搭子快捷入口、本人 */
function Sidebar() {
  const { user } = useAuth();
  const loc = useLocation();
  const badge = useBadge();
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

  return (
    <aside className="sticky top-0 hidden h-dvh w-[232px] shrink-0 flex-col gap-[22px] bg-[#ECEBE5] px-3.5 py-6 md:flex dark:bg-paper-2">
      <Link to="/today" className="flex items-center gap-2.5 px-2.5 text-ink">
        {/* 树仁书院院徽：浅色用绿盾，深色用白盾 */}
        <img src="/assets/brand/shield.png" alt="" width={378} height={400} className="h-7 w-auto dark:hidden" />
        <img src="/assets/brand/shield-white.png" alt="" width={378} height={400} className="hidden h-7 w-auto opacity-85 dark:block" />
        <span className="text-[17px] font-bold">树仁搭子</span>
      </Link>
      <nav aria-label="主导航" className="flex flex-col gap-0.5">
        {links.map((l) => {
          const active = isActive(l, loc.pathname);
          const n = l.badge ? badge : 0;
          return (
            <NavLink
              key={l.to}
              to={l.to}
              aria-current={active ? 'page' : undefined}
              className={cx('flex h-9 items-center gap-2.5 rounded-[9px] px-2.5 text-[15px]', active ? 'bg-[#DCE7E6] font-semibold text-brand-text dark:bg-brand-soft' : 'text-ink hover:bg-ink/[.05]')}
            >
              <l.icon size={20} />
              <span className="flex-1">{l.label}</span>
              {n > 0 && <span className="grid h-5 min-w-5 place-items-center rounded-full bg-accent px-1.5 text-[12px] font-semibold text-white tabular">{n > 99 ? '99+' : n}</span>}
            </NavLink>
          );
        })}
      </nav>
      {buddy && (
        <div className="flex flex-col gap-0.5">
          <p className="px-2.5 pb-1 text-[12px] font-semibold text-ink-3">我的搭子</p>
          <Link to="/buddy" className="flex h-10 items-center gap-2.5 rounded-[9px] px-2.5 text-[15px] text-ink hover:bg-ink/[.05]">
            <Plate nickname={buddy.partner.nickname} photo={buddy.partner.cover} className="size-6 shrink-0 overflow-hidden rounded-full bg-mat" pad="0" fit="cover" />
            <span className="truncate">{buddy.partner.nickname}</span>
          </Link>
        </div>
      )}
      {user && (
        <Link to="/me" className="mt-auto flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-ink hover:bg-ink/[.05]">
          <MeAvatar className="size-8 shrink-0" />
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-[14px] font-semibold">{name}</span>
            <span className="text-[12px] text-ink-3">设置与资料</span>
          </span>
        </Link>
      )}
    </aside>
  );
}

/** 手机端底部标签栏：悬浮的半透明胶囊 */
function TabBar() {
  const loc = useLocation();
  const badge = useBadge();
  return (
    <nav
      aria-label="主导航"
      className="fixed inset-x-4 bottom-[max(14px,calc(env(safe-area-inset-bottom)-6px))] z-50 mx-auto grid h-[62px] max-w-[430px] grid-cols-4 rounded-full bg-white/78 px-1.5 shadow-[0_8px_28px_rgba(28,35,32,0.12),inset_0_0_0_0.5px_rgba(28,35,32,0.08)] backdrop-blur-[20px] backdrop-saturate-[1.6] md:hidden dark:bg-paper-2/80"
    >
      {NAV.map((t) => {
        const active = isActive(t, loc.pathname);
        const n = t.badge ? badge : 0;
        return (
          <NavLink
            key={t.to}
            to={t.to}
            aria-current={active ? 'page' : undefined}
            aria-label={n ? `${t.label}，${n} 条未读` : undefined}
            className={cx('relative flex flex-col items-center justify-center gap-[3px] text-[10px] font-semibold', active ? 'text-brand-text' : 'text-ink-3')}
          >
            <t.icon size={24} />
            {t.label}
            {n > 0 && (
              <span className="absolute top-2 left-1/2 ml-1.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full border-2 border-white bg-accent px-[5px] text-[11px] font-semibold text-white tabular">
                {n > 99 ? '99+' : n}
              </span>
            )}
          </NavLink>
        );
      })}
    </nav>
  );
}
