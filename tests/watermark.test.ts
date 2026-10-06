import assert from 'node:assert/strict';
import test from 'node:test';
import jpeg from 'jpeg-js';
import {
  CAMPUS, CAMPUS_PLACES, MAX_BUILDING_ACCURACY_M, NO_LOCATION_LABEL, OFF_CAMPUS_LABEL, allPlaceLabels, placeLabelFor,
} from '../shared/campusPlaces.ts';
import { GLYPHS, GLYPH_HEIGHT } from '../server/watermarkFont.ts';
import { glyphOf, layoutWatermark, missingGlyphs, paintWatermark, stampWatermark, textWidth } from '../server/watermark.ts';

const LINES = ['南科大·琳恩图书馆', '2026-10-04 21:37:05 北京时间'];

function solid(width: number, height: number, rgb: (x: number, y: number) => [number, number, number]) {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b] = rgb(x, y);
      const i = (y * width + x) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = 255;
    }
  }
  return data;
}

/** 返回所有被改动像素的坐标与颜色 */
function changes(before: Uint8Array, after: Uint8Array, width: number) {
  const out: { x: number; y: number; rgb: [number, number, number] }[] = [];
  for (let i = 0; i < before.length; i += 4) {
    if (before[i] !== after[i] || before[i + 1] !== after[i + 1] || before[i + 2] !== after[i + 2] || before[i + 3] !== after[i + 3]) {
      const p = i / 4;
      out.push({ x: p % width, y: Math.floor(p / width), rgb: [after[i], after[i + 1], after[i + 2]] });
    }
  }
  return out;
}

test('glyphs are real Unifont bitmaps: 8×16 for ASCII, 16×16 for CJK', () => {
  assert.equal(GLYPH_HEIGHT, 16);
  // U+0041 in unifont.hex
  assert.equal(GLYPHS.A, '0000000018242442427E424242420000');
  assert.equal(glyphOf('A').width, 8);
  assert.equal(glyphOf('北').width, 16);
  for (const [ch, hex] of Object.entries(GLYPHS)) {
    assert.ok(hex.length === 32 || hex.length === 64, `glyph ${ch} has bad length ${hex.length}`);
    assert.match(hex, /^[0-9A-F]+$/);
  }
  // 字体里没有的字符用「?」代替，不会抛错
  assert.deepEqual(glyphOf('\u{1F600}'), glyphOf('?'));
});

test('character set covers every place label, the time line and printable ASCII', () => {
  for (const label of allPlaceLabels()) assert.deepEqual(missingGlyphs(label), [], `missing glyphs for ${label}`);
  for (const place of CAMPUS_PLACES) assert.deepEqual(missingGlyphs(`${CAMPUS.short}·${place.label}`), []);
  assert.deepEqual(missingGlyphs('0123456789-: 北京时间 年月日'), []);
  for (let c = 0x20; c <= 0x7e; c++) assert.deepEqual(missingGlyphs(String.fromCharCode(c)), []);
});

test('every selectable building watermark, including its manual-selection suffix, has complete glyphs', () => {
  for (const place of CAMPUS_PLACES) {
    const label = placeLabelFor(null, place.id);
    assert.match(label, /（手选）$/);
    assert.deepEqual(missingGlyphs(label), [], `manual building label lacks glyphs: ${label}`);
    for (const character of label) {
      assert.ok(GLYPHS[character], `missing actual glyph for ${character} in ${label}`);
    }
  }
});

test('layout: block size s = max(2, round(min(w,h)/400)), bottom-right, 4s margins, 3s line gap', () => {
  const l = layoutWatermark(1600, 1200, LINES);
  assert.equal(l.s, 3);
  const [place, time] = l.lines;
  // 右对齐：两行右边缘都在 width - 4s
  assert.equal(place.x + place.units * l.s, 1600 - 12);
  assert.equal(time.x + time.units * l.s, 1600 - 12);
  // 下边距 4s，行距 3s
  assert.equal(time.y + GLYPH_HEIGHT * l.s, 1200 - 12);
  assert.equal(time.y - (place.y + GLYPH_HEIGHT * l.s), 3 * l.s);
  assert.equal(time.units, textWidth(LINES[1]));

  assert.equal(layoutWatermark(640, 480, LINES).s, 2);
  assert.equal(layoutWatermark(3000, 2400, LINES).s, 6);
  assert.equal(layoutWatermark(2400, 3000, LINES).s, 6);
  // 时间行在常见 4:3 照片上不超过画面宽度的一半
  assert.ok(time.units * l.s / 1600 < 0.5);
});

