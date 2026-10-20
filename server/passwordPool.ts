// 密码哈希的工作线程池。bcryptjs 是纯 JS 实现，cost 12 的一次计算要占用 CPU 零点几秒；
// 它的异步接口仍然在主线程上算，几个人同时登录就会让所有请求一起卡住。
// 所以：不在主线程上算、同时计算的数量固定、排队长度有上限，超出就拒绝而不是堆积。
import os from 'node:os';
import { Worker } from 'node:worker_threads';

export interface PasswordPoolOptions {
  /** 同时计算的数量（工作线程数）。线程在第一次用到时启动，之后一直保留 */
  workers: number;
  /** 等待中的请求数上限，超出时直接拒绝 */
  maxQueue: number;
  /** 单次计算从开始算起的时限，超时即终止该线程 */
  timeoutMs: number;
}

export const PASSWORD_POOL: PasswordPoolOptions = {
  workers: Math.max(1, Math.min(2, os.availableParallelism() - 1)),
  maxQueue: 64,
  timeoutMs: 15_000,
};

export type PasswordFailure = 'busy' | 'timeout' | 'failed';

export class PasswordPoolError extends Error {
  reason: PasswordFailure;
  constructor(reason: PasswordFailure) {
    super(`password ${reason}`);
    this.reason = reason;
  }
}

type Request = { op: 'hash'; password: string; cost: number } | { op: 'verify'; password: string; hash: string };
type Reply = { ok: true; value: string | boolean } | { ok: false };

interface Job {
  request: Request;
  resolve: (value: string | boolean) => void;
  reject: (error: PasswordPoolError) => void;
}

export function createPasswordPool(options: PasswordPoolOptions = PASSWORD_POOL, workerUrl = new URL('./passwordWorker.ts', import.meta.url)) {
  const idle: { worker: Worker; release: () => void }[] = [];
  const queue: Job[] = [];
  let running = 0;

  function start(job: Job) {
    running++;
    const reused = idle.pop();
    reused?.release();
    const worker = reused?.worker ?? new Worker(workerUrl);
    // 线程不应阻止进程退出
    worker.unref();
    let settled = false;
    const onMessage = (reply: Reply) => finish(reply.ok ? reply.value : new PasswordPoolError('failed'), true);
    const onBroken = () => finish(new PasswordPoolError('failed'), false);
    const finish = (result: string | boolean | PasswordPoolError, reusable: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      // 只摘掉自己挂上的监听器
      worker.off('message', onMessage).off('error', onBroken).off('exit', onBroken);
      if (reusable) {
        // 空闲期间线程意外退出时把它移出池子，不留给下一次计算
        const retire = () => {
          const at = idle.findIndex((entry) => entry.worker === worker);
          if (at >= 0) idle.splice(at, 1);
          worker.off('error', retire).off('exit', retire);
        };
        worker.once('error', retire).once('exit', retire);
        idle.push({ worker, release: () => worker.off('error', retire).off('exit', retire) });
      } else {
        // 终止过程中线程若再报错，不能因为没有监听器而变成进程级的未捕获异常
        worker.on('error', () => {});
        void worker.terminate();
      }
      running--;
      if (result instanceof PasswordPoolError) job.reject(result);
      else job.resolve(result);
      const next = queue.shift();
      if (next) start(next);
    };
    const timer = setTimeout(() => finish(new PasswordPoolError('timeout'), false), options.timeoutMs);
    worker.once('message', onMessage).once('error', onBroken).once('exit', onBroken);
    worker.postMessage(job.request);
  }

  const submit = (request: Request) =>
    new Promise<string | boolean>((resolve, reject) => {
      const job: Job = { request, resolve, reject };
      if (running < options.workers) start(job);
      else if (queue.length < options.maxQueue) queue.push(job);
      else reject(new PasswordPoolError('busy'));
    });

  return {
    get running() {
      return running;
    },
    get queued() {
      return queue.length;
    },
    /** 计算密码哈希；失败时以 PasswordPoolError 拒绝（busy：已满；timeout：超时；failed：线程异常） */
    hash: (password: string, cost: number) => submit({ op: 'hash', password, cost }) as Promise<string>,
    /** 校验密码；hash 不是合法的 bcrypt 哈希时结果为 false */
    verify: (password: string, hash: string) => submit({ op: 'verify', password, hash }) as Promise<boolean>,
    /** 终止全部线程（测试结束时使用） */
    async close() {
      for (const job of queue.splice(0)) job.reject(new PasswordPoolError('busy'));
      await Promise.all(idle.splice(0).map(({ worker, release }) => {
        release();
        return worker.terminate();
      }));
    },
  };
}

export const passwordPool = createPasswordPool();
