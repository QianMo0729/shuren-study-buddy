// 打卡照片盖章的工作线程池。照片由用户提供，解码与编码既耗 CPU 又耗内存，
// 所以：不在主线程上做、同时进行的数量固定、排队长度有上限、单张照片有时限，超出就拒绝而不是堆积。
import os from 'node:os';
import { Worker } from 'node:worker_threads';

export interface StampPoolOptions {
  /** 同时盖章的照片数（工作线程数）。与账号数量无关 */
  workers: number;
  /** 等待中的照片数上限，超出时直接拒绝 */
  maxQueue: number;
  /** 单张照片从开始处理算起的时限，超时即终止该线程 */
  timeoutMs: number;
  /** 空闲线程保留多久后退出 */
  idleMs: number;
  /** 工作线程的 JS 堆上限；像素缓冲区另由 watermark.ts 的 DECODE_LIMITS 限制 */
  maxHeapMb: number;
}

export const STAMP_POOL: StampPoolOptions = {
  workers: Math.max(1, Math.min(2, os.availableParallelism() - 1)),
  maxQueue: 8,
  timeoutMs: 10_000,
  idleMs: 60_000,
  maxHeapMb: 256,
};

export type StampFailure = 'busy' | 'timeout' | 'failed';

export class StampError extends Error {
  reason: StampFailure;
  constructor(reason: StampFailure) {
    super(`stamp ${reason}`);
    this.reason = reason;
  }
}

interface Job {
  jpeg: Buffer;
  lines: string[];
  resolve: (out: Buffer) => void;
  reject: (error: StampError) => void;
}

type Reply = { ok: true; data: Uint8Array } | { ok: false };

export function createStampPool(options: StampPoolOptions = STAMP_POOL, workerUrl = new URL('./stampWorker.ts', import.meta.url)) {
  const idle: { worker: Worker; timer: NodeJS.Timeout; release: () => void }[] = [];
  const queue: Job[] = [];
  let running = 0;

  function start(job: Job) {
    running++;
    const reused = idle.pop();
    if (reused) {
      clearTimeout(reused.timer);
      reused.release();
    }
    const worker = reused?.worker ?? new Worker(workerUrl, { resourceLimits: { maxOldGenerationSizeMb: options.maxHeapMb } });
    // 线程不应阻止进程退出
    worker.unref();
    let settled = false;
    const onMessage = (reply: Reply) => {
      // 解码失败只说明这张照片有问题，线程可以继续使用
      finish(reply.ok ? Buffer.from(reply.data.buffer, reply.data.byteOffset, reply.data.byteLength) : new StampError('failed'), true);
    };
    const onBroken = () => finish(new StampError('failed'), false);
    const finish = (result: Buffer | StampError, reusable: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      // 只摘掉自己挂上的监听器（removeAllListeners 会连 Worker 内部用来接收消息的监听器一起摘掉）
      worker.off('message', onMessage).off('error', onBroken).off('exit', onBroken);
      if (reusable) {
        const retire = () => {
          const at = idle.findIndex((entry) => entry.worker === worker);
          if (at < 0) return;
          clearTimeout(idle[at].timer);
          idle.splice(at, 1);
          worker.off('error', retire).off('exit', retire);
          void worker.terminate();
        };
        const idleTimer = setTimeout(retire, options.idleMs);
        idleTimer.unref();
        // 空闲期间线程意外退出时把它移出池子，不留给下一张照片
        worker.once('error', retire).once('exit', retire);
        idle.push({ worker, timer: idleTimer, release: () => worker.off('error', retire).off('exit', retire) });
      } else {
        // 终止过程中线程若再报错，不能因为没有监听器而变成进程级的未捕获异常
        worker.on('error', () => {});
        void worker.terminate();
      }
      running--;
      if (result instanceof StampError) job.reject(result);
      else job.resolve(result);
      const next = queue.shift();
      if (next) start(next);
    };
    const timer = setTimeout(() => finish(new StampError('timeout'), false), options.timeoutMs);
    worker.once('message', onMessage).once('error', onBroken).once('exit', onBroken);
    worker.postMessage({ jpeg: job.jpeg, lines: job.lines });
  }

  return {
    /** 线程与等待队列都已占满：此时提交的照片会被拒绝 */
    get saturated() {
      return running >= options.workers && queue.length >= options.maxQueue;
    },
    get running() {
      return running;
    },
    get queued() {
      return queue.length;
    },
    /** 盖章；失败时以 StampError 拒绝（busy：已满；timeout：超时；failed：照片无法解码或线程异常） */
    stamp(jpeg: Buffer, lines: string[]): Promise<Buffer> {
      return new Promise<Buffer>((resolve, reject) => {
        const job: Job = { jpeg, lines, resolve, reject };
        if (running < options.workers) start(job);
        else if (queue.length < options.maxQueue) queue.push(job);
        else reject(new StampError('busy'));
      });
    },
    /** 终止全部线程（测试结束时使用） */
    async close() {
      for (const job of queue.splice(0)) job.reject(new StampError('busy'));
      await Promise.all(idle.splice(0).map(({ worker, timer, release }) => {
        clearTimeout(timer);
        release();
        return worker.terminate();
      }));
    },
  };
}

export const stampPool = createStampPool();
