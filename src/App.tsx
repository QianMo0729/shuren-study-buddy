import { AnimatePresence, motion } from 'motion/react';
import { Suspense, useEffect, useRef, type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation, useParams } from 'react-router';
import { PageBoundary } from './components/PageBoundary';
import { Shell } from './components/Shell';
import { useAuth } from './lib/auth';
import { lazyPage } from './lib/lazyPage';
import { page } from './lib/motion';
import { Landing } from './pages/Landing';
import { Login } from './pages/Login';
import { isStaff } from '../shared/roles';

// 首页与登录页随主包加载；其余页面各自成块，用到时才下载（管理后台、问卷的课程目录、打卡相机的楼栋数据都不小）
const Admin = lazyPage(() => import('./pages/Admin').then((m) => m.Admin));
const Credits = lazyPage(() => import('./pages/Credits').then((m) => m.Credits));
const EditProfile = lazyPage(() => import('./pages/EditProfile').then((m) => m.EditProfile));
const EventDetail = lazyPage(() => import('./pages/EventDetail').then((m) => m.EventDetail));
const EventForm = lazyPage(() => import('./pages/EventForm').then((m) => m.EventForm));
const Me = lazyPage(() => import('./pages/Me').then((m) => m.Me));
const NotFound = lazyPage(() => import('./pages/NotFound').then((m) => m.NotFound));
const ProfilePage = lazyPage(() => import('./pages/ProfilePage').then((m) => m.ProfilePage));
const Privacy = lazyPage(() => import('./pages/Privacy').then((m) => m.Privacy));
const Rules = lazyPage(() => import('./pages/Rules').then((m) => m.Rules));
const Match = lazyPage(() => import('./pages/Match').then((m) => m.Match));
const MatchLater = lazyPage(() => import('./pages/Match').then((m) => m.MatchLater));
const PeopleSearch = lazyPage(() => import('./pages/PeopleSearch').then((m) => m.PeopleSearch));
const Community = lazyPage(() => import('./pages/Community').then((m) => m.Community));
const ForumPostDetail = lazyPage(() => import('./pages/ForumPostDetail').then((m) => m.ForumPostDetail));
const CheckinCamera = lazyPage(() => import('./pages/CheckinCamera').then((m) => m.CheckinCamera));
const CheckinDetail = lazyPage(() => import('./pages/CheckinDetail').then((m) => m.CheckinDetail));
const Messages = lazyPage(() => import('./pages/Messages').then((m) => m.Messages));
const Today = lazyPage(() => import('./pages/Today').then((m) => m.Today));

/** 底部导航的四个分区与「我的」：登录后趁空闲取回来，切换时不用等 */
const MAIN_PAGES = [Today, Match, Community, Messages, Me];

// 直接打开某个分区时，主包一执行就开始取它的分块，不等登录状态返回
({ today: Today, match: Match, community: Community, messages: Messages, me: Me } as Record<string, { preload: () => void }>)[
  window.location.pathname.split('/')[1]
]?.preload();

function RequireAuth({ children, admin }: { children: ReactNode; admin?: boolean }) {
  const { user, loading } = useAuth();
  const loc = useLocation();
  if (loading) return <BootScreen />;
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
  if (admin && !isStaff(user.role)) return <Navigate to="/today" replace />;
  return <>{children}</>;
}

function BootScreen() {
  return (
    <div className="grid min-h-dvh place-items-center">
      <motion.div
        className="flex gap-1.5"
        initial="a"
        animate="b"
        variants={{ b: { transition: { staggerChildren: 0.12, repeat: Infinity } } }}
      >
        {[0, 1, 2].map((i) => (
          <motion.span
            key={i}
            className="size-2 rounded-full bg-brand-3"
            animate={{ opacity: [0.25, 1, 0.25], y: [0, -4, 0] }}
            transition={{ duration: 0.9, repeat: Infinity, delay: i * 0.12 }}
          />
        ))}
      </motion.div>
    </div>
  );
}

/** 旧版“搭子广场”链接：/square → 匹配推荐，/square/u/:id → 独立主页 */
function LegacySquare() {
  const { '*': rest } = useParams();
  const id = /^u\/(\d+)/.exec(rest ?? '')?.[1];
  return <Navigate to={id ? `/u/${id}` : '/match'} replace />;
}

