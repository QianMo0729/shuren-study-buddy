import { AnimatePresence, Reorder, motion } from 'motion/react';
import { useEffect, useId, useRef, useState } from 'react';
import { ImagePlus, PenLine, X } from 'lucide-react';
import type { ForumPost } from '../../../shared/types';
import { api, ApiError, fileUrl } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { cx } from '../../lib/format';
import { compressImage } from '../../lib/image';
import { ease } from '../../lib/motion';
import { useToast } from '../../lib/toast';
import { Button, Spinner } from '../ui';
import { Plate } from '../brand';

export const TITLE_MAX = 60;
export const BODY_MAX = 2000;
export const IMAGE_MAX = 4;
// 草稿按账号分开保存，换号后不会看到别人的草稿
const draftKey = (uid: number | undefined) => `dz:forum-draft:${uid ?? 'anon'}`;
try { localStorage.removeItem('dz:forum-draft'); } catch { /* 旧版不分账号的草稿键 */ }

interface Draft {
  title: string;
  body: string;
  images: string[];
}

function readDraft(uid: number | undefined): Draft | null {
  try {
    const raw = localStorage.getItem(draftKey(uid));
    const d = raw ? JSON.parse(raw) : null;
    if (!d || typeof d.body !== 'string') return null;
    return { title: String(d.title ?? '').slice(0, TITLE_MAX), body: d.body.slice(0, BODY_MAX), images: Array.isArray(d.images) ? d.images.filter((x: unknown) => typeof x === 'string').slice(0, IMAGE_MAX) : [] };
  } catch {
    return null;
  }
}

function writeDraft(uid: number | undefined, d: Draft | null) {
  try {
    if (!d || (!d.title && !d.body && !d.images.length)) localStorage.removeItem(draftKey(uid));
    else localStorage.setItem(draftKey(uid), JSON.stringify(d));
  } catch { /* 浏览器禁用存储时忽略草稿 */ }
}

/**
 * 发帖 / 编辑帖子。传入 collapsible 可收起成一行；未发出的内容保存在本机草稿里。
 * 图片在浏览器端压缩后上传（kind = forum），最多 4 张，可拖动排序。
 */
