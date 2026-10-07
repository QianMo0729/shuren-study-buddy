import assert from 'node:assert/strict';
import test from 'node:test';
import { isCameraPreviewReady, waitForCameraFrame } from '../src/components/checkin/cameraPreview';
import { captureFrame } from '../src/components/checkin/useLiveCamera';

class FakeTrack extends EventTarget {
  readyState = 'live';
  enabled = true;
  muted = false;
}

class FakeVideo extends EventTarget {
  readyState = 1;
  videoWidth = 1280;
  videoHeight = 720;
  paused = false;
  ended = false;
  srcObject: MediaStream | null = null;
}

function camera() {
  const track = new FakeTrack();
  const source = { active: true, getVideoTracks: () => [track] };
  const stream = source as unknown as MediaStream;
  const element = new FakeVideo();
  element.srcObject = stream;
  return { track, source, stream, element, video: element as unknown as HTMLVideoElement };
}

test('camera dimensions and metadata cannot enable capture before a usable live frame', () => {
  const { video, element, track, source } = camera();
  assert.equal(isCameraPreviewReady(video), false);
  element.readyState = 2;
  assert.equal(isCameraPreviewReady(video), true);
  for (const key of ['paused', 'ended'] as const) {
    element[key] = true;
    assert.equal(isCameraPreviewReady(video), false, key);
    element[key] = false;
  }
  element.videoHeight = 0;
  assert.equal(isCameraPreviewReady(video), false);
  element.videoHeight = 720;
  track.muted = true;
  assert.equal(isCameraPreviewReady(video), false);
  track.muted = false;
  track.enabled = false;
  assert.equal(isCameraPreviewReady(video), false);
  track.enabled = true;
  track.readyState = 'ended';
  assert.equal(isCameraPreviewReady(video), false);
  track.readyState = 'live';
  source.active = false;
  assert.equal(isCameraPreviewReady(video), false);
});

test('frame wait ignores metadata and settles when actual current frame data arrives', async () => {
  const { video, stream, element } = camera();
  let ready = false;
  const waiting = waitForCameraFrame(video, stream, { signal: new AbortController().signal, timeoutMs: 200 });
  void waiting.then(() => { ready = true; });
  element.dispatchEvent(new Event('resize'));
  await Promise.resolve();
  assert.equal(ready, false);
  element.readyState = 2;
  element.dispatchEvent(new Event('loadeddata'));
  await waiting;
  assert.equal(ready, true);
});

test('autoplay rejection is preserved so the UI can offer a user-gesture recovery', async () => {
  const { video, stream } = camera();
  const error = new DOMException('Tap required', 'NotAllowedError');
  await assert.rejects(waitForCameraFrame(video, stream, {
    signal: new AbortController().signal,
    playback: Promise.reject(error),
  }), (actual) => actual === error);
});

test('a hung playback promise and missing frame cannot leave the camera waiting forever', async () => {
  const { video, stream } = camera();
  await assert.rejects(waitForCameraFrame(video, stream, {
    signal: new AbortController().signal,
    playback: new Promise<void>(() => {}),
    timeoutMs: 15,
  }), { name: 'TimeoutError' });
});

test('closing or replacing the camera cancels its pending frame wait', async () => {
  const { video, stream } = camera();
  const controller = new AbortController();
  const waiting = waitForCameraFrame(video, stream, { signal: controller.signal });
  controller.abort();
  await assert.rejects(waiting, { name: 'AbortError' });
  await assert.rejects(waitForCameraFrame(video, stream, { signal: controller.signal }), { name: 'AbortError' });
});

test('ending a camera track fails promptly, while a muted track waits for recovery', async () => {
  const interrupted = camera();
  const waiting = waitForCameraFrame(interrupted.video, interrupted.stream, { signal: new AbortController().signal });
  interrupted.track.readyState = 'ended';
  interrupted.track.dispatchEvent(new Event('ended'));
  await assert.rejects(waiting, { name: 'NotReadableError' });

  const resumed = camera();
  resumed.element.readyState = 2;
  resumed.track.muted = true;
  const recovered = waitForCameraFrame(resumed.video, resumed.stream, { signal: new AbortController().signal });
  resumed.track.muted = false;
  resumed.track.dispatchEvent(new Event('unmute'));
  await recovered;
});

test('capture rejects unavailable video and safely handles a drawing interruption', () => {
  const { video, element } = camera();
  // No DOM is needed when metadata exists but a current frame does not.
  assert.equal(captureFrame(video), null);
  element.readyState = 2;
  element.paused = true;
  assert.equal(captureFrame(video), null);
  element.paused = false;
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { configurable: true, value: {
    createElement: () => ({
      getContext: () => ({ drawImage: () => { throw new DOMException('Frame lost', 'InvalidStateError'); } }),
    }),
  } });
  try {
    assert.equal(captureFrame(video), null);
  } finally {
    if (previousDocument) Object.defineProperty(globalThis, 'document', previousDocument);
    else Reflect.deleteProperty(globalThis, 'document');
  }
});
