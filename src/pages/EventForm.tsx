import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useState, type KeyboardEvent } from 'react';
import { useNavigate, useParams } from 'react-router';
import { ChevronLeft, Minus, Plus, X } from 'lucide-react';
import { POST_CATEGORIES } from '../../shared/options';
import type { Post } from '../../shared/types';
import { api, ApiError, type PostInput } from '../lib/api';
import { useAuth } from '../lib/auth';
import { ease } from '../lib/motion';
import { useToast } from '../lib/toast';
import { Button, ChipGroup, Field, Input, PageHeader, Skeleton, Textarea } from '../components/ui';
import { PostCard } from '../components/PostCard';

const TEMPLATES: (Partial<PostInput> & { label: string })[] = [
  { label: '雅思口语练习', title: '雅思口语练习 · 互相模考', category: 'lang', tags: ['雅思', '口语'], description: '每次 1 小时：抽 Part 2 题卡轮流作答，互相计时、纠音、给反馈。希望找目标 6.5–7 分的同学一起坚持。' },
  { label: '期末数分互助', title: '数学分析期末互助', category: 'course', tags: ['数分', '期末'], description: '一起刷往年题，每人负责讲一章的重点和易错点，讲不明白的地方一起讨论。' },
  { label: '考研自习打卡', title: '考研自习 · 每日打卡', category: 'grad', tags: ['考研', '打卡'], description: '每天固定时间到图书馆自习，开始和结束时在群里打卡，互相监督，周末交流一次进度。' },
  { label: '周末羽毛球', title: '周末羽毛球 · 学累了动一动', category: 'sport', tags: ['羽毛球'], description: '学习之余一起打球放松，水平不限，开心就好。' },
];
const TIME_PRESETS = ['每周二、四晚 19:00', '工作日晚上', '周末下午', '每天早上 8:00', '时间可商量'];
const PLACE_PRESETS = ['琳恩图书馆', '一丹图书馆', '涵泳图书馆', '书院 24h 自习室', '线上连麦'];

const empty: PostInput = { title: '', category: '', description: '', timeText: '', location: '', capacity: 4, tags: [] };

