import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { MotionConfig, MotionGlobalConfig } from 'motion/react';
import './styles.css';

// 网页字体（按 unicode-range 切片、按需加载、本地托管，不依赖境外 CDN）。
// 字体声明较长，异步加载，避免阻塞首屏；加载完成前先用系统字体显示。
import('./fonts/misans.css');
import('@chinese-fonts/dymh/dist/DouyinSansBold/result.css');
import('@fontsource/source-sans-3/400-italic.css');
import { App } from './App';
import { AuthProvider } from './lib/auth';
import { ToastProvider } from './lib/toast';

// 仅开发调试：localStorage.setItem('dz-skip-anim', '1') 可跳过所有动效（便于自动化测试）
if (import.meta.env.DEV) {
  try {
    if (localStorage.getItem('dz-skip-anim')) MotionGlobalConfig.skipAnimations = true;
  } catch {}
}

// Keep the existing page routes/providers; a data router enables reliable SPA
// navigation blocking for an imported timetable awaiting explicit confirmation.
const router = createBrowserRouter([{
  path: '*',
  element: <MotionConfig reducedMotion="user">
    <ToastProvider>
      <AuthProvider>
        <App />
      </AuthProvider>
    </ToastProvider>
  </MotionConfig>,
}]);

createRoot(document.getElementById('root')!).render(
  <StrictMode><RouterProvider router={router} /></StrictMode>,
);
