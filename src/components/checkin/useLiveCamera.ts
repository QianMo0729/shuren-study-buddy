import { useCallback, useEffect, useRef, useState } from 'react';
import { isCameraPreviewReady, waitForCameraFrame } from './cameraPreview';
import { pickMainBackCamera, type CameraInfo } from './cameraLens';

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
  | { status: 'blocked' }
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
  if (name === 'TimeoutError') {
    return { kind: 'unknown', title: '摄像头还没有传来画面', desc: '请点「重试」重新打开相机；也可以先关闭其他正在使用摄像头的网页或应用。', retry: true };
  }
  return { kind: 'unknown', title: '摄像头打开失败', desc: '请稍后重试；如果仍然不行，可以换一个浏览器试试。', retry: true };
}

/**
 * 网页实时相机：只通过 getUserMedia 获取画面。离开页面、页面切到后台时关闭所有视频轨道，回到前台时重新打开。
 */
export function useLiveCamera(enabled: boolean) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const resumeRef = useRef<(() => void) | null>(null);
  const cancelPreviewRef = useRef<(() => void) | null>(null);
  const [facing, setFacing] = useState<Facing>('environment');
  const [state, setState] = useState<CameraState>(() => {
    const problem = precheck();
    return problem ? { status: 'error', problem } : { status: 'starting' };
  });
  const [canSwitch, setCanSwitch] = useState(false);
  const [zoomRange, setZoomRange] = useState<ZoomRange>(DIGITAL_ZOOM);
  const [zoom, setZoomState] = useState(1);
  const zoomRef = useRef({ value: 1, range: DIGITAL_ZOOM, pending: 0 });
  const [attempt, setAttempt] = useState(0);
  const [hidden, setHidden] = useState(() => typeof document !== 'undefined' && document.visibilityState === 'hidden');

  const stop = useCallback(() => {
    const stream = streamRef.current;
    streamRef.current = null;
    resumeRef.current = null;
    cancelPreviewRef.current?.();
    cancelPreviewRef.current = null;
    stream?.getTracks().forEach((t) => t.stop());
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.srcObject = null;
    }
  }, []);

  useEffect(() => {
    const onVisibility = () => {
      const background = document.visibilityState === 'hidden';
      if (background) stop();
      else if (!streamRef.current?.active) setAttempt((n) => n + 1);
      setHidden(background);
    };
    const onPageHide = () => {
      stop();
      setHidden(true);
    };
    const onPageShow = () => {
      setHidden(document.visibilityState === 'hidden');
      // A page restored from Safari's page cache can retain the old React state.
      setAttempt((n) => n + 1);
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('pageshow', onPageShow);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('pageshow', onPageShow);
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
    let removeListeners = () => {};
    setState({ status: 'starting' });
    setCanSwitch(false);
    (async () => {
      try {
        const opened = await openCamera(facing, () => cancelled);
        if (!opened) return;
        const { stream, cameras } = opened;
        const video = videoRef.current;
        if (!video) {
          stopStream(stream);
          return;
        }
        streamRef.current = stream;
        // Set playback policy before attaching the stream, including DOM attributes
        // used by WebKit-based browsers on iPhone.
        video.muted = true;
        video.defaultMuted = true;
        video.playsInline = true;
        video.setAttribute('muted', '');
        video.setAttribute('playsinline', '');
        video.setAttribute('webkit-playsinline', '');
        video.srcObject = stream;
        const track = stream.getVideoTracks()[0];
        // 变焦：手机支持时用相机自己的变焦（画质好）；不支持时（多数 iPhone）用裁剪放大
        const caps = (track?.getCapabilities?.() ?? {}) as MediaTrackCapabilities & { zoom?: { min: number; max: number; step?: number } };
        const settings = (track?.getSettings?.() ?? {}) as MediaTrackSettings & { zoom?: number };
        const range: ZoomRange = caps.zoom && caps.zoom.max > caps.zoom.min
          ? { min: caps.zoom.min, max: Math.min(caps.zoom.max, HARDWARE_ZOOM_MAX), hardware: true }
          : DIGITAL_ZOOM;
        const initial = range.hardware ? Math.min(range.max, Math.max(range.min, settings.zoom ?? 1)) : 1;
        zoomRef.current = { value: initial, range, pending: 0 };
        setZoomRange(range);
        setZoomState(initial);
        let previewController: AbortController | null = null;
        let wasLive = false;
        const current = () => !cancelled && streamRef.current === stream;
        const cancelPreview = () => {
          previewController?.abort();
          previewController = null;
        };
        const runPreview = () => {
          if (!current()) return;
          cancelPreview();
          wasLive = false;
          setState({ status: 'starting' });
          const controller = new AbortController();
          previewController = controller;
          let playback: Promise<void>;
          try {
            // Keep this call synchronous: resumePreview is called from a user tap.
            playback = video.play();
          } catch (error) {
            playback = Promise.reject(error);
          }
          void waitForCameraFrame(video, stream, { signal: controller.signal, playback }).then(() => {
            if (!current() || controller.signal.aborted) return;
            wasLive = true;
            setState({ status: 'live', width: video.videoWidth, height: video.videoHeight });
          }).catch((error: unknown) => {
            if (!current() || controller.signal.aborted) return;
            if ((error as { name?: string })?.name === 'NotAllowedError') {
              setState({ status: 'blocked' });
            } else {
              setState({ status: 'error', problem: explain(error) });
            }
          }).finally(() => {
            if (previewController === controller) previewController = null;
          });
        };
        const onEnded = () => {
          if (!current()) return;
          stop();
          setState({ status: 'error', problem: { kind: 'busy', title: '摄像头已断开', desc: '摄像头被系统或其他应用中断了，请点「重试」。', retry: true } });
        };
        const onMute = () => {
          if (!current()) return;
          cancelPreview();
          wasLive = false;
          setState({ status: 'error', problem: { kind: 'busy', title: '摄像头画面已暂停', desc: '系统或其他应用暂停了摄像头。恢复后会自动继续，也可以点「重试」。', retry: true } });
        };
        const onPause = () => {
          if (!current() || !wasLive || track?.muted) return;
          cancelPreview();
          wasLive = false;
          setState({ status: 'blocked' });
        };
        const onPlaying = () => {
          if (current() && !wasLive && !previewController) runPreview();
        };
        const onResize = () => {
          if (current() && wasLive && isCameraPreviewReady(video, stream)) {
            setState({ status: 'live', width: video.videoWidth, height: video.videoHeight });
          }
        };
        track?.addEventListener('ended', onEnded);
        track?.addEventListener('mute', onMute);
        track?.addEventListener('unmute', runPreview);
        video.addEventListener('pause', onPause);
        video.addEventListener('playing', onPlaying);
        video.addEventListener('resize', onResize);
        removeListeners = () => {
          cancelPreview();
          track?.removeEventListener('ended', onEnded);
          track?.removeEventListener('mute', onMute);
          track?.removeEventListener('unmute', runPreview);
          video.removeEventListener('pause', onPause);
          video.removeEventListener('playing', onPlaying);
          video.removeEventListener('resize', onResize);
        };
        resumeRef.current = runPreview;
        cancelPreviewRef.current = cancelPreview;
        runPreview();
        // 有多个摄像头时才显示切换按钮（权限获得后才能列出设备）
        setCanSwitch(cameras > 1);
      } catch (error) {
        if (!cancelled) setState({ status: 'error', problem: explain(error) });
      }
    })();
    return () => {
      cancelled = true;
      removeListeners();
      stop();
    };
  }, [enabled, hidden, facing, attempt, stop]);

  /** 设置变焦倍数。相机变焦按帧节流，避免双指移动时连续调用 applyConstraints */
  const setZoom = useCallback((value: number) => {
    const ref = zoomRef.current;
    const next = Math.min(ref.range.max, Math.max(ref.range.min, Math.round(value * 100) / 100));
    if (next === ref.value) return;
    ref.value = next;
    setZoomState(next);
    if (!ref.range.hardware || ref.pending) return;
    ref.pending = requestAnimationFrame(() => {
      ref.pending = 0;
      const track = streamRef.current?.getVideoTracks()[0];
      void track?.applyConstraints({ advanced: [{ zoom: ref.value } as MediaTrackConstraintSet] }).catch(() => {});
    });
  }, []);

  const resumePreview = useCallback(() => {
    if (resumeRef.current) resumeRef.current();
    else setAttempt((n) => n + 1);
  }, []);

  return {
    videoRef,
    state,
    facing,
    canSwitch,
    switchCamera: () => setFacing((f) => (f === 'environment' ? 'user' : 'environment')),
    retry: () => setAttempt((n) => n + 1),
    resumePreview,
    stop,
    zoom,
    zoomRange,
    setZoom,
    /** 裁剪放大的倍数（相机自己变焦时为 1）：取景框和拍照都按它裁掉四周 */
    digitalZoom: zoomRange.hardware ? 1 : zoom,
  };
}