export function PostComposer({ post, onDone, onCancel, onBusyChange, collapsible = false }: {
  /** 传入时为编辑模式 */
  post?: ForumPost;
  onDone: (post: ForumPost) => void;
  onCancel?: () => void;
  /** 弹窗发布时，上传或提交期间暂不允许关闭。 */
  onBusyChange?: (busy: boolean) => void;
  collapsible?: boolean;
}) {
  const { user } = useAuth();
  const toast = useToast();
  const ids = useId();
  const editing = !!post;
  const [draft, setDraft] = useState<Draft>(() => (post ? { title: post.title, body: post.body, images: post.images } : readDraft(user?.id) ?? { title: '', body: '', images: [] }));
  const [expanded, setExpanded] = useState(!collapsible || !!(draft.title || draft.body || draft.images.length));
  const [uploading, setUploading] = useState(0);
  const [sending, setSending] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const submitting = useRef(false);

  useEffect(() => {
    onBusyChange?.(uploading > 0 || sending);
  }, [uploading, sending, onBusyChange]);

  useEffect(() => {
    if (!editing) writeDraft(user?.id, draft);
  }, [draft, editing]);

  const patch = (p: Partial<Draft>) => setDraft((d) => ({ ...d, ...p }));

  const addImages = async (files: FileList | null) => {
    if (!files?.length) return;
    const room = IMAGE_MAX - draft.images.length - uploading;
    const list = [...files].slice(0, Math.max(0, room));
    if (files.length > list.length) toast.info(`最多添加 ${IMAGE_MAX} 张图片`);
    if (!list.length) return;
    setUploading((n) => n + list.length);
    for (const f of list) {
      try {
        const dataUrl = await compressImage(f, 1600, 0.84);
        const { name } = await api.upload(dataUrl, 'forum');
        setDraft((d) => (d.images.length < IMAGE_MAX ? { ...d, images: [...d.images, name] } : d));
      } catch (e) {
        toast.error('图片上传失败', e instanceof ApiError || e instanceof Error ? e.message : undefined);
      } finally {
        setUploading((n) => n - 1);
      }
    }
  };

  const submit = async () => {
    if (submitting.current || uploading > 0) return;
    const body = draft.body.trim();
    if (!body) {
      toast.info('写点什么再发布吧');
      bodyRef.current?.focus();
      return;
    }
    submitting.current = true;
    setSending(true);
    try {
      const payload = { title: draft.title.trim(), body, images: draft.images };
      const r = post ? await api.forum.update(post.id, payload) : await api.forum.create(payload);
      if (!editing) {
        setDraft({ title: '', body: '', images: [] });
        writeDraft(user?.id, null);
        if (collapsible) setExpanded(false);
      }
      toast.success(r.post.reviewPending ? '已提交，等待审核' : editing ? '已保存修改' : '已发布');
      onDone(r.post);
    } catch (e) {
      toast.error(editing ? '保存失败' : '发布失败', e instanceof ApiError ? e.message : undefined);
    } finally {
      submitting.current = false;
      setSending(false);
    }
  };

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => {
          setExpanded(true);
          requestAnimationFrame(() => bodyRef.current?.focus());
        }}
        className="flex w-full items-center gap-3 rounded-md border border-line bg-surface p-3 text-left transition-colors hover:border-line-strong"
      >
        {user?.nickname ? <Plate nickname={user.nickname} className="size-9 shrink-0 rounded-[5px]" pad="8%" /> : <span className="grid size-9 place-items-center rounded-[5px] bg-mat text-ink-3"><PenLine size={16} /></span>}
        <span className="flex-1 text-[15px] text-ink-4">分享校园生活、学习心得…</span>
        <span className="hidden h-8 items-center rounded-[5px] bg-brand px-3 text-[13px] font-semibold text-white sm:inline-flex">发帖</span>
      </button>
    );
  }

  const busy = uploading > 0;
  return (
    <motion.form
      initial={collapsible ? { opacity: 0, y: -4 } : false}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease }}
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      className="rounded-md border border-line-strong bg-surface p-3.5 sm:p-4"
      aria-label={editing ? '编辑帖子' : '发帖'}
    >
      <label htmlFor={`${ids}-title`} className="sr-only">标题（选填）</label>
      <input
        id={`${ids}-title`}
        value={draft.title}
        onChange={(e) => patch({ title: e.target.value.replace(/\n/g, ' ').slice(0, TITLE_MAX) })}
        maxLength={TITLE_MAX}
        placeholder="标题（选填）"
        className="w-full border-b border-line bg-transparent pb-2 font-display text-[18px] text-ink outline-none placeholder:font-sans placeholder:text-[15px] placeholder:font-normal placeholder:text-ink-4 focus:border-brand"
      />
      <label htmlFor={`${ids}-body`} className="sr-only">正文</label>
      <textarea
        id={`${ids}-body`}
        ref={bodyRef}
        value={draft.body}
        onChange={(e) => patch({ body: e.target.value.slice(0, BODY_MAX) })}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            void submit();
          }
        }}
        maxLength={BODY_MAX}
        rows={4}
        placeholder="分享校园生活、学习心得，或者今天看到的晚霞…"
        className="mt-2 block min-h-28 w-full resize-y bg-transparent text-[16px] leading-relaxed text-ink outline-none placeholder:text-ink-4 sm:text-[15px]"
      />

      {(draft.images.length > 0 || uploading > 0) && (
        <div className="mt-2 flex flex-wrap gap-2">
          <Reorder.Group axis="x" values={draft.images} onReorder={(images) => patch({ images })} className="flex flex-wrap gap-2" aria-label="已添加的图片，可拖动排序">
            <AnimatePresence initial={false}>
              {draft.images.map((name, i) => (
                <Reorder.Item
                  key={name}
                  value={name}
                  className="group relative size-[72px] cursor-grab overflow-hidden rounded-[5px] bg-mat active:cursor-grabbing sm:size-20"
                  whileDrag={{ scale: 1.06, zIndex: 10 }}
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                >
                  <img src={fileUrl(name)} alt={`第 ${i + 1} 张图片`} className="pointer-events-none h-full w-full object-cover" />
                  <button
                    type="button"
                    onClick={() => patch({ images: draft.images.filter((x) => x !== name) })}
                    className="absolute top-1 right-1 grid size-6 place-items-center rounded-[4px] bg-black/50 text-white hover:bg-black/70"
                    aria-label={`移除第 ${i + 1} 张图片`}
                  >
                    <X size={13} />
                  </button>
                  {draft.images.length > 1 && (
                    <span className="absolute inset-x-0 bottom-0 flex justify-between bg-black/40 px-0.5 text-white opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
                      <button type="button" disabled={i === 0} onClick={() => patch({ images: move(draft.images, i, i - 1) })} className="px-1 text-[12px] disabled:opacity-30" aria-label={`第 ${i + 1} 张前移`}>‹</button>
                      <button type="button" disabled={i === draft.images.length - 1} onClick={() => patch({ images: move(draft.images, i, i + 1) })} className="px-1 text-[12px] disabled:opacity-30" aria-label={`第 ${i + 1} 张后移`}>›</button>
                    </span>
                  )}
                </Reorder.Item>
              ))}
            </AnimatePresence>
          </Reorder.Group>
          {Array.from({ length: uploading }).map((_, i) => (
            <div key={`u${i}`} className="grid size-[72px] place-items-center rounded-[5px] bg-mat text-ink-3 sm:size-20" aria-label="图片上传中">
              <Spinner />
            </div>
          ))}
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3">
        <button
          type="button"
          onClick={() => fileInput.current?.click()}
          disabled={sending || draft.images.length + uploading >= IMAGE_MAX}
          className="inline-flex h-9 items-center gap-1.5 rounded-md px-2 text-[13.5px] text-ink-2 transition-colors hover:bg-ink/[.05] hover:text-ink disabled:opacity-40"
        >
          <ImagePlus size={17} aria-hidden /> 图片
          <span className="text-[12px] text-ink-4 tabular">{draft.images.length}/{IMAGE_MAX}</span>
        </button>
        <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp,image/heic" multiple hidden onChange={(e) => (void addImages(e.target.files), (e.target.value = ''))} />
        <span className={cx('ml-auto text-[12px] tabular', draft.body.length >= BODY_MAX ? 'text-danger' : 'text-ink-4')} aria-live="polite">
          {draft.body.length}/{BODY_MAX}
        </span>
        {(onCancel || collapsible) && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={busy || sending}
            onClick={() => {
              if (onCancel) onCancel();
              else setExpanded(false);
            }}
          >
            {editing ? '取消' : '收起'}
          </Button>
        )}
        <Button type="submit" variant="primary" size="sm" loading={sending} disabled={busy || !draft.body.trim()}>
          {editing ? '保存' : '发布'}
        </Button>
      </div>
    </motion.form>
  );
}

function move<T>(list: T[], from: number, to: number): T[] {
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}
