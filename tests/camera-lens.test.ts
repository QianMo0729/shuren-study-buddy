import assert from 'node:assert/strict';
import test from 'node:test';
import { pickMainBackCamera, type CameraInfo } from '../src/components/checkin/cameraLens';

const cam = (deviceId: string, label: string, facing: string[] = []): CameraInfo => ({ deviceId, label, facing });

test('Android Chrome: uses the lowest-numbered back camera instead of the telephoto the browser picked', () => {
  // 类似 OPPO Find X8 Ultra：主摄、前摄、超广角、3× 与 6× 潜望长焦都向网页公开
  const cameras = [
    cam('main', 'camera2 0, facing back', ['environment']),
    cam('front', 'camera2 1, facing front', ['user']),
    cam('ultra', 'camera2 2, facing back', ['environment']),
    cam('tele3', 'camera2 3, facing back', ['environment']),
    cam('tele6', 'camera2 4, facing back', ['environment']),
  ];
  assert.equal(pickMainBackCamera(cameras, 'tele6'), 'main');
  assert.equal(pickMainBackCamera(cameras, 'main'), 'main');
  // 列表顺序与编号不一致时仍按编号
  assert.equal(pickMainBackCamera([...cameras].reverse(), 'tele3'), 'main');
});

test('Android without facing capabilities: reads facing and number from the label', () => {
  const chrome = [cam('b4', 'camera2 4, facing back'), cam('f1', 'camera2 1, facing front'), cam('b0', 'camera2 0, facing back')];
  assert.equal(pickMainBackCamera(chrome, 'b4'), 'b0');
  const firefox = [cam('f', 'Camera 1, Facing front, Orientation 270'), cam('b2', 'Camera 2, Facing back, Orientation 90'), cam('b0', 'Camera 0, Facing back, Orientation 90')];
  assert.equal(pickMainBackCamera(firefox, 'b2'), 'b0');
});

test('iPhone: keeps Safari choice unless it is clearly a telephoto or wide lens', () => {
  const en = [
    cam('front', 'Front Camera'),
    cam('back', 'Back Camera'),
    cam('dualwide', 'Back Dual Wide Camera'),
    cam('triple', 'Back Triple Camera'),
    cam('tele', 'Back Telephoto Camera'),
    cam('ultra', 'Back Ultra Wide Camera'),
  ];
  assert.equal(pickMainBackCamera(en, 'back'), null);
  assert.equal(pickMainBackCamera(en, 'tele'), 'back');
  const zh = [cam('front', '前置相机'), cam('back', '后置相机'), cam('tele', '后置长焦相机'), cam('ultra', '后置超广角相机'), cam('dualwide', '后置双广角相机')];
  assert.equal(pickMainBackCamera(zh, 'back'), null);
  assert.equal(pickMainBackCamera(zh, 'tele'), 'back');
  assert.equal(pickMainBackCamera(zh, 'ultra'), 'back');
});

test('unlabeled cameras with known facing: first back camera in browser order', () => {
  const cameras = [cam('a', '', ['user']), cam('b', '', ['environment']), cam('c', '', ['environment'])];
  assert.equal(pickMainBackCamera(cameras, 'c'), 'b');
});

test('nothing to choose: single back camera, desktop webcams, or no plain back lens', () => {
  assert.equal(pickMainBackCamera([cam('f', 'camera2 1, facing front'), cam('b', 'camera2 0, facing back')], 'b'), null);
  assert.equal(pickMainBackCamera([cam('w', 'FaceTime HD Camera'), cam('u', 'USB Camera 2')], 'w'), null);
  assert.equal(pickMainBackCamera([cam('t', 'Back Telephoto Camera'), cam('u', 'Back Ultra Wide Camera')], 't'), null);
  assert.equal(pickMainBackCamera([], undefined), null);
});
