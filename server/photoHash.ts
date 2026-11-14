// 打卡照片指纹：盖章线程计算（server/watermark.ts），抽检时比较（server/audits.ts）。不依赖解码库，主线程也可以引用。

/**
 * 照片指纹（dHash，64 位十六进制）：把画面缩成 9×8 的灰度图，比较每一行相邻两格的明暗。
 * 同一部手机在同一个位置先后拍的两张照片，指纹几乎一样；两个人各拍自己的书桌，指纹差别很大。
 * 只用来提示审核员「两人的照片几乎一样」，不能还原照片内容。
 */
export function photoHash(rgba: Uint8Array, width: number, height: number): string {
  const cols = 9;
  const rows = 8;
  const grid = new Float64Array(cols * rows);
  for (let gy = 0; gy < rows; gy++) {
    const y0 = Math.floor((gy * height) / rows);
    const y1 = Math.max(y0 + 1, Math.floor(((gy + 1) * height) / rows));
    for (let gx = 0; gx < cols; gx++) {
      const x0 = Math.floor((gx * width) / cols);
      const x1 = Math.max(x0 + 1, Math.floor(((gx + 1) * width) / cols));
      // 隔点取样：精度足够，速度快几倍
      const step = Math.max(1, Math.floor(Math.min(x1 - x0, y1 - y0) / 16));
      let sum = 0;
      let n = 0;
      for (let y = y0; y < y1; y += step) {
        let i = (y * width + x0) * 4;
        for (let x = x0; x < x1; x += step, i += 4 * step) {
          sum += 0.2126 * rgba[i] + 0.7152 * rgba[i + 1] + 0.0722 * rgba[i + 2];
          n++;
        }
      }
      grid[gy * cols + gx] = sum / n;
    }
  }
  let hex = '';
  for (let gy = 0; gy < rows; gy++) {
    let byte = 0;
    for (let gx = 0; gx < cols - 1; gx++) byte = (byte << 1) | (grid[gy * cols + gx] > grid[gy * cols + gx + 1] ? 1 : 0);
    hex += byte.toString(16).padStart(2, '0');
  }
  return hex;
}

/** 两个指纹有几位不同（0–64）；格式不对时返回 64 */
export function hashDistance(a: string, b: string): number {
  if (!/^[0-9a-f]{16}$/.test(a) || !/^[0-9a-f]{16}$/.test(b)) return 64;
  let d = 0;
  for (let i = 0; i < 16; i += 2) {
    let x = parseInt(a.slice(i, i + 2), 16) ^ parseInt(b.slice(i, i + 2), 16);
    while (x) { d += x & 1; x >>= 1; }
  }
  return d;
}
