// misans-webfont 把每个字重注册成不同的字体名（"MiSans"、"MiSans Bold"……），且都是 font-weight: 400。
// 这里把需要的几个字重合并成同一个字体族 "MiSans"，并写上真实的 font-weight，
// 这样 CSS 里直接用 font-weight 400/500/600/700 即可。运行：node scripts/gen-fonts.mjs
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const pkg = path.join(root, 'node_modules/misans-webfont/misans');
const out = path.join(root, 'src/fonts/misans.css');
// 只保留三个字重：400 正文、500 强调、700 标题（600 会自动落到 700）
const WEIGHTS = { 'misans-regular': 400, 'misans-medium': 500, 'misans-bold': 700 };

let css = '/* 由 scripts/gen-fonts.mjs 生成，请勿手动修改 */\n';
for (const [dir, weight] of Object.entries(WEIGHTS)) {
  const src = fs.readFileSync(path.join(pkg, dir, 'result.css'), 'utf8');
  const rel = path.relative(path.dirname(out), path.join(pkg, dir)).split(path.sep).join('/');
  css += src
    .replace(/font-family:\s*"[^"]*"/g, 'font-family:"MiSans"')
    .replace(/font-weight:\s*\d+/g, `font-weight:${weight}`)
    .replace(/url\((["']?)\.\/([^)"']+)\1\)/g, `url("${rel}/$2")`);
  css += '\n';
}
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, css);
console.log('wrote', path.relative(root, out), (css.length / 1024).toFixed(0) + ' KB');