test('layout shrinks s (minimum 1) when the text would be too wide, and still fits at the minimum photo size', () => {
  // 240×1200：按短边 s = 2 时时间行宽 448 > 240，缩小到 1
  const narrow = layoutWatermark(240, 1200, LINES);
  assert.equal(narrow.s, 1);
  for (const line of narrow.lines) assert.ok(line.x >= 0, 'text must stay inside the photo');
  const tiny = layoutWatermark(240, 240, LINES);
  assert.equal(tiny.s, 1);
  for (const line of tiny.lines) assert.ok(line.x >= 0 && line.y >= 0);
  // 再窄也不会小于 1，超出的部分被裁掉而不是报错
  const clipped = solid(100, 100, () => [255, 255, 255]);
  assert.equal(paintWatermark(clipped, 100, 100, LINES).s, 1);
});

test('on a pure white photo every stamped pixel is black; on a pure black photo every stamped pixel is white', () => {
  const w = 900;
  const h = 600;
  for (const [bg, expected] of [[255, 0], [0, 255], [200, 0], [60, 255]] as const) {
    const before = solid(w, h, () => [bg, bg, bg]);
    const after = before.slice();
    const layout = paintWatermark(after, w, h, LINES);
    const diff = changes(before, after, w);
    assert.ok(diff.length > 500, 'watermark must change pixels');
    for (const d of diff) assert.deepEqual(d.rgb, [expected, expected, expected]);
    // 改动的像素数 = 点亮的字形像素数 × s²
    const lit = LINES.join('').split('').reduce((n, ch) => n + glyphOf(ch).rows.reduce((m, r) => m + r.toString(2).split('1').length - 1, 0), 0);
    assert.equal(diff.length, lit * layout.s * layout.s);
  }
});

test('luminance uses Rec. 709 weights with a 128 threshold', () => {
  const w = 600;
  const h = 400;
  // 纯绿 (0,180,0)：0.7152×180 ≈ 128.7 → 亮 → 黑字；纯红 (255,0,0)：0.2126×255 ≈ 54 → 暗 → 白字
  for (const [rgb, expected] of [[[0, 180, 0], 0], [[255, 0, 0], 255], [[0, 0, 255], 255]] as const) {
    const before = solid(w, h, () => [...rgb] as [number, number, number]);
    const after = before.slice();
    paintWatermark(after, w, h, LINES);
    for (const d of changes(before, after, w)) assert.deepEqual(d.rgb, [expected, expected, expected]);
  }
});

test('the same line takes black over the light half and white over the dark half', () => {
  const w = 1200;
  const h = 900;
  const layout = layoutWatermark(w, h, LINES);
  const time = layout.lines[1];
  // 分界线落在时间行中间，并对齐到区块网格
  const boundary = time.x + Math.floor(time.units / 2) * layout.s;
  const before = solid(w, h, (x) => (x < boundary ? [240, 240, 240] : [15, 15, 15]));
  const after = before.slice();
  paintWatermark(after, w, h, LINES);
  const row = changes(before, after, w).filter((d) => d.y >= time.y && d.y < time.y + GLYPH_HEIGHT * layout.s);
  const left = row.filter((d) => d.x < boundary);
  const right = row.filter((d) => d.x >= boundary);
  assert.ok(left.length > 0 && right.length > 0);
  for (const d of left) assert.deepEqual(d.rgb, [0, 0, 0]);
  for (const d of right) assert.deepEqual(d.rgb, [255, 255, 255]);
});

test('each glyph pixel follows the average of its own s×s block, not the single pixel under it', () => {
  const w = 900;
  const h = 600;
  const s = layoutWatermark(w, h, LINES).s;
  assert.equal(s, 2);
  // 每个 2×2 区块里 3 个白 1 个黑：平均亮度 191 → 黑字（只看左上角像素会得到白字）
  const before = solid(w, h, (x, y) => (x % 2 === 0 && y % 2 === 0 ? [0, 0, 0] : [255, 255, 255]));
  const after = before.slice();
  paintWatermark(after, w, h, LINES);
  const diff = changes(before, after, w);
  assert.ok(diff.length > 0);
  for (const d of diff) assert.deepEqual(d.rgb, [0, 0, 0]);
});

