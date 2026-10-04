import { motion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { Megaphone, Search, X } from 'lucide-react';
import { POST_CATEGORIES } from '../../shared/options';
import type { Post } from '../../shared/types';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { cx } from '../lib/format';
import { spring } from '../lib/motion';
import { useToast } from '../lib/toast';
import { Button, Empty, PageHeader, Skeleton } from '../components/ui';
import { PostCard } from '../components/PostCard';
import { TakedownDialog } from '../components/moderation';
import { Illustration } from '../components/brand';

/** embedded：嵌入「校园社区 · 招募」时不显示页面标题 */
export function Events({ embedded = false }: { embedded?: boolean } = {}) {
  const { user } = useAuth();
  const toast = useToast();
  const nav = useNavigate();
  const [items, setItems] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [category, setCategory] = useState('');
  const [takedown, setTakedown] = useState<Post | null>(null);
  const req = useRef(0);

  const load = async (query = q, cat = category) => {
    const id = ++req.current;
    setLoading(true);
    try {
      const r = await api.posts({ q: query.trim(), category: cat });
      if (id === req.current) setItems(r.items);
    } catch (e) {
      toast.error('加载失败', e instanceof ApiError ? e.message : undefined);
    } finally {
      if (id === req.current) setLoading(false);
    }
  };

  useEffect(() => {
    const t = setTimeout(() => load(q, category), q ? 300 : 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, category]);

  const patch = (id: number, p: Partial<Post>) => setItems((xs) => xs.map((x) => (x.id === id ? { ...x, ...p } : x)));
  const open = items.filter((i) => i.status === 'open').length;

  return (
    <div>
      {embedded ? (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-[14px] text-ink-2">同学们发起的学习招募。看到合适的就点「我感兴趣」，发起人会收到通知。</p>
          <Button variant="primary" icon={<Megaphone size={16} />} onClick={() => nav('/events/new')}>
            发起招募
          </Button>
        </div>
      ) : (
        <PageHeader
          title="活动大厅"
          desc="同学们发起的学习招募。看到合适的就点「我感兴趣」，发起人会收到通知。"
          actions={
            <Button variant="primary" icon={<Megaphone size={16} />} onClick={() => nav('/events/new')}>
              发起招募
            </Button>
          }
        />
      )}

      <label className="flex h-11 items-center gap-2.5 rounded-lg border border-line-strong bg-surface px-3.5 transition-[border-color,box-shadow] focus-within:border-brand focus-within:shadow-[0_0_0_3px_var(--brand-soft)]">
        <Search size={17} className="shrink-0 text-ink-3" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="搜索活动，例如：雅思口语、数分、羽毛球"
          className="h-full min-w-0 flex-1 bg-transparent text-[16px] outline-none placeholder:text-ink-4 sm:text-[15px]"
          aria-label="搜索活动"
          enterKeyHint="search"
        />
        {q && (
          <button onClick={() => setQ('')} className="grid size-6 place-items-center rounded-full bg-paper-2 text-ink-3 hover:text-ink" aria-label="清空">
            <X size={13} />
          </button>
        )}
      </label>

      <div className="-mx-4 mt-3 flex gap-5 overflow-x-auto border-b border-line px-4 no-scrollbar sm:mx-0 sm:px-0" role="tablist">
        {[{ value: '', label: '全部' }, ...POST_CATEGORIES].map((c) => {
          const on = c.value === category;
          return (
            <button key={c.value} role="tab" aria-selected={on} onClick={() => setCategory(c.value)} className={cx('relative shrink-0 py-2.5 text-[14px] transition-colors', on ? 'font-semibold text-ink' : 'text-ink-3 hover:text-ink')}>
              {c.label}
              {on && <motion.span layoutId="cat-underline" transition={spring} className="absolute inset-x-0 -bottom-px h-[2px] bg-ink" />}
            </button>
          );
        })}
      </div>

      <p className="mt-4 mb-3 text-[13.5px] text-ink-3">
        {loading ? '加载中…' : q || category ? `找到 ${items.length} 条` : `${open} 条正在招募`}
      </p>

      {loading && !items.length ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-64 rounded-xl" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <Empty
          art={<Illustration name="mascot-megaphone" className="mb-4 size-28" />}
          title={q || category ? '没有找到相关的招募' : '还没有人发起招募'}
          desc="可以由你来发起第一条，比如「期末数分互助，每周六下午」。"
          action={
            <Button variant="primary" icon={<Megaphone size={15} />} onClick={() => nav('/events/new')}>
              发起招募
            </Button>
          }
        />
      ) : (
        <div className={cx('grid gap-3 transition-opacity md:grid-cols-2 xl:grid-cols-3', loading && 'opacity-60')}>
          {items.map((p) => (
            <PostCard key={p.id} post={p} onOpen={() => nav(`/events/${p.id}`)} onChange={(x) => patch(p.id, x)} isAdmin={user?.role === 'admin'} onTakedown={() => setTakedown(p)} />
          ))}
        </div>
      )}

      {takedown && <TakedownDialog open onClose={() => setTakedown(null)} type="post" id={takedown.id} label={takedown.title} onDone={() => load()} />}
    </div>
  );
}
