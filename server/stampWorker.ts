// 打卡照片盖章的工作线程：解码、盖水印、重新编码都在这里完成，不占用处理请求的主线程。
// 由 server/stampPool.ts 启动；只依赖水印模块，不接触数据库。
import { parentPort } from 'node:worker_threads';
import { stampAndHash } from './watermark.ts';

parentPort!.on('message', ({ jpeg, lines }: { jpeg: Uint8Array; lines: string[] }) => {
  try {
    const { image, hash } = stampAndHash(Buffer.from(jpeg.buffer, jpeg.byteOffset, jpeg.byteLength), lines);
    const out = new Uint8Array(image);
    parentPort!.postMessage({ ok: true, data: out, hash }, [out.buffer]);
  } catch {
    parentPort!.postMessage({ ok: false });
  }
});