export function EventForm() {
  const { id } = useParams();
  const editing = !!id;
  const { user } = useAuth();
  const toast = useToast();
  const nav = useNavigate();
  const [form, setForm] = useState<PostInput>(empty);
  const [loading, setLoading] = useState(editing);
  const [busy, setBusy] = useState(false);
  const [tagInput, setTagInput] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!editing) return;
    api
      .post(Number(id))
      .then(({ post }) => {
        if (!post.isMine) return nav(`/events/${id}`, { replace: true });
        setForm({ title: post.title, category: post.category, description: post.description, timeText: post.timeText, location: post.location, capacity: post.capacity, tags: post.tags });
      })
      .catch((e) => toast.error('加载失败', e.message))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const set = <K extends keyof PostInput>(k: K, v: PostInput[K]) => setForm((f) => ({ ...f, [k]: v }));
  const addTag = () => {
    const t = tagInput.trim().replace(/^#/, '').slice(0, 10);
    if (t && !form.tags.includes(t) && form.tags.length < 6) set('tags', [...form.tags, t]);
    setTagInput('');
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = editing ? await api.updatePost(Number(id), form) : await api.createPost(form);
      toast.success(editing ? '已保存修改' : '招募已发布', editing ? undefined : '感兴趣的同学会通过你的主页联系你');
      nav(`/events/${r.post.id}`, { replace: true });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '发布失败');
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <Skeleton className="mt-10 h-96 rounded-xl" />;

  const preview: Post = {
    id: 0,
    ...form,
    title: form.title || '你的招募标题',
    description: form.description || '在这里描述活动内容、频率和对搭子的期待…',
    timeText: form.timeText || '时间',
    location: form.location || '地点',
    category: form.category || 'other',
    status: 'open',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    interestCount: 0,
    interested: false,
    isMine: true,
    author: { id: user?.id ?? 0, nickname: user?.nickname ?? '我', major: '', studyType: '', cover: null, published: true },
  };

  return (
    <div>
      <button onClick={() => nav(-1)} className="-ml-1 mt-5 inline-flex items-center gap-0.5 text-[14px] text-ink-2 hover:text-ink sm:mt-8">
        <ChevronLeft size={17} /> 返回
      </button>
      <PageHeader className="pt-3 sm:pt-4" title={editing ? '编辑招募' : '发起招募'} desc="写清楚时间、地点和人数，感兴趣的同学会通过你的主页联系你。" />

      {!user?.published && !editing && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl bg-surface px-4 py-3 text-[14px] text-ink-2">
          <span className="flex-1">发起招募前，需要先把你的主页上传到搭子广场，这样感兴趣的同学才能找到你。</span>
          <Button size="sm" variant="dark" onClick={() => nav('/me/edit')}>
            去完善主页
          </Button>
        </div>
      )}

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-6 rounded-xl bg-surface p-5 sm:p-7">
          {!editing && (
            <div>
              <p className="mb-2 text-[13.5px] text-ink-3">可以从模板开始改</p>
              <div className="flex flex-wrap gap-1.5">
                {TEMPLATES.map((t) => (
                  <button
                    key={t.label}
                    onClick={() => setForm((f) => ({ ...f, title: t.title!, category: t.category!, tags: t.tags!, description: t.description! }))}
                    className="h-8 rounded-md bg-paper-2 px-2.5 text-[13px] text-ink-2 transition-colors hover:bg-brand-soft hover:text-brand-text"
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
          )}
          <Field label="招募标题" required>
            <Input value={form.title} onChange={(e) => set('title', e.target.value)} maxLength={30} placeholder="如：雅思口语练习 · 互相模考" />
          </Field>
          <Field label="分类" required>
            <ChipGroup options={POST_CATEGORIES} value={form.category ? [form.category] : []} onChange={(v) => set('category', v[0] ?? '')} />
          </Field>
          <div className="grid gap-6 sm:grid-cols-2">
            <Field label="时间" required>
              <Input value={form.timeText} onChange={(e) => set('timeText', e.target.value)} maxLength={40} placeholder="如：每周二、四晚 19:00" />
              <Presets items={TIME_PRESETS} onPick={(v) => set('timeText', v)} />
            </Field>
            <Field label="地点" required>
              <Input value={form.location} onChange={(e) => set('location', e.target.value)} maxLength={30} placeholder="如：一丹图书馆" />
              <Presets items={PLACE_PRESETS} onPick={(v) => set('location', v)} />
            </Field>
          </div>
          <Field label="招募人数" hint="设为 0 表示不限人数">
            <div className="inline-flex items-center rounded-lg border border-line-strong bg-surface">
              <button onClick={() => set('capacity', Math.max(0, form.capacity - 1))} className="grid size-10 place-items-center rounded-l-lg text-ink-2 hover:bg-paper-2" aria-label="减少">
                <Minus size={15} />
              </button>
              <AnimatePresence mode="popLayout" initial={false}>
                <motion.span key={form.capacity} initial={{ y: -10, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 10, opacity: 0 }} transition={{ duration: 0.18, ease }} className="tabular w-16 text-center text-[15px] font-semibold text-ink">
                  {form.capacity || '不限'}
                </motion.span>
              </AnimatePresence>
              <button onClick={() => set('capacity', Math.min(50, form.capacity + 1))} className="grid size-10 place-items-center rounded-r-lg text-ink-2 hover:bg-paper-2" aria-label="增加">
                <Plus size={15} />
              </button>
            </div>
          </Field>
          <Field label="活动介绍" required>
            <Textarea value={form.description} onChange={(e) => set('description', e.target.value)} maxLength={500} placeholder="活动内容、频率、对搭子的期待……" className="min-h-36" />
          </Field>
          <Field label="标签" optional hint="回车添加，最多 6 个；会参与活动大厅的关键词检索">
            <div className="flex min-h-11 flex-wrap items-center gap-1.5 rounded-lg border border-line-strong bg-surface px-2.5 py-1.5 focus-within:border-brand focus-within:shadow-[0_0_0_3px_var(--brand-soft)]">
              <AnimatePresence initial={false}>
                {form.tags.map((t) => (
                  <motion.span key={t} layout initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.6, opacity: 0 }} className="inline-flex items-center gap-1 rounded-md bg-brand-soft py-1 pr-1 pl-2 text-[13px] text-brand-text">
                    # {t}
                    <button onClick={() => set('tags', form.tags.filter((x) => x !== t))} className="grid size-5 place-items-center rounded hover:bg-brand/15" aria-label={`删除 ${t}`}>
                      <X size={11} />
                    </button>
                  </motion.span>
                ))}
              </AnimatePresence>
              <input
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
                  if ((e.key === 'Enter' || e.key === ',' || e.key === '，') && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    addTag();
                  }
                  if (e.key === 'Backspace' && !tagInput && form.tags.length) set('tags', form.tags.slice(0, -1));
                }}
                onBlur={addTag}
                placeholder={form.tags.length ? '' : '如：雅思、口语'}
                className="h-8 min-w-24 flex-1 bg-transparent px-1 text-[16px] outline-none sm:text-[15px]"
              />
            </div>
          </Field>

          <AnimatePresence>
            {error && (
              <motion.p initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="rounded-lg bg-danger-soft px-4 py-3 text-[14px] text-danger">
                {error}
              </motion.p>
            )}
          </AnimatePresence>
          <Button variant="primary" size="lg" className="w-full" loading={busy} onClick={submit}>
            {editing ? '保存修改' : '发布招募'}
          </Button>
        </div>

        <aside className="hidden lg:block">
          <div className="sticky top-20">
            <p className="mb-3 text-[13px] font-semibold text-ink-3">在活动大厅里的样子</p>
            <div className="pointer-events-none">
              <PostCard post={preview} onOpen={() => {}} onChange={() => {}} />
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

function Presets({ items, onPick }: { items: string[]; onPick: (v: string) => void }) {
  return (
    <div className="mt-2 flex flex-wrap gap-1">
      {items.map((i) => (
        <button key={i} onClick={() => onPick(i)} className="rounded bg-paper-2 px-2 py-0.5 text-[12.5px] text-ink-2 transition-colors hover:bg-brand-soft hover:text-brand-text">
          {i}
        </button>
      ))}
    </div>
  );
}
