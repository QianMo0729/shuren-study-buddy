import { useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * 宣传片播放器。mustFinish 为 true 时要完整看一遍：不能往后拖、不能倍速，连续播到结尾才调用 onFinished。
 * 暂停、往回看、全屏都不受限制；看完之后可以随意拖动。
 */
export function PromoVideo({ src, poster, label, mustFinish, status, onProgress, onFinished }: {
  src: string;
  poster: string;
  label: string;
  mustFinish: boolean;
  /** 播放器下方的一行说明 */
  status: ReactNode;
  /** 已经连续看到第几秒 */
  onProgress?: (seconds: number) => void;
  onFinished?: () => void;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  // furthest：已经连续看到的位置；at：上一次确认播放进度的时刻；second：上一次报给页面的整秒数
  const mark = useRef({ furthest: 0, at: 0, second: 0 });
  const [notice, setNotice] = useState('');
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(''), 4000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  function onTimeUpdate() {
    const video = ref.current;
    if (!video || !mustFinish || video.seeking) return;
    const m = mark.current, now = Date.now(), t = video.currentTime;
    // 正常播放时，画面时间不会比实际经过的时间走得快；多出来的部分是拖动造成的，不算已看
    const elapsed = video.paused || !m.at ? 0 : (now - m.at) / 1000;
    if (t > m.furthest && t - m.furthest <= elapsed + 0.75) {
      m.furthest = t;
      if (Math.floor(t) !== m.second) { m.second = Math.floor(t); onProgress?.(m.second); }
    }
    m.at = now;
  }
  function onSeeking() {
    const video = ref.current;
    if (!video || !mustFinish || video.currentTime <= mark.current.furthest + 0.5) return;
    video.currentTime = mark.current.furthest;
    setNotice('看完之前不能快进，往回看可以。');
  }
  function onEnded() {
    const video = ref.current;
    if (!video || !mustFinish) return;
    if (mark.current.furthest >= video.duration - 1) onFinished?.();
    else { video.currentTime = mark.current.furthest; setNotice('中间有一段没有播放，请从这里接着看完。'); }
  }

  return <div className="benefits-promo-video">
    <video ref={ref} src={src} poster={poster} aria-label={label} controls playsInline preload="none"
      controlsList="nodownload noplaybackrate noremoteplayback" disableRemotePlayback
      // 微信等内置浏览器：在页面里播放，不被系统播放器接管
      webkit-playsinline="true" x5-playsinline="true" x5-video-player-type="h5-page"
      onPlay={() => { mark.current.at = Date.now(); setFailed(false); }}
      onTimeUpdate={onTimeUpdate} onSeeking={onSeeking} onEnded={onEnded}
      onRateChange={() => { const video = ref.current; if (video && mustFinish && video.playbackRate > 1) video.playbackRate = 1; }}
      onError={() => setFailed(true)} />
    {failed ? <p className="benefits-promo-status" role="alert">宣传片没能加载出来，请检查网络。<button type="button" onClick={() => { setFailed(false); ref.current?.load(); }}>重新加载</button></p>
      : <p className="benefits-promo-status" role="status">{notice || status}</p>}
  </div>;
}
