import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useRef, type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation, useParams } from 'react-router';
import { Shell } from './components/Shell';
import { useAuth } from './lib/auth';
import { page } from './lib/motion';
import { Admin } from './pages/Admin';
import { Credits } from './pages/Credits';
import { EditProfile } from './pages/EditProfile';
import { EventDetail } from './pages/EventDetail';
import { EventForm } from './pages/EventForm';
import { Landing } from './pages/Landing';
import { Login } from './pages/Login';
import { Me } from './pages/Me';
import { NotFound } from './pages/NotFound';
import { ProfilePage } from './pages/ProfilePage';
import { Privacy } from './pages/Privacy';
import { Match } from './pages/Match';
import { Community } from './pages/Community';
import { ForumPostDetail } from './pages/ForumPostDetail';
import { CheckinCamera } from './pages/CheckinCamera';
import { CheckinDetail } from './pages/CheckinDetail';
import { Messages } from './pages/Messages';

function RequireAuth({ children, admin, questionnaire }: { children: ReactNode; admin?: boolean; questionnaire?: boolean }) {
  const { user, loading } = useAuth();
  const loc = useLocation();
  if (loading) return <BootScreen />;
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
  if (admin && user.role !== 'admin') return <Navigate to="/match" replace />;
  if (questionnaire && !user.questionnaireComplete) return <Navigate to="/me/edit?onboarding=1" replace />;
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
      {children}
    </motion.div>
  );
}

export function App() {
  const location = useLocation();
  const section = location.pathname.split('/')[1] || 'home';

  // 进入新的分区时回到顶部；同一分区内（匹配页打开主页浮层、私聊切换会话）保持滚动位置
  const previousSection = useRef(section);
  useEffect(() => {
    const stay = previousSection.current === section && (section === 'match' || section === 'messages');
    previousSection.current = section;
    if (!stay) window.scrollTo({ top: 0 });
  }, [location.pathname, section]);

  const bare = section === 'home' || section === 'login' || section === 'credits' || section === 'privacy';

  const routes = (
    <AnimatePresence mode="wait" initial={false}>
      <Routes location={location} key={section === 'match' || section === 'messages' ? section : location.pathname}>
        <Route path="/" element={<Page><Landing /></Page>} />
        <Route path="/login" element={<Page><Login /></Page>} />
        <Route path="/privacy" element={<Page><Privacy /></Page>} />
        <Route path="/credits" element={<Page><Credits /></Page>} />
        <Route path="/square/*" element={<LegacySquare />} />
        <Route path="/match/*" element={<RequireAuth questionnaire><Page><Match /></Page></RequireAuth>} />
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
