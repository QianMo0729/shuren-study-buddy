import { useCallback, useEffect, useRef, useState } from 'react';

export type Facing = 'environment' | 'user';

export interface CameraProblem {
  kind: 'insecure' | 'unsupported' | 'denied' | 'notfound' | 'busy' | 'unknown';
  title: string;
  desc: string;
  /** 用户处理后可以点「重试」 */
  retry: boolean;
}

export type CameraState =
  | { status: 'starting' }
  | { status: 'live'; width: number; height: number }
  | { status: 'paused' }
  | { status: 'error'; problem: CameraProblem };

/** 打开摄像头前就能判断的问题：非 HTTPS、浏览器不支持 */
function precheck(): CameraProblem | null {
  if (typeof window === 'undefined') return null;
  if (!window.isSecureContext) {
    return {
      kind: 'insecure',
      title: '需要安全连接（HTTPS）才能使用摄像头',
      desc: '浏览器只允许 HTTPS 网页调用摄像头。请通过 https:// 开头的网址访问本站后再打卡。',
      retry: false,
    };
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    return {
      kind: 'unsupported',
      title: '当前浏览器不支持网页相机',
      desc: '请换用最新版的 Safari、Chrome、Edge 或微信内置浏览器打开本页。',
      retry: false,
    };
  }
  return null;
}

function explain(error: unknown): CameraProblem {
  const name = error instanceof DOMException ? error.name : (error as { name?: string })?.name ?? '';
  if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError') {
    return {
      kind: 'denied',
      title: '没有获得摄像头权限',
      desc: '请在浏览器地址栏左侧（或系统设置 → 浏览器）里允许本站使用摄像头，然后点「重试」。',
      retry: true,
    };
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError' || name === 'DevicesNotFoundError') {
    return { kind: 'notfound', title: '没有找到可用的摄像头', desc: '请换一台带摄像头的设备（例如手机）打开本页打卡。', retry: true };
  }
  if (name === 'NotReadableError' || name === 'AbortError' || name === 'TrackStartError') {
    return { kind: 'busy', title: '摄像头正被其他应用占用', desc: '请关闭正在使用摄像头的应用或网页（如视频通话），然后点「重试」。', retry: true };
  }
  return { kind: 'unknown', title: '摄像头打开失败', desc: '请稍后重试；如果仍然不行，可以换一个浏览器试试。', retry: true };
}

/**
 * 网页实时相机：只通过 getUserMedia 获取画面。离开页面、页面切到后台时关闭所有视频轨道，回到前台时重新打开。
 */
export function useLiveCamera(enabled: boolean) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [facing, setFacing] = useState<Facing>('environment');
  const [state, setState] = useState<CameraState>(() => {
    const problem = precheck();
    return problem ? { status: 'error', problem } : { status: 'starting' };
  });
  const [canSwitch, setCanSwitch] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [hidden, setHidden] = useState(() => typeof document !== 'undefined' && document.visibilityState === 'hidden');

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  useEffect(() => {
    const onVisibility = () => setHidden(document.visibilityState === 'hidden');
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', stop);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', stop);
    };
  }, [stop]);

  useEffect(() => {
    const problem = precheck();
    if (problem) {
      setState({ status: 'error', problem });
      return;
    }
    if (!enabled || hidden) {
      // 不需要相机（已完成打卡）或页面在后台：关闭所有视频轨道
      stop();
      setState({ status: 'paused' });
      return;
    }
    let cancelled = false;
    setState({ status: 'starting' });
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: facing, width: { ideal: 1600 }, height: { ideal: 1200 } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        const video = videoRef.current;
        if (!video) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        video.srcObject = stream;
        video.muted = true;
        video.playsInline = true;
        await video.play().catch(() => {});
        if (!video.videoWidth) await new Promise((resolve) => video.addEventListener('loadedmetadata', resolve, { once: true }));
        if (cancelled) return;
        setState({ status: 'live', width: video.videoWidth, height: video.videoHeight });
        // 有多个摄像头时才显示切换按钮（权限获得后才能列出设备）
        const devices = await navigator.mediaDevices.enumerateDevices().catch(() => []);
        if (!cancelled) setCanSwitch(devices.filter((d) => d.kind === 'videoinput').length > 1);
        // 摄像头被系统收回（例如来电）时提示重试
        stream.getVideoTracks()[0]?.addEventListener('ended', () => {
          if (!cancelled && streamRef.current === stream) {
            setState({ status: 'error', problem: { kind: 'busy', title: '摄像头已断开', desc: '摄像头被系统或其他应用中断了，请点「重试」。', retry: true } });
          }
        });
      } catch (error) {
        if (!cancelled) setState({ status: 'error', problem: explain(error) });
      }
    })();
    return () => {
      cancelled = true;
      stop();
    };
  }, [enabled, hidden, facing, attempt, stop]);

  // 视频尺寸可能在旋转手机后变化
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const onResize = () => {
      if (video.videoWidth && streamRef.current) setState({ status: 'live', width: video.videoWidth, height: video.videoHeight });
    };
    video.addEventListener('resize', onResize);
    return () => video.removeEventListener('resize', onResize);
  }, []);

  return {
    videoRef,
    state,
    facing,
    canSwitch,
    switchCamera: () => setFacing((f) => (f === 'environment' ? 'user' : 'environment')),
    retry: () => setAttempt((n) => n + 1),
    stop,
  };
}

/**
 * 把当前视频帧画到 canvas（最长边 ≤ maxSide）并编码成 JPEG dataURL。
 * 这是唯一的取图方式：没有任何选择文件 / 相册的入口。
 */
export function captureFrame(video: HTMLVideoElement, maxSide = 1600, quality = 0.9): string | null {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh) return null;
  const { width, height } = captureSize(vw, vh, maxSide);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(video, 0, 0, width, height);
  return canvas.toDataURL('image/jpeg', quality);
}

export function captureSize(vw: number, vh: number, maxSide = 1600) {
  const scale = Math.min(1, maxSide / Math.max(vw, vh));
  return { width: Math.round(vw * scale), height: Math.round(vh * scale) };
}
