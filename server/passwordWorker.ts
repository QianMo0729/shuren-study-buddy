// 密码哈希的工作线程：bcrypt 的计算在这里完成，不占用处理请求的主线程。
// 由 server/passwordPool.ts 启动；不接触数据库。
import { parentPort } from 'node:worker_threads';
import bcrypt from 'bcryptjs';

type Request = { op: 'hash'; password: string; cost: number } | { op: 'verify'; password: string; hash: string };

parentPort!.on('message', (request: Request) => {
  try {
    const value = request.op === 'hash' ? bcrypt.hashSync(request.password, request.cost) : bcrypt.compareSync(request.password, request.hash);
    parentPort!.postMessage({ ok: true, value });
  } catch {
    parentPort!.postMessage({ ok: false });
  }
});
