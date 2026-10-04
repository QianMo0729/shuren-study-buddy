// 打卡照片的服务器水印：把地点与北京时间逐像素“盖”在照片右下角。
// 每个点亮的字形像素对应原图中 s×s 的区块：区块平均亮度 ≥ 128 涂黑，否则涂白，
// 这样无论背景深浅，文字都清晰可读。字形来自 server/watermarkFont.ts（Unifont 点阵）。
import jpeg from 'jpeg-js';
import { GLYPHS, GLYPH_HEIGHT } from './watermarkFont.ts';

const FALLBACK = '?';

export interface Glyph {
  width: number;
  /** 每行一个整数，最高位（第 width-1 位）是最左边的像素 */
  rows: number[];
}

const glyphCache = new Map<string, Glyph>();

/** 取字形；字体里没有的字符用「?」代替 */
export function glyphOf(ch: string): Glyph {
  const cached = glyphCache.get(ch);
  if (cached) return cached;
  const hex = GLYPHS[ch] ?? GLYPHS[FALLBACK];
  const digits = hex.length / GLYPH_HEIGHT;
  const glyph: Glyph = {
    width: digits * 4,
    rows: Array.from({ length: GLYPH_HEIGHT }, (_, i) => parseInt(hex.slice(i * digits, (i + 1) * digits), 16)),
  };
  glyphCache.set(ch, glyph);
  return glyph;
}

export const hasGlyph = (ch: string) => Object.hasOwn(GLYPHS, ch);

/** 文字中字体缺少的字符 */
export const missingGlyphs = (text: string) => [...new Set([...text].filter((ch) => !hasGlyph(ch)))];

/** 一行文字的宽度（字形像素） */
export const textWidth = (text: string) => [...text].reduce((w, ch) => w + glyphOf(ch).width, 0);

export interface WatermarkLine {
  text: string;
  /** 左上角在原图中的位置（像素） */
  x: number;
  y: number;
  /** 宽度（字形像素，乘以 s 才是原图像素） */
  units: number;
}

export interface WatermarkLayout {
  /** 每个字形像素对应的原图像素边长 */
  s: number;
  lines: WatermarkLine[];
}

/**
 * 排版：s = max(2, round(min(w,h)/400))；右对齐放在右下角，右、下边距 4s，行距 3s。
 * 文字放不下时按比例缩小 s（最小 1）。
 */
export function layoutWatermark(width: number, height: number, lines: string[]): WatermarkLayout {
  const texts = lines.filter((t) => t.length > 0);
  const widths = texts.map(textWidth);
  const maxUnits = Math.max(0, ...widths);
  const n = texts.length;
  let s = Math.max(2, Math.round(Math.min(width, height) / 400));
  if (n > 0) {
    // 宽：文字 + 左右各 4s 边距；高：n 行 + (n-1) 个行距 + 上下各 4s 边距
    const fitW = Math.floor(width / (maxUnits + 8));
    const fitH = Math.floor(height / (n * GLYPH_HEIGHT + (n - 1) * 3 + 8));
    s = Math.max(1, Math.min(s, fitW, fitH));
  }
  const margin = 4 * s;
  const out: WatermarkLine[] = texts.map((text, i) => {
    const below = n - 1 - i; // 这一行下面还有几行
    const bottom = height - margin - below * (GLYPH_HEIGHT + 3) * s;
    return { text, units: widths[i], x: width - margin - widths[i] * s, y: bottom - GLYPH_HEIGHT * s };
  });
  return { s, lines: out };
}

/** 区块平均亮度（Rec. 709 系数） */
function blockLuminance(rgba: Uint8Array, width: number, x0: number, y0: number, x1: number, y1: number): number {
  let sum = 0;
  for (let y = y0; y < y1; y++) {
    let i = (y * width + x0) * 4;
    for (let x = x0; x < x1; x++, i += 4) sum += 0.2126 * rgba[i] + 0.7152 * rgba[i + 1] + 0.0722 * rgba[i + 2];
  }
  return sum / ((x1 - x0) * (y1 - y0));
}

/**
 * 在 RGBA 像素数组上原地盖水印（纯函数式的像素操作，便于测试）。
 * 只改动点亮的字形像素对应的区块：背景亮 → 黑 (0,0,0)，背景暗 → 白 (255,255,255)；其余像素保持不变。
 */
export function paintWatermark(rgba: Uint8Array, width: number, height: number, lines: string[]): WatermarkLayout {
  const layout = layoutWatermark(width, height, lines);
  const { s } = layout;
  for (const line of layout.lines) {
    let penX = line.x;
    for (const ch of line.text) {
      const g = glyphOf(ch);
      for (let row = 0; row < GLYPH_HEIGHT; row++) {
        const bits = g.rows[row];
        if (!bits) continue;
        const y0 = line.y + row * s;
        const y1 = Math.min(height, y0 + s);
        if (y1 <= 0 || y0 >= height) continue;
        for (let col = 0; col < g.width; col++) {
          if (!((bits >> (g.width - 1 - col)) & 1)) continue;
          const x0 = penX + col * s;
          const x1 = Math.min(width, x0 + s);
          const cx0 = Math.max(0, x0);
          const cy0 = Math.max(0, y0);
          if (x1 <= cx0) continue;
          // 各字形像素的区块互不重叠，先读后写即等价于按原图取亮度
          const v = blockLuminance(rgba, width, cx0, cy0, x1, y1) >= 128 ? 0 : 255;
          for (let y = cy0; y < y1; y++) {
            let i = (y * width + cx0) * 4;
            for (let x = cx0; x < x1; x++, i += 4) {
              rgba[i] = v;
              rgba[i + 1] = v;
              rgba[i + 2] = v;
            }
          }
        }
      }
      penX += g.width * s;
    }
  }
  return layout;
}

export const DECODE_LIMITS = { maxResolutionInMP: 16, maxMemoryUsageInMB: 512 } as const;
export const STAMP_QUALITY = 88;

/**
 * 解码 JPEG → 盖水印 → 以质量 88 重新编码。重新编码同时去掉了 EXIF 等全部元数据。
 * 解码失败会抛出异常，由调用方转换成用户可读的错误。
 */
export function stampWatermark(input: Buffer, lines: string[]): Buffer {
  const img = jpeg.decode(input, { useTArray: true, formatAsRGBA: true, ...DECODE_LIMITS });
  paintWatermark(img.data, img.width, img.height, lines);
  return jpeg.encode({ data: img.data, width: img.width, height: img.height }, STAMP_QUALITY).data;
}
