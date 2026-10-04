import { AnimatePresence, motion } from 'motion/react';
import { useEffect, type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router';
import { Shell } from './components/Shell';
import { useAuth } from './lib/auth';
import { page } from './lib/motion';
import { Admin } from './pages/Admin';
import { Credits } from './pages/Credits';
import { EditProfile } from './pages/EditProfile';
import { EventDetail } from './pages/EventDetail';
import { EventForm } from './pages/EventForm';
import { Events } from './pages/Events';
import { Landing } from './pages/Landing';
import { Login } from './pages/Login';
import { Me } from './pages/Me';
import { NotFound } from './pages/NotFound';
import { ProfilePage } from './pages/ProfilePage';
import { Privacy } from './pages/Privacy';
import { Square } from './pages/Square';

function RequireAuth({ children, admin, questionnaire }: { children: ReactNode; admin?: boolean; questionnaire?: boolean }) {
  const { user, loading } = useAuth();
  const loc = useLocation();
  if (loading) return <BootScreen />;
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
  if (admin && user.role !== 'admin') return <Navigate to="/square" replace />;
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

/** 页面级转场：按一级路径切换，广场内打开主页浮层不触发整页转场 */
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

  useEffect(() => {
    if (section !== 'square') window.scrollTo({ top: 0 });
  }, [location.pathname, section]);

  const bare = section === 'home' || section === 'login' || section === 'credits' || section === 'privacy';

  const routes = (
    <AnimatePresence mode="wait" initial={false}>
      <Routes location={location} key={section === 'square' ? 'square' : location.pathname}>
        <Route path="/" element={<Page><Landing /></Page>} />
        <Route path="/login" element={<Page><Login /></Page>} />
        <Route path="/privacy" element={<Page><Privacy /></Page>} />
        <Route path="/credits" element={<Page><Credits /></Page>} />
        <Route path="/square/*" element={<RequireAuth questionnaire><Page><Square /></Page></RequireAuth>} />
        <Route path="/u/:id" element={<RequireAuth><Page><ProfilePage /></Page></RequireAuth>} />
        <Route path="/me" element={<RequireAuth><Page><Me /></Page></RequireAuth>} />
        <Route path="/me/edit" element={<RequireAuth><Page><EditProfile /></Page></RequireAuth>} />
        <Route path="/events" element={<RequireAuth><Page><Events /></Page></RequireAuth>} />
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