export interface ZoomRange {
  min: number;
  max: number;
  /** true：相机自己变焦；false：裁剪放大 */
  hardware: boolean;
}

const errorName = (error: unknown) => (error as { name?: string })?.name ?? '';

function stopStream(stream: MediaStream) {
  stream.getTracks().forEach((t) => t.stop());
}

async function request(video: MediaTrackConstraints): Promise<MediaStream> {
  try {
    return await navigator.mediaDevices.getUserMedia({ video: { ...video, width: { ideal: 1600 }, height: { ideal: 1200 } }, audio: false });
  } catch (error) {
    if (errorName(error) !== 'OverconstrainedError') throw error;
    return navigator.mediaDevices.getUserMedia({ video, audio: false });
  }
}

/** 刚关掉的摄像头在部分 Android 手机上要稍等才能被再次打开 */
async function requestAfterRelease(video: MediaTrackConstraints): Promise<MediaStream> {
  try {
    return await request(video);
  } catch (error) {
    if (errorName(error) !== 'NotReadableError' && errorName(error) !== 'AbortError') throw error;
    await new Promise((resolve) => setTimeout(resolve, 300));
    return request(video);
  }
}

/** 记住后置主摄，下次直接打开它，不必先打开浏览器默认的镜头再换 */
const LENS_KEY = 'dz-camera-main-lens';
let lensMemory: string | null = null;
function readLens(): string | null {
  try { return localStorage.getItem(LENS_KEY) ?? lensMemory; } catch { return lensMemory; }
}
function writeLens(deviceId: string | null) {
  lensMemory = deviceId;
  try {
    if (deviceId) localStorage.setItem(LENS_KEY, deviceId);
    else localStorage.removeItem(LENS_KEY);
  } catch { /* 无痕模式等情况下只记在内存里 */ }
}

