import { useEffect, useMemo, useRef, useState, type PointerEvent, type ReactNode, type RefObject } from 'react';
import { captureSize, cropRect, type ZoomRange } from './useLiveCamera';
import { isCameraPreviewReady } from './cameraPreview';
import { beijingStamp, paintPreview, previewLayout } from './watermarkPreview';

/**
 * 全宽取景框：视频按原始比例完整显示（所见即所拍），右下角实时预览水印。
 * 水印预览按与服务器相同的规则排版，并按画面亮度逐点取黑/白；时间用服务器时间校准。
 * 双指在取景框里缩放 = 相机变焦（页面本身不缩放）。
 */
export function Viewfinder({ videoRef, width, height, live, placeLabel, clockOffset, zoom = 1, digitalZoom = 1, zoomRange, onZoom, children }: {
  videoRef: RefObject<HTMLVideoElement | null>;
  /** 视频原始尺寸；未知时按 4:3 */
  width: number;
  height: number;
  live: boolean;
  placeLabel: string;
  /** 服务器时间 − 本机时间（毫秒） */
  clockOffset: number;
  /** 当前变焦倍数（显示用） */
  zoom?: number;
  /** 裁剪放大倍数：取景画面和水印取样都按它裁掉四周 */
  digitalZoom?: number;
  zoomRange?: ZoomRange;
  onZoom?: (zoom: number) => void;
  children?: ReactNode;
}) {
  const pinch = usePinch(zoom, onZoom);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const cap = useMemo(() => captureSize(width || 1600, height || 1200), [width, height]);
  // 时间行宽度固定（数字等宽），用任意时间排版即可
  const layout = useMemo(() => previewLayout(cap.width, cap.height, [placeLabel, beijingStamp(0)]), [cap.width, cap.height, placeLabel]);
  const offsetRef = useRef(clockOffset);
  offsetRef.current = clockOffset;

  useEffect(() => {
    if (!live || !layout) return;
    const video = videoRef.current;
    const overlay = overlayRef.current;
    const sampleCanvas = document.createElement('canvas');
    sampleCanvas.width = layout.cols;
    sampleCanvas.height = layout.rows;
    const sample = sampleCanvas.getContext('2d', { willReadFrequently: true });
    if (!video || !overlay || !sample) return;
    sample.imageSmoothingEnabled = true;
    sample.imageSmoothingQuality = 'high';
    let raf = 0;
    let last = 0;
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      if (now - last < 120 || !isCameraPreviewReady(video)) return;
      last = now;
      // 裁剪放大时，照片只取画面中间的部分：水印区域对应的是裁剪后画面里的位置
      const crop = cropRect(video.videoWidth, video.videoHeight, digitalZoom);
      const kx = crop.w / cap.width;
      const ky = crop.h / cap.height;
      const { box } = layout;
      // 把水印区域的画面缩小到点阵尺寸：每个点约等于该区块的平均色
      // iPhone 切镜头或系统暂停相机时，元数据可能仍在，但当前帧已不可读取。
      // 下一帧恢复后继续画水印，不让一次 drawImage 异常打断整个预览。
      try {
        sample.drawImage(video, crop.x + box.x * kx, crop.y + box.y * ky, box.w * kx, box.h * ky, 0, 0, layout.cols, layout.rows);
      } catch {
        return;
      }
      const lines = [placeLabel, beijingStamp(Date.now() + offsetRef.current)];
      paintPreview(overlay, sample, { ...layout, lines: layout.lines.map((l, i) => ({ ...l, text: lines[i] })) });
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [live, layout, cap.width, cap.height, placeLabel, videoRef, digitalZoom]);

  const ratio = cap.width / cap.height;
  const pct = (v: number, of: number) => `${(v / of) * 100}%`;

  return (
    <div
      className="relative mx-auto w-full touch-none overflow-hidden bg-[#0c1415] select-none sm:rounded-md"
      style={{ aspectRatio: `${cap.width} / ${cap.height}`, maxWidth: `calc(68dvh * ${ratio.toFixed(4)})` }}
      {...pinch.handlers}
    >
      <video
        ref={videoRef}
        muted
        playsInline
        autoPlay
        disablePictureInPicture
        aria-label="相机取景画面"
        className="absolute inset-0 block h-full w-full object-contain"
        style={digitalZoom > 1 ? { transform: `scale(${digitalZoom})` } : undefined}
      />
      {layout && (
        <canvas
          ref={overlayRef}
          aria-hidden
          className="pointer-events-none absolute [image-rendering:pixelated]"
          style={{
            left: pct(layout.box.x, cap.width),
            top: pct(layout.box.y, cap.height),
            width: pct(layout.box.w, cap.width),
            height: pct(layout.box.h, cap.height),
            visibility: live ? 'visible' : 'hidden',
          }}
        />
      )}
      {live && onZoom && zoomRange && (zoom !== 1 || pinch.active) && (
        <button
          type="button"
          onClick={() => onZoom(Math.max(zoomRange.min, Math.min(1, zoomRange.max)))}
          aria-label={`变焦 ${zoom.toFixed(1)} 倍，点一下恢复`}
          className="absolute bottom-3 left-1/2 z-10 h-7 -translate-x-1/2 rounded-full bg-black/55 px-2.5 text-[13px] font-semibold text-white tabular"
        >
          {zoom.toFixed(1)}×
        </button>
      )}
      {children}
    </div>
  );
}

/** 双指缩放：两根手指之间的距离变化 → 变焦倍数。只处理取景框里的手指，页面不跟着缩放 */
function usePinch(zoom: number, onZoom?: (zoom: number) => void) {
  const points = useRef(new Map<number, { x: number; y: number }>());
  const start = useRef<{ distance: number; zoom: number } | null>(null);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const [active, setActive] = useState(false);
  const distance = () => {
    const [a, b] = [...points.current.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  };
  const end = (e: PointerEvent) => {
    points.current.delete(e.pointerId);
    if (points.current.size < 2 && start.current) {
      start.current = null;
      setActive(false);
    }
  };
  return {
    active,
    handlers: onZoom ? {
      onPointerDown: (e: PointerEvent) => {
        if (e.pointerType !== 'touch') return;
        points.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (points.current.size === 2) {
          start.current = { distance: distance(), zoom: zoomRef.current };
          setActive(true);
        }
      },
      onPointerMove: (e: PointerEvent) => {
        if (!points.current.has(e.pointerId)) return;
        points.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
        const from = start.current;
        const now = distance();
        if (from && from.distance > 0 && now > 0) onZoom(from.zoom * (now / from.distance));
      },
      onPointerUp: end,
      onPointerCancel: end,
    } : {},
  };
}
