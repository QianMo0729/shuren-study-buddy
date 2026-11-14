// 把小树人原图（docs/mascots/mascot-*.png，1024px 以上、每张约 1.7 MB）导出成网页用的 WebP
// （public/assets/mascot-*.webp，最长边 512px、每张约 30 KB）。页面上最大显示 256px，512px 已覆盖两倍屏。
// 需要 cwebp（macOS：brew install webp）。替换或新增原图后运行：node scripts/gen-mascots.mjs
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const src = path.join(root, 'docs/mascots');
const out = path.join(root, 'public/assets');
const SIDE = 512;

for (const file of fs.readdirSync(src).filter((name) => /^mascot-[a-z-]+\.png$/.test(name)).sort()) {
  const target = path.join(out, file.replace(/\.png$/, '.webp'));
  // -resize 的 0 表示按比例；原图都是正方形
  execFileSync('cwebp', ['-quiet', '-q', '86', '-alpha_q', '100', '-m', '6', '-resize', String(SIDE), '0', path.join(src, file), '-o', target]);
  const kb = (n) => `${(n / 1024).toFixed(0)} KB`;
  console.log(`${file}  ${kb(fs.statSync(path.join(src, file)).size)} → ${path.basename(target)}  ${kb(fs.statSync(target).size)}`);
}
