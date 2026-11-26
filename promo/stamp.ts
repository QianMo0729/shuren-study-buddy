// 用服务器真实的水印代码（server/watermark.ts）给打卡照片盖章，视频里的水印和线上一模一样。
//   npx tsx promo/stamp.ts
// 输入 promo/build/desk-{a,b}.jpg，输出取景预览（秒数在走）和最终盖章的照片。
import fs from 'node:fs';
import { stampWatermark } from '../server/watermark.ts';

const PLACE = '南科大·琳恩图书馆';
const shots = [
  { src: 'desk-a', date: '2026-10-28', hms: [18, 4, 9], frames: 4 }, // 白鹭
  { src: 'desk-b', date: '2026-10-28', hms: [18, 21, 34], frames: 4 }, // 木棉
];
const pad = (n: number) => String(n).padStart(2, '0');
for (const s of shots) {
  const input = fs.readFileSync(`promo/build/${s.src}.jpg`);
  for (let i = 0; i < s.frames; i++) {
    const [h, m, sec] = s.hms;
    const text = `${s.date} ${pad(h)}:${pad(m)}:${pad(sec + i)} 北京时间`;
    fs.writeFileSync(`promo/build/${s.src}-${i}.jpg`, stampWatermark(input, [PLACE, text]));
    console.log(s.src, i, text);
  }
}
