/** Metadata alone does not mean a camera frame can be displayed or captured. */
export function isCameraPreviewReady(video: HTMLVideoElement, stream?: MediaStream | null): boolean {
  if (video.readyState < 2 || !video.videoWidth || !video.videoHeight || video.paused || video.ended) return false;
  const source = stream ?? video.srcObject as MediaStream | null;
  if (!source || typeof source.getVideoTracks !== 'function' || !source.active) return false;
  const track = source.getVideoTracks()[0];
  return !!track && track.readyState === 'live' && track.enabled && !track.muted;
}

/** Bounded, cancellable first-frame wait; also observes asynchronous play failures. */
export function waitForCameraFrame(video: HTMLVideoElement, stream: MediaStream, {
  signal,
  playback,
  timeoutMs = 12_000,
}: { signal: AbortSignal; playback?: Promise<void>; timeoutMs?: number }): Promise<void> {
  return new Promise((resolve, reject) => {
    let finished = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let poll: ReturnType<typeof setInterval> | undefined;
    const track = stream.getVideoTracks()[0];
    const events = ['loadeddata', 'canplay', 'playing', 'resize', 'timeupdate'];
    const clean = () => {
      clearTimeout(timer);
      clearInterval(poll);
      events.forEach((event) => video.removeEventListener(event, check));
      video.removeEventListener('error', onError);
      track?.removeEventListener('ended', onEnded);
      track?.removeEventListener('unmute', check);
      signal.removeEventListener('abort', onAbort);
    };
    const finish = (error?: unknown) => {
      if (finished) return;
      finished = true;
      clean();
      if (error) reject(error);
      else resolve();
    };
    const check = () => {
      if (signal.aborted) return onAbort();
      if (!stream.active || !track || track.readyState === 'ended') return onEnded();
      if (isCameraPreviewReady(video, stream)) finish();
    };
    const onAbort = () => finish(new DOMException('Camera preview cancelled', 'AbortError'));
    const onEnded = () => finish(new DOMException('Camera stream ended', 'NotReadableError'));
    const onError = () => finish(new DOMException('Camera video playback failed', 'NotReadableError'));
    // Attach a rejection handler even if cancellation/readiness settles immediately.
    playback?.catch((error: unknown) => finish(error));
    events.forEach((event) => video.addEventListener(event, check));
    video.addEventListener('error', onError);
    track?.addEventListener('ended', onEnded);
    track?.addEventListener('unmute', check);
    signal.addEventListener('abort', onAbort, { once: true });
    timer = setTimeout(() => finish(new DOMException('Camera did not deliver a frame', 'TimeoutError')), timeoutMs);
    // Some mobile browsers skip loadeddata; use current readiness as a fallback.
    poll = setInterval(check, 100);
    check();
  });
}
