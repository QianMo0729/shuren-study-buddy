import { useEffect, useState } from 'react';

/**
 * PWA：添加到主屏幕后以独立窗口打开，没有浏览器的地址栏和工具栏。
 * 普通浏览器里打开网址时，浏览器自己的工具栏无法隐藏，所以在「今天」页提示同学把网站放到主屏幕。
 */

/** 生产环境注册 Service Worker（开发时不注册，免得缓存干扰热更新） */
export function registerServiceWorker() {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}

/**
 * 从主屏幕打开（像 App 一样用）时，不让页面被双指缩放或双击放大，免得整个界面被放大后回不去。
 * 在 Safari 里打开时照常可以缩放，看不清字的同学仍然可以放大。
 * iPhone 不理会 user-scalable=no，要拦下 Safari 自己的 gesture 事件。
 */
export function lockZoomWhenStandalone() {
  if (typeof window === 'undefined' || !isStandalone()) return;
  for (const name of ['gesturestart', 'gesturechange', 'gestureend']) {
    document.addEventListener(name, (e) => e.preventDefault(), { passive: false });
  }
  document.documentElement.style.touchAction = 'pan-x pan-y';
}

type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> };
let deferred: InstallEvent | null = null;
const listeners = new Set<() => void>();
if (typeof window !== 'undefined') {
  // Android Chrome 等浏览器：拦下自动弹出的安装横幅，改由页面上的按钮触发
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as InstallEvent;
    listeners.forEach((l) => l());
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    listeners.forEach((l) => l());
  });
}

export const isStandalone = () =>
  window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

const ua = () => navigator.userAgent;
/** 当前浏览器下应该怎样安装：prompt 浏览器能直接弹安装框；ios Safari 需要手动「添加到主屏幕」；wechat 先换到浏览器打开 */
export type InstallMode = 'installed' | 'prompt' | 'ios' | 'wechat' | 'other';
export function installMode(): InstallMode {
  if (isStandalone()) return 'installed';
  if (/MicroMessenger/i.test(ua())) return 'wechat';
  if (deferred) return 'prompt';
  if (/iPhone|iPad|iPod/.test(ua()) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) return 'ios';
  return 'other';
}

export function useInstall() {
  const [mode, setMode] = useState<InstallMode>(() => installMode());
  useEffect(() => {
    const update = () => setMode(installMode());
    listeners.add(update);
    return () => { listeners.delete(update); };
  }, []);
  const install = async () => {
    if (!deferred) return;
    const e = deferred;
    deferred = null;
    await e.prompt();
    await e.userChoice.catch(() => null);
    setMode(installMode());
  };
  return { mode, install };
}