function describeCamera(device: MediaDeviceInfo): CameraInfo {
  let facing: string[] = [];
  try {
    facing = (device as InputDeviceInfo).getCapabilities?.().facingMode ?? [];
  } catch { /* 部分浏览器没有 InputDeviceInfo.getCapabilities */ }
  return { deviceId: device.deviceId, label: device.label, facing };
}

/**
 * 打开摄像头。后置时确保用的是主摄（1×）：多摄 Android 手机只按 facingMode 打开时，
 * 浏览器会按分辨率挑镜头，可能拿到长焦（如 OPPO Find X8 Ultra 的 10× 潜望）。
 * 返回 null 表示中途已取消（已关闭打开的轨道）。
 */
async function openCamera(facing: Facing, cancelled: () => boolean): Promise<{ stream: MediaStream; cameras: number } | null> {
  const remembered = facing === 'environment' ? readLens() : null;
  let stream: MediaStream | null = null;
  if (remembered) {
    try {
      stream = await request({ deviceId: { exact: remembered } });
    } catch (error) {
      // 记住的镜头已不存在（清除过网站数据、换了设备）：改回按朝向打开
      if (errorName(error) !== 'OverconstrainedError' && errorName(error) !== 'NotFoundError') throw error;
      writeLens(null);
    }
  }
  stream ??= await request({ facingMode: { ideal: facing } });
  if (cancelled()) {
    stopStream(stream);
    return null;
  }
  const inputs = (await navigator.mediaDevices.enumerateDevices().catch(() => [])).filter((d) => d.kind === 'videoinput');
  if (cancelled()) {
    stopStream(stream);
    return null;
  }
  if (facing !== 'environment') return { stream, cameras: inputs.length };

  const track = stream.getVideoTracks()[0];
  const currentId = track?.getSettings?.().deviceId || inputs.find((d) => d.label && d.label === track?.label)?.deviceId;
  const main = pickMainBackCamera(inputs.map(describeCamera), currentId);
  if (!main || main === currentId) {
    if (main) writeLens(main);
    return { stream, cameras: inputs.length };
  }
  stopStream(stream);
  try {
    stream = await requestAfterRelease({ deviceId: { exact: main } });
    writeLens(main);
  } catch (error) {
    if (cancelled()) throw error;
    // 主摄打不开时退回浏览器默认的选择，至少保证能拍照
    stream = await requestAfterRelease({ facingMode: { ideal: facing } });
  }
  if (cancelled()) {
    stopStream(stream);
    return null;
  }
  return { stream, cameras: inputs.length };
}

/** 裁剪放大最多 3 倍：再大画面太糊，看不清学习内容 */
const DIGITAL_ZOOM: ZoomRange = { min: 1, max: 3, hardware: false };
const HARDWARE_ZOOM_MAX = 5;

/** 裁剪放大时，取景框和照片使用的视频区域（以视频像素计，居中） */
export function cropRect(vw: number, vh: number, zoom = 1) {
  const z = Math.max(1, zoom);
  const w = vw / z;
  const h = vh / z;
  return { x: (vw - w) / 2, y: (vh - h) / 2, w, h };
}

/**
 * 把当前视频帧画到 canvas（最长边 ≤ maxSide）并编码成 JPEG dataURL。
 * 这是唯一的取图方式：没有任何选择文件 / 相册的入口。
 */
export function captureFrame(video: HTMLVideoElement, zoom = 1, maxSide = 1600, quality = 0.9): string | null {
  if (!isCameraPreviewReady(video)) return null;
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh) return null;
  const { width, height } = captureSize(vw, vh, maxSide);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  try {
    // 裁剪放大：只取画面中间的部分，放大到原来的尺寸，和取景框里看到的一致
    const crop = cropRect(vw, vh, zoom);
    ctx.drawImage(video, crop.x, crop.y, crop.w, crop.h, 0, 0, width, height);
    return canvas.toDataURL('image/jpeg', quality);
  } catch {
    // Camera interruptions can race with a tap even after a valid preview frame.
    return null;
  }
}

export function captureSize(vw: number, vh: number, maxSide = 1600) {
  const scale = Math.min(1, maxSide / Math.max(vw, vh));
  return { width: Math.round(vw * scale), height: Math.round(vh * scale) };
}
