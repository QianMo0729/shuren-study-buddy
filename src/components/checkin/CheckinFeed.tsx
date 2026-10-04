import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { Camera, Check } from 'lucide-react';
import type { Checkin, CheckinStats } from '../../../shared/types';
import { api, ApiError } from '../../lib/api';
import { cx } from '../../lib/format';
import { Button, Empty, Segmented } from '../ui';
import { Stamp } from '../brand';
import { CheckinCard, CheckinSkeleton } from './CheckinCard';

type Scope = 'all' | 'buddies' | 'mine';
const SCOPES: { value: Scope; label: string }[] = [
  { value: 'all', label: '全部' },
  { value: 'buddies', label: '我的搭子' },
  { value: 'mine', label: '我的' },
];

// 返回社区时先显示上次的打卡流与范围，再在后台刷新
const cache: { scope: Scope; feeds: Partial<Record<Scope, { items: Checkin[]; hasMore: boolean }>>; stats: CheckinStats | null } = {
  scope: 'all',
  feeds: {},
  stats: null,
};

const EMPTY: Record<Scope, { title: string; desc: string }> = {
  all: { title: '还没有同学打卡', desc: '用网页相机拍一张正在学习的照片，做第一个打卡的人。' },
  buddies: { title: '搭子们还没有打卡', desc: '和同学互相感兴趣后，对方的打卡会出现在这里。' },
  mine: { title: '你还没有打卡', desc: '拍一张正在学习的照片，服务器会盖上时间和地点。' },
};

/** 打卡分区：连续打卡统计、拍照打卡入口、打卡流（全部 / 我的搭子 / 我的） */
export function CheckinFeed() {
  const nav = useNavigate();
  const [scope, setScope] = useState<Scope>(cache.scope);
  const [items, setItems] = useState<Checkin[]>(() => cache.feeds[cache.scope]?.items ?? []);
  const [hasMore, setHasMore] = useState(() => cache.feeds[cache.scope]?.hasMore ?? false);
  const [stats, setStats] = useState<CheckinStats | null>(cache.stats);
  const [loading, setLoading] = useState(!cache.feeds[cache.scope]);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reqId = useRef(0);

  const load = useCallback(async (s: Scope) => {
    const id = ++reqId.current;
    const cached = cache.feeds[s];
    setItems(cached?.items ?? []);
    setHasMore(cached?.hasMore ?? false);
    setLoading(!cached);
    setError(null);
    try {
      const r = await api.checkins.list({ scope: s });
      if (id !== reqId.current) return;
      cache.feeds[s] = r;
      setItems(r.items);
      setHasMore(r.hasMore);
    } catch (e) {
      if (id === reqId.current) setError(e instanceof ApiError ? e.message : '加载失败，请稍后重试');
    } finally {
      if (id === reqId.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    cache.scope = scope;
    void load(scope);
  }, [scope, load]);

  useEffect(() => {
    api.checkins.stats().then((s) => {
      cache.stats = s;
      setStats(s);
    }).catch(() => {});
  }, []);

  const loadMore = async () => {
    if (loadingMore || !hasMore || !items.length) return;
    const id = reqId.current;
    setLoadingMore(true);
    try {
      const r = await api.checkins.list({ scope, before: items[items.length - 1].id });
      if (id !== reqId.current) return;
      const seen = new Set(items.map((c) => c.id));
      const next = [...items, ...r.items.filter((c) => !seen.has(c.id))];
      setItems(next);
      setHasMore(r.hasMore);
      cache.feeds[scope] = { items: next, hasMore: r.hasMore };
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '加载失败，请稍后重试');
    } finally {
      setLoadingMore(false);
    }
  };

  const patch = (id: number, p: Partial<Checkin>) => {
    setItems((list) => {
      const next = list.map((c) => (c.id === id ? { ...c, ...p } : c));
      const cached = cache.feeds[scope];
      if (cached) cache.feeds[scope] = { ...cached, items: next };
      return next;
    });
  };

  const shoot = () => nav('/community/checkin/new');

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,720px)_300px] lg:items-start lg:justify-between lg:gap-8">
      <aside className="lg:sticky lg:top-32 lg:order-2" aria-label="我的打卡统计">
        <StatsPanel stats={stats} onShoot={shoot} />
      </aside>

      <section className="min-w-0 lg:order-1" aria-label="打卡动态">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <Segmented options={SCOPES} value={scope} onChange={(v) => setScope(v as Scope)} />
          {scope === 'buddies' && <p className="text-[13px] text-ink-3">互相感兴趣、正在私聊的同学</p>}
        </div>

        {error && (
          <div className="mb-4 flex items-center justify-between gap-3 rounded-md bg-danger-soft px-4 py-3 text-[14px] text-danger" role="alert">
            <span>{error}</span>
            <button type="button" onClick={() => void load(scope)} className="shrink-0 font-semibold underline underline-offset-2">重试</button>
          </div>
        )}

        {loading ? (
          <div className="space-y-4">
            <CheckinSkeleton />
            <CheckinSkeleton />
          </div>
        ) : items.length === 0 ? (
          !error && (
            <Empty
              title={EMPTY[scope].title}
              desc={EMPTY[scope].desc}
              action={scope === 'buddies'
                ? <Button variant="secondary" onClick={() => nav('/match')}>去匹配推荐看看</Button>
                : <Button variant="primary" icon={<Camera size={16} />} onClick={shoot}>拍照打卡</Button>}
            />
          )
        ) : (
          <div className="mx-auto max-w-[720px] space-y-4 lg:mx-0">
            {items.map((c, i) => (
              <CheckinCard key={c.id} checkin={c} index={i} onOpen={() => nav(`/community/checkins/${c.id}`)} onChange={(p) => patch(c.id, p)} />
            ))}
            {hasMore && (
              <div className="flex justify-center pt-2">
                <Button variant="secondary" loading={loadingMore} onClick={() => void loadMore()}>加载更多</Button>
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

function StatsPanel({ stats, onShoot }: { stats: CheckinStats | null; onShoot: () => void }) {
  return (
    <div className="rounded-md border border-line bg-surface p-4 sm:p-5">
      <div className="flex items-start gap-4">
        <div className="min-w-0 flex-1">
          <p className="text-[13px] text-ink-3">连续打卡</p>
          <p className="mt-0.5 font-display text-ink">
            <span className="text-[40px] leading-none tabular">{stats ? stats.streak : '–'}</span>
            <span className="ml-1 text-[16px]">天</span>
          </p>
          <p className="mt-2 text-[13px] text-ink-3">
            累计 <span className="tabular text-ink-2">{stats ? stats.total : '–'}</span> 次
            <span className="mx-1.5" aria-hidden>·</span>
            {stats?.checkedInToday ? (
              <span className="inline-flex items-center gap-0.5 text-brand-text"><Check size={13} strokeWidth={2.6} aria-hidden />今天已打卡</span>
            ) : (
              <span>今天还没打卡</span>
            )}
          </p>
        </div>
        {/* 服务器盖章：朱砂印章 */}
        <Stamp text="盖章" size={44} rotate={-6} className={cx('mt-1 transition-opacity', stats?.checkedInToday ? 'opacity-100' : 'opacity-25')} />
      </div>
      <Button variant="primary" size="lg" className="mt-4 w-full" icon={<Camera size={17} />} onClick={onShoot}>
        拍照打卡
      </Button>
      <p className="mt-3 text-[12.5px] leading-relaxed text-ink-3">
        照片只能用网页相机现场拍摄，不能从相册上传；拍摄时间和地点由服务器盖章在照片右下角。
      </p>
    </div>
  );
}
