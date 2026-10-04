// 生成打卡水印用的点阵字体 server/watermarkFont.ts（运行时不依赖系统字体）。
//
// 做法：用 Playwright 启动 Chromium，在 canvas 上以 16px 的 GNU Unifont（像素字体，每个字形正好是
// 8×16 或 16×16 的点阵）逐字绘制，按透明度阈值化为 1 bit，写成与 Unifont .hex 相同的十六进制行格式。
//
// 运行：npx tsx scripts/gen-watermark-font.mjs（Node ≥ 22.18 也可直接 node scripts/gen-watermark-font.mjs）
// 依赖（均为本机环境，不是项目依赖）：
//   - 系统安装的 Unifont：fc-list | grep -i unifont（Debian/Ubuntu: apt install fonts-unifont）
//   - 全局安装的 Playwright 与 Chromium
// 可用环境变量覆盖路径：UNIFONT_PATH、PLAYWRIGHT_PATH、CHROMIUM_PATH。
//
// 修改 shared/campusPlaces.ts 的地点名称后需要重新运行本脚本。
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');
const out = path.join(root, 'server/watermarkFont.ts');
const FONT = process.env.UNIFONT_PATH ?? '/usr/share/fonts/opentype/unifont/unifont.otf';
const PLAYWRIGHT = process.env.PLAYWRIGHT_PATH ?? '/opt/node22/lib/node_modules/playwright';
const CHROMIUM = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const HEIGHT = 16;

const { allPlaceLabels, CAMPUS } = await import(pathToFileURL(path.join(root, 'shared/campusPlaces.ts')).href);

// ---------- 字符集 ----------

const ascii = Array.from({ length: 0x7e - 0x20 + 1 }, (_, i) => String.fromCharCode(0x20 + i)).join('');
// 水印固定文字：地点、时间行「YYYY-MM-DD HH:mm:ss 北京时间」，以及预留的日期写法
const fixed = ['北京时间', '年月日时分秒', '·', CAMPUS.name, CAMPUS.short, '南方科技大学校外未提供位置'].join('');
const chars = [...new Set([...ascii, ...fixed, ...allPlaceLabels().join('')])].sort((a, b) => a.codePointAt(0) - b.codePointAt(0));

// ---------- 读取字体版本（OpenType name 表，nameID 5） ----------

function fontVersion(buf) {
  const numTables = buf.readUInt16BE(4);
  for (let i = 0; i < numTables; i++) {
    const rec = 12 + i * 16;
    if (buf.toString('latin1', rec, rec + 4) !== 'name') continue;
    const base = buf.readUInt32BE(rec + 8);
    const count = buf.readUInt16BE(base + 2);
    const strings = base + buf.readUInt16BE(base + 4);
    for (let j = 0; j < count; j++) {
      const r = base + 6 + j * 12;
      const [platform, , , nameId, length, offset] = [0, 2, 4, 6, 8, 10].map((o) => buf.readUInt16BE(r + o));
      if (nameId !== 5) continue;
      const raw = buf.subarray(strings + offset, strings + offset + length);
      if (platform === 1) return raw.toString('latin1').trim();
      if (platform === 3 || platform === 0) return Buffer.from(raw).swap16().toString('utf16le').trim();
    }
  }
  return 'unknown';
}

const fontBuf = fs.readFileSync(FONT);
const version = fontVersion(fontBuf).replace(/^Version\s*/i, '');

// ---------- 用 Chromium 渲染 ----------

const require = createRequire(import.meta.url);
const { chromium } = require(PLAYWRIGHT);
const browser = await chromium.launch({ executablePath: CHROMIUM });
let glyphs;
try {
  const page = await browser.newPage();
  // 用 data URL 加载字体，确保渲染的一定是这份 Unifont，而不是系统里的其他字体
  await page.setContent(`<!doctype html><style>@font-face{font-family:WMUnifont;src:url(data:font/otf;base64,${fontBuf.toString('base64')})}</style>`);
  glyphs = await page.evaluate(async ({ chars, HEIGHT }) => {
    await document.fonts.load(`${HEIGHT}px WMUnifont`, chars.join(''));
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 32;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.font = `${HEIGHT}px WMUnifont`;
    ctx.textBaseline = 'alphabetic';
    const result = {};
    for (const ch of chars) {
      if (!document.fonts.check(`${HEIGHT}px WMUnifont`, ch)) throw new Error(`字体缺少字符 ${ch}`);
      const m = ctx.measureText(ch);
      const width = Math.round(m.width);
      const ascent = Math.round(m.fontBoundingBoxAscent);
      const descent = Math.round(m.fontBoundingBoxDescent);
      if (ascent + descent !== HEIGHT) throw new Error(`字体高度异常：${ascent}+${descent}`);
      if (width !== 8 && width !== 16) throw new Error(`字符 ${ch} 宽度异常：${m.width}`);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#000';
      ctx.fillText(ch, 8, 8 + ascent);
      // 画布四周留白，检查字形没有画出 width × 16 的格子
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      const rows = [];
      let blurry = 0;
      for (let y = 0; y < canvas.height; y++) {
        let bits = '';
        for (let x = 0; x < canvas.width; x++) {
          const a = data[(y * canvas.width + x) * 4 + 3];
          if (a > 0 && a < 255) blurry++;
          const inside = x >= 8 && x < 8 + width && y >= 8 && y < 8 + HEIGHT;
          if (a >= 128 && !inside) throw new Error(`字符 ${ch} 超出点阵格子`);
          if (inside) bits += a >= 128 ? '1' : '0';
        }
        if (y >= 8 && y < 8 + HEIGHT) rows.push(bits);
      }
      // Unifont 的轮廓都对齐像素网格，渲染结果应当没有半透明的抗锯齿像素
      if (blurry) throw new Error(`字符 ${ch} 渲染出 ${blurry} 个半透明像素，可能没有使用 Unifont`);
      result[ch] = rows;
    }
    return result;
  }, { chars, HEIGHT });
} finally {
  await browser.close();
}

// ---------- 输出 ----------

const toHex = (rows) => rows.map((bits) => parseInt(bits, 2).toString(16).toUpperCase().padStart(bits.length / 4, '0')).join('');
const key = (ch) => (ch === "'" || ch === '\\' ? `'\\${ch}'` : `'${ch}'`);
const lines = chars.map((ch) => `  ${key(ch)}: '${toHex(glyphs[ch])}',`);

const src = `// 由 scripts/gen-watermark-font.mjs 生成，请勿手动修改。
//
// 字形点阵取自 GNU Unifont ${version}（https://unifoundry.com/unifont/），
// © Roman Czyborra, Paul Hardy, Qianqian Fang 等 Unifont 贡献者。
// Unifont 采用双许可：SIL Open Font License 1.1，或 GNU GPL 2.0+ 附字体嵌入例外；本文件按 OFL-1.1 使用与分发。
//
// 格式与 Unifont 的 .hex 相同：每个字形 ${HEIGHT} 行，自上而下；每行按字宽写成十六进制，最高位是最左边的像素。
// 字宽 8 像素的字形共 ${HEIGHT * 2} 个十六进制字符，16 像素的共 ${HEIGHT * 4} 个。

export const GLYPH_HEIGHT = ${HEIGHT};

/** 字体来源版本（用于署名） */
export const GLYPH_SOURCE = 'GNU Unifont ${version}';

export const GLYPHS: Record<string, string> = {
${lines.join('\n')}
};
`;
fs.writeFileSync(out, src);
console.log(`wrote ${path.relative(root, out)}: ${chars.length} glyphs from Unifont ${version}, ${(src.length / 1024).toFixed(1)} KB`);
