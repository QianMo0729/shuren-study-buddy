// 取景框里的水印预览：用与服务器相同的 Unifont 点阵和排版规则，按画面亮度逐“像素”取黑或白。
// 仅用于预览——照片提交后由服务器重新盖章（server/watermark.ts），以服务器结果为准。
// 字形数据直接复用服务器生成的 server/watermarkFont.ts（纯数据，无依赖）。
import { GLYPHS, GLYPH_HEIGHT } from '../../../server/watermarkFont';

interface Glyph {
  width: number;
  rows: number[];
}

const cache = new Map<string, Glyph>();

function glyphOf(ch: string): Glyph {
  let g = cache.get(ch);
  if (!g) {
    const hex = GLYPHS[ch] ?? GLYPHS['?'];
    const digits = hex.length / GLYPH_HEIGHT;
    g = { width: digits * 4, rows: Array.from({ length: GLYPH_HEIGHT }, (_, i) => parseInt(hex.slice(i * digits, (i + 1) * digits), 16)) };
    cache.set(ch, g);
  }
  return g;
}

const textWidth = (text: string) => [...text].reduce((w, ch) => w + glyphOf(ch).width, 0);

/** 预览区域在照片中的位置（照片像素）与字形点阵 */
export interface PreviewLayout {
  s: number;
  /** 文字外框（照片像素） */
  box: { x: number; y: number; w: number; h: number };
  /** 外框内的点阵尺寸（每个点 = 照片中 s×s 像素） */
  cols: number;
  rows: number;
  lines: { text: string; col: number; row: number }[];
}

/** 与 server/watermark.ts 的 layoutWatermark 相同：s = max(2, round(min(w,h)/400))，右下角，边距 4s，行距 3s */
export function previewLayout(width: number, height: number, lines: string[]): PreviewLayout | null {
  const texts = lines.filter(Boolean);
  if (!texts.length || width <= 0 || height <= 0) return null;
  const widths = texts.map(textWidth);
  const cols = Math.max(...widths);
  const n = texts.length;
  const rows = n * GLYPH_HEIGHT + (n - 1) * 3;
  let s = Math.max(2, Math.round(Math.min(width, height) / 400));
  s = Math.max(1, Math.min(s, Math.floor(width / (cols + 8)), Math.floor(height / (rows + 8))));
  const box = { x: width - 4 * s - cols * s, y: height - 4 * s - rows * s, w: cols * s, h: rows * s };
  return {
    s,
    box,
    cols,
    rows,
    lines: texts.map((text, i) => ({ text, col: cols - widths[i], row: i * (GLYPH_HEIGHT + 3) })),
  };
}

/**
 * 把水印画到预览画布上：canvas 的尺寸等于点阵尺寸（cols × rows），由 CSS 放大并保持像素锐利。
 * sample 是同样尺寸、已画入对应画面区域的取样画布：每个点的颜色近似为原图 s×s 区块的平均色。
 */
export function paintPreview(target: HTMLCanvasElement, sample: CanvasRenderingContext2D, layout: PreviewLayout) {
  const { cols, rows } = layout;
  if (target.width !== cols || target.height !== rows) {
    target.width = cols;
    target.height = rows;
  }
  const ctx = target.getContext('2d');
  if (!ctx) return;
  const src = sample.getImageData(0, 0, cols, rows).data;
  const out = ctx.createImageData(cols, rows);
  const px = out.data;
  for (const line of layout.lines) {
    let col0 = line.col;
    for (const ch of line.text) {
      const g = glyphOf(ch);
      for (let r = 0; r < GLYPH_HEIGHT; r++) {
        const bits = g.rows[r];
        if (!bits) continue;
        for (let c = 0; c < g.width; c++) {
          if (!((bits >> (g.width - 1 - c)) & 1)) continue;
          const i = ((line.row + r) * cols + col0 + c) * 4;
          const lum = 0.2126 * src[i] + 0.7152 * src[i + 1] + 0.0722 * src[i + 2];
          const v = lum >= 128 ? 0 : 255;
          px[i] = v;
          px[i + 1] = v;
          px[i + 2] = v;
          px[i + 3] = 255;
        }
      }
      col0 += g.width;
    }
  }
  ctx.putImageData(out, 0, 0);
}

// ---------- 北京时间 ----------

/** YYYY-MM-DD HH:mm:ss 北京时间（UTC+8，中国不实行夏令时） */
export function beijingStamp(ms: number) {
  const s = new Date(ms + 8 * 3600_000).toISOString();
  return `${s.slice(0, 10)} ${s.slice(11, 19)} 北京时间`;
}