/** 页面级转场：按一级路径切换，同一分区内（如匹配页打开主页浮层、私聊切换会话）不触发整页转场 */
function Page({ children }: { children: ReactNode }) {
  return (
    <motion.div variants={page} initial="initial" animate="enter" exit="exit">
      <PageBoundary>
        <Suspense fallback={<BootScreen />}>{children}</Suspense>
      </PageBoundary>
    </motion.div>
  );
}

export function App() {
  const location = useLocation();
  const section = location.pathname.split('/')[1] || 'home';
  const { user } = useAuth();

  // 已登录（或正在登录页，登录后就会进入「今天」）时，等浏览器空闲再预取主要分区
  const warm = !!user || section === 'login';
  useEffect(() => {
    if (!warm) return;
    const timer = window.setTimeout(() => MAIN_PAGES.forEach((p) => p.preload()), 1500);
    return () => window.clearTimeout(timer);
  }, [warm]);

  // 进入新的分区时回到顶部；同一分区内（匹配页打开主页浮层、私聊切换会话）保持滚动位置
  const previousSection = useRef(section);
  useEffect(() => {
    const stay = previousSection.current === section && (section === 'match' || section === 'messages');
    previousSection.current = section;
    if (!stay) window.scrollTo({ top: 0 });
  }, [location.pathname, section]);

  const bare = section === 'home' || section === 'login' || section === 'credits' || section === 'privacy' || section === 'rules';

  const routes = (
    <AnimatePresence mode="wait" initial={false}>
      <Routes location={location} key={section === 'match' || section === 'messages' ? section : location.pathname}>
        <Route path="/" element={<Page><Landing /></Page>} />
        <Route path="/login" element={<Page><Login /></Page>} />
        <Route path="/privacy" element={<Page><Privacy /></Page>} />
        <Route path="/rules" element={<Page><Rules /></Page>} />
        <Route path="/credits" element={<Page><Credits /></Page>} />
        <Route path="/square/*" element={<LegacySquare />} />
        <Route path="/today" element={<RequireAuth><Page><Today /></Page></RequireAuth>} />
        <Route path="/match/search/*" element={<RequireAuth><Page><PeopleSearch /></Page></RequireAuth>} />
        <Route path="/match/later/*" element={<RequireAuth><Page><MatchLater /></Page></RequireAuth>} />
        <Route path="/match/*" element={<RequireAuth><Page><Match /></Page></RequireAuth>} />
        <Route path="/community" element={<RequireAuth><Page><Community /></Page></RequireAuth>} />
        <Route path="/community/posts/:id" element={<RequireAuth><Page><ForumPostDetail /></Page></RequireAuth>} />
        <Route path="/community/checkin/new" element={<RequireAuth><Page><CheckinCamera /></Page></RequireAuth>} />
        <Route path="/community/checkins/:id" element={<RequireAuth><Page><CheckinDetail /></Page></RequireAuth>} />
        <Route path="/messages" element={<RequireAuth><Page><Messages /></Page></RequireAuth>} />
        <Route path="/messages/:matchId" element={<RequireAuth><Page><Messages /></Page></RequireAuth>} />
        <Route path="/u/:id" element={<RequireAuth><Page><ProfilePage /></Page></RequireAuth>} />
        <Route path="/me" element={<RequireAuth><Page><Me /></Page></RequireAuth>} />
        <Route path="/me/edit" element={<RequireAuth><Page><EditProfile /></Page></RequireAuth>} />
        <Route path="/events" element={<Navigate to="/community?tab=events" replace />} />
        <Route path="/events/new" element={<RequireAuth><Page><EventForm /></Page></RequireAuth>} />
        <Route path="/events/:id/edit" element={<RequireAuth><Page><EventForm /></Page></RequireAuth>} />
        <Route path="/events/:id" element={<RequireAuth><Page><EventDetail /></Page></RequireAuth>} />
        <Route path="/admin" element={<RequireAuth admin><Page><Admin /></Page></RequireAuth>} />
        <Route path="*" element={<Page><NotFound /></Page>} />
      </Routes>
    </AnimatePresence>
  );

  return bare ? routes : <Shell>{routes}</Shell>;
}
