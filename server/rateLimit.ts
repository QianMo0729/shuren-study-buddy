// 进程内限流（固定窗口计数）。不依赖数据库与配置，便于单独测试。
// 键的数量有硬上限；过期清理按固定步数摊到每次调用上，任何请求都不会触发全表扫描。
import net from 'node:net';

interface Bucket {
  count: number;
  reset: number;
}

export interface RateLimiter {
  /** 记一次请求；超出限额、或限流表已满而无法登记新键时返回 false */
  hit(key: string, max: number, windowMs: number, now?: number): boolean;
  readonly size: number;
}

export const RATE_LIMIT_MAX_KEYS = 50_000;

export function createRateLimiter(maxKeys = RATE_LIMIT_MAX_KEYS, sweepPerHit = 8): RateLimiter {
  const buckets = new Map<string, Bucket>();
  // Map 的迭代器在增删之后仍然有效，跨调用保留它就能每次只检查固定的几项
  let cursor: Iterator<[string, Bucket]> | null = null;

  function sweep(now: number) {
    for (let i = 0; i < sweepPerHit; i++) {
      cursor ??= buckets.entries();
      const next = cursor.next();
      if (next.done) {
        cursor = null;
        return;
      }
      if (next.value[1].reset <= now) buckets.delete(next.value[0]);
    }
  }

  return {
    hit(key, max, windowMs, now = Date.now()) {
      sweep(now);
      const b = buckets.get(key);
      if (b && b.reset > now) return ++b.count <= max;
      if (b) {
        b.count = 1;
        b.reset = now + windowMs;
        return true;
      }
      // 表满时拒绝登记新键，而不是挤掉仍在计数的旧键：否则可以用大量新键冲掉别人的登录、验证码限额
      if (buckets.size >= maxKeys) return false;
      buckets.set(key, { count: 1, reset: now + windowMs });
      return true;
    },
    get size() {
      return buckets.size;
    },
  };
}

/**
 * 限流用的来源标识。IPv4（含 ::ffff: 映射）按单个地址；IPv6 按 /64 归并——
 * 一个用户通常拥有整个 /64，逐个地址计数时换一个地址就是一个新的限额。
 */
export function ipKey(ip: string | undefined): string {
  const raw = (ip ?? '').replace(/%.*$/, '');
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(raw);
  if (mapped) return mapped[1];
  if (!net.isIPv6(raw)) return raw || 'unknown';
  const [head, tail] = raw.split('::');
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  const groups = tail === undefined ? left : [...left, ...Array<string>(Math.max(0, 8 - left.length - right.length)).fill('0'), ...right];
  return `${groups.slice(0, 4).map((g) => (parseInt(g, 16) || 0).toString(16)).join(':')}::/64`;
}
