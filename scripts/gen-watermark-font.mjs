// 生成打卡水印用的点阵字体 server/watermarkFont.ts（运行时不依赖系统字体）。
// 直接读取 GNU Unifont 官方 .hex / .hex.gz 点阵，不需要系统字体、浏览器或 Playwright。
//
// 本项目沿用 GNU Unifont 15.1.01（OFL-1.1）；官方来源：
// https://unifoundry.com/pub/unifont/unifont-15.1.01/font-builds/unifont-15.1.01.hex.gz
// 下载文件 SHA-256：6a8d901586ab91bb2a0cc04742850fce6378b1bd32afbaa31eede95fb2ae6701
//
// 运行（使用项目现有的 Node 与 tsx 依赖）：
// UNIFONT_HEX_PATH=/path/to/unifont-15.1.01.hex.gz node scripts/gen-watermark-font.mjs
// 版本默认从文件名识别；重命名文件可另设 UNIFONT_VERSION=15.1.01。
// 修改 shared/campusPlaces.ts 的地点名称后需要重新运行本脚本。
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { tsImport } from 'tsx/esm/api';

const root = path.resolve(import.meta.dirname, '..');
const out = path.join(root, 'server/watermarkFont.ts');
const FONT = process.env.UNIFONT_HEX_PATH;
const HEIGHT = 16;
if (!FONT) throw new Error('请设置 UNIFONT_HEX_PATH，指向官方 unifont-15.1.01.hex 或 .hex.gz 文件');
const version = process.env.UNIFONT_VERSION ?? /unifont(?:_[a-z]+)*-(\d+\.\d+\.\d+)\.hex(?:\.gz)?$/i.exec(path.basename(FONT))?.[1];
if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
  throw new Error('无法识别 Unifont 版本；请保留官方文件名，或设置 UNIFONT_VERSION（例如 15.1.01）');
}

const { allPlaceLabels, CAMPUS } = await tsImport(pathToFileURL(path.join(root, 'shared/campusPlaces.ts')).href, import.meta.url);

// ---------- 字符集 ----------
const ascii = Array.from({ length: 0x7e - 0x20 + 1 }, (_, i) => String.fromCharCode(0x20 + i)).join('');
const fixed = ['北京时间', '年月日时分秒', '·', CAMPUS.name, CAMPUS.short, '南方科技大学校外未提供位置'].join('');
const chars = [...new Set([...ascii, ...fixed, ...allPlaceLabels().join('')])].sort((a, b) => a.codePointAt(0) - b.codePointAt(0));
const wanted = new Map(chars.map((ch) => [ch.codePointAt(0), ch]));

// ---------- 读取原始点阵 ----------
const fontBuf = fs.readFileSync(FONT);
const compressed = fontBuf[0] === 0x1f && fontBuf[1] === 0x8b;
const source = (compressed ? gunzipSync(fontBuf) : fontBuf).toString('utf8');
const glyphs = new Map();
for (const [index, raw] of source.split(/\r?\n/).entries()) {
  const line = raw.trim();
  if (!line || line.startsWith('#')) continue;
  const match = /^([0-9a-f]{4,6}):([0-9a-f]+)$/i.exec(line);
  if (!match) throw new Error(`Unifont .hex 第 ${index + 1} 行格式无效`);
  const ch = wanted.get(Number.parseInt(match[1], 16));
  if (!ch) continue;
  const hex = match[2].toUpperCase();
  if (hex.length !== HEIGHT * 2 && hex.length !== HEIGHT * 4) throw new Error(`字符 ${ch} 不是 8×16 或 16×16 点阵`);
  if (glyphs.has(ch) && glyphs.get(ch) !== hex) throw new Error(`字符 ${ch} 存在冲突字形`);
  glyphs.set(ch, hex);
}
const missing = chars.filter((ch) => !glyphs.has(ch));
if (missing.length) throw new Error(`Unifont ${version} 缺少水印字符：${missing.join('')}`);

// ---------- 输出（验证通过后才覆盖现有字体） ----------
const key = (ch) => (ch === "'" || ch === '\\' ? `'\\${ch}'` : `'${ch}'`);
const lines = chars.map((ch) => `  ${key(ch)}: '${glyphs.get(ch)}',`);
const src = `// 由 scripts/gen-watermark-font.mjs 生成，请勿手动修改。
//
// 字形点阵取自 GNU Unifont ${version}（https://unifoundry.com/unifont/），
// 直接读取官方 .hex 点阵，不经过浏览器栅格化。
// © Roman Czyborra, Paul Hardy, Qianqian Fang 等 Unifont 贡献者。
// Unifont 采用双许可：SIL Open Font License 1.1，或 GNU GPL 2.0+ 附字体嵌入例外；本文件按 OFL-1.1 使用与分发。
// 许可全文：docs/licenses/unifont-OFL-1.1.txt。
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
console.log(`wrote ${path.relative(root, out)}: ${chars.length} glyphs from Unifont ${version}, ${(Buffer.byteLength(src) / 1024).toFixed(1)} KB`);