test('only the bottom-right corner is touched', () => {
  const w = 1600;
  const h = 1200;
  // 有纹理的背景，确保亮度判断两种情况都会出现
  const before = solid(w, h, (x, y) => ((x >> 5) + (y >> 5)) % 2 ? [230, 220, 200] : [30, 40, 50]);
  const after = before.slice();
  const layout = paintWatermark(after, w, h, LINES);
  const diff = changes(before, after, w);
  const minX = Math.min(...layout.lines.map((l) => l.x));
  const minY = layout.lines[0].y;
  assert.ok(diff.length > 0);
  for (const d of diff) {
    assert.ok(d.x >= minX && d.x < w - 4 * layout.s, `x ${d.x} outside the text box`);
    assert.ok(d.y >= minY && d.y < h - 4 * layout.s, `y ${d.y} outside the text box`);
    assert.ok(d.x >= w * 0.4 && d.y >= h * 0.85, 'changes must stay in the bottom-right corner');
  }
  // 透明度通道从不改动
  for (let i = 3; i < after.length; i += 4) assert.equal(after[i], 255);
});

test('stampWatermark decodes, stamps and re-encodes a JPEG without its metadata', () => {
  const w = 640;
  const h = 480;
  const src = jpeg.encode({ data: solid(w, h, () => [250, 250, 250]), width: w, height: h }, 90).data;
  // 在 SOI 后插入一个带相机型号的 EXIF 段，确认输出里被去掉
  const tiff = Buffer.from([0x49, 0x49, 0x2a, 0x00, 0x08, 0, 0, 0, 0x01, 0x00, 0x0f, 0x01, 0x02, 0x00, 0x04, 0, 0, 0, 0x41, 0x42, 0x43, 0, 0, 0, 0, 0]);
  const payload = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff]);
  const app1 = Buffer.concat([Buffer.from([0xff, 0xe1, (payload.length + 2) >> 8, (payload.length + 2) & 0xff]), payload]);
  const withExif = Buffer.concat([src.subarray(0, 2), app1, src.subarray(2)]);
  assert.ok(withExif.includes('Exif'));

  const out = stampWatermark(withExif, LINES);
  assert.equal(out[0], 0xff);
  assert.equal(out[1], 0xd8);
  assert.ok(!out.includes('Exif'), 'EXIF must be stripped');
  const img = jpeg.decode(out, { useTArray: true });
  assert.equal(img.width, w);
  assert.equal(img.height, h);
  const at = (x: number, y: number) => img.data[(y * w + x) * 4];
  // 左上角远离水印，基本不变
  assert.ok(at(20, 20) > 240);
  // 水印区域出现了接近黑色的像素
  const layout = layoutWatermark(w, h, LINES);
  const time = layout.lines[1];
  let darkest = 255;
  for (let y = time.y; y < time.y + GLYPH_HEIGHT * layout.s; y++) {
    for (let x = time.x; x < w - 4 * layout.s; x++) darkest = Math.min(darkest, at(x, y));
  }
  assert.ok(darkest < 40, `expected dark watermark pixels, got ${darkest}`);
  assert.throws(() => stampWatermark(Buffer.from('not a jpeg'), LINES));
});

test('placeLabelFor maps verified building interiors to watermark text', () => {
  assert.equal(placeLabelFor(null), NO_LOCATION_LABEL);
  assert.equal(placeLabelFor({ lat: Number.NaN, lng: 0, accuracy: 10 }), NO_LOCATION_LABEL);
  for (const p of CAMPUS_PLACES.filter((place) => place.automatic)) {
    assert.equal(placeLabelFor({ lat: p.lat, lng: p.lng, accuracy: 5 }), `${CAMPUS.short}·${p.label}`);
  }
  assert.equal(placeLabelFor({ lat: 39.9042, lng: 116.4074, accuracy: 20 }), OFF_CAMPUS_LABEL);
  assert.equal(placeLabelFor({ lat: 22.5, lng: 113.9, accuracy: 20 }), OFF_CAMPUS_LABEL);
  // 南科大中心没有独立的一丹建筑轮廓，不能把综合体自动当成图书馆。
  assert.equal(placeLabelFor({ lat: 22.59998770717294, lng: 113.9923345196037, accuracy: 5 }), CAMPUS.name);
  assert.equal(placeLabelFor(null, 'yidan-library'), '南科大·一丹图书馆（手选）');
});

test('poor GPS precision never expands a building match', () => {
  for (const p of CAMPUS_PLACES) {
    for (const accuracy of [MAX_BUILDING_ACCURACY_M + 1, 120, 150, 5000]) {
      assert.equal(placeLabelFor({ lat: p.lat, lng: p.lng, accuracy }), CAMPUS.name, `${p.id}: ±${accuracy}m`);
    }
  }
});
