import { useEffect, useMemo, useRef, type ReactNode, type RefObject } from 'react';
import { captureSize } from './useLiveCamera';
import { beijingStamp, paintPreview, previewLayout } from './watermarkPreview';

/**
 * 全宽取景框：视频按原始比例完整显示（所见即所拍），右下角实时预览水印。
 * 水印预览按与服务器相同的规则排版，并按画面亮度逐点取黑/白；时间用服务器时间校准。
 */
export function Viewfinder({ videoRef, width, height, live, placeLabel, clockOffset, children }: {
  videoRef: RefObject<HTMLVideoElement | null>;
  /** 视频原始尺寸；未知时按 4:3 */
  width: number;
  height: number;
  live: boolean;
  placeLabel: string;
  /** 服务器时间 − 本机时间（毫秒） */
  clockOffset: number;
  children?: ReactNode;
}) {
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
      if (now - last < 120 || !video.videoWidth) return;
      last = now;
      const kx = video.videoWidth / cap.width;
      const ky = video.videoHeight / cap.height;
      const { box } = layout;
      // 把水印区域的画面缩小到点阵尺寸：每个点约等于该区块的平均色
      sample.drawImage(video, box.x * kx, box.y * ky, box.w * kx, box.h * ky, 0, 0, layout.cols, layout.rows);
      const lines = [placeLabel, beijingStamp(Date.now() + offsetRef.current)];
      paintPreview(overlay, sample, { ...layout, lines: layout.lines.map((l, i) => ({ ...l, text: lines[i] })) });
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [live, layout, cap.width, cap.height, placeLabel, videoRef]);

  const ratio = cap.width / cap.height;
  const pct = (v: number, of: number) => `${(v / of) * 100}%`;

  return (
    <div
      className="relative mx-auto w-full overflow-hidden bg-[#0c1415] sm:rounded-md"
      style={{ aspectRatio: `${cap.width} / ${cap.height}`, maxWidth: `calc(68dvh * ${ratio.toFixed(4)})` }}
    >
      <video ref={videoRef} muted playsInline autoPlay aria-label="相机取景画面" className="absolute inset-0 h-full w-full object-contain" />
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
      {children}
    </div>
  );
}
