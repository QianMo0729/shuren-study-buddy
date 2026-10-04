import { AnimatePresence, motion } from 'motion/react';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Flag, MessageSquare, Send, Trash2 } from 'lucide-react';
import type { ForumComment, ForumTargetType } from '../../../shared/types';
import { api, ApiError } from '../../lib/api';
import { cx } from '../../lib/format';
import { ease } from '../../lib/motion';
import { useToast } from '../../lib/toast';
import { Button, ConfirmDialog, Skeleton } from '../ui';
import { ReportDialog } from '../moderation';
import { AuthorLine } from './AuthorLine';

const MAX = 500;

/** 评论区：列表 + 发表 + 删除自己的评论 + 举报评论。帖子与打卡通用。 */
export function Comments({ type, id, onCountChange, readOnly = false }: {
  type: ForumTargetType;
  id: number;
  /** 评论数变化时通知父组件（可选） */
  onCountChange?: (count: number) => void;
  /** 只读（例如内容已被撤下，只能查看） */
  readOnly?: boolean;
}) {
  const toast = useToast();
  const inputId = useId();
  const [items, setItems] = useState<ForumComment[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [removing, setRemoving] = useState<ForumComment | null>(null);
  const [removeBusy, setRemoveBusy] = useState(false);
  const [reporting, setReporting] = useState<number | null>(null);
  const countCb = useRef(onCountChange);
  countCb.current = onCountChange;

  const load = useCallback(async () => {
    setError(null);
    try {
      const r = await api.forum.comments(type, id);
      setItems(r.items);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '评论加载失败');
    }
  }, [type, id]);

  useEffect(() => {
    setItems(null);
    void load();
  }, [load]);

  const update = (next: ForumComment[]) => {
    setItems(next);
    countCb.current?.(next.length);
  };

  const submit = async () => {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      const r = await api.forum.comment(type, id, body);
      update([...(items ?? []), r.comment]);
      setText('');
    } catch (e) {
      toast.error('评论失败', e instanceof ApiError ? e.message : undefined);
    } finally {
      setSending(false);
    }
  };

  const remove = async () => {
    if (!removing) return;
    setRemoveBusy(true);
    try {
      await api.forum.deleteComment(removing.id);
      update((items ?? []).filter((c) => c.id !== removing.id));
      setRemoving(null);
      toast.success('评论已删除');
    } catch (e) {
      toast.error('删除失败', e instanceof ApiError ? e.message : undefined);
    } finally {
      setRemoveBusy(false);
    }
  };

  return (
    <section aria-labelledby={`${inputId}-title`} className="rounded-md border border-line bg-surface p-4 sm:p-6">
      <h2 id={`${inputId}-title`} className="flex items-baseline gap-2 font-display text-[19px] text-ink">
        评论
        {items && <span className="text-[14px] font-normal text-ink-3 tabular">{items.length}</span>}
      </h2>

      {!readOnly && (
        <div className="mt-4">
          <label htmlFor={inputId} className="sr-only">写评论</label>
          <div className="relative">
            <textarea
              id={inputId}
              value={text}
              onChange={(e) => setText(e.target.value.slice(0, MAX))}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  void submit();
                }
              }}
              maxLength={MAX}
              rows={2}
              placeholder="友善地说点什么…"
              className="block min-h-[76px] w-full resize-y rounded-md border border-line-strong bg-surface px-3.5 py-2.5 pb-7 text-[16px] leading-relaxed text-ink outline-none transition-[border-color,box-shadow] hover:border-ink-4 focus:border-brand focus:shadow-[0_0_0_3px_var(--brand-soft)] sm:text-[15px]"
            />
            <span className={cx('pointer-events-none absolute right-3 bottom-2 text-[12px] tabular', text.length >= MAX ? 'text-danger' : 'text-ink-4')} aria-hidden>
              {text.length}/{MAX}
            </span>
          </div>
          <div className="mt-2 flex items-center justify-between gap-3">
            <p className="hidden text-[12px] text-ink-4 sm:block">Ctrl / ⌘ + Enter 发送</p>
            <Button variant="primary" size="sm" icon={<Send size={14} />} onClick={() => void submit()} loading={sending} disabled={!text.trim()} className="ml-auto">
              发表评论
            </Button>
          </div>
        </div>
      )}

      <div className="mt-4" aria-live="polite" aria-busy={!items && !error}>
        {error ? (
          <div className="rounded-md bg-paper-2 px-4 py-6 text-center text-[14px] text-ink-2">
            <p>{error}</p>
            <Button size="sm" className="mt-3" onClick={() => void load()}>重新加载</Button>
          </div>
        ) : !items ? (
          <div className="space-y-4">
            {[0, 1].map((i) => <Skeleton key={i} className="h-14" />)}
          </div>
        ) : items.length === 0 ? (
          <p className="flex items-center justify-center gap-2 py-6 text-[14px] text-ink-3">
            <MessageSquare size={16} aria-hidden /> {readOnly ? '还没有评论' : '还没有评论，来说第一句吧'}
          </p>
        ) : (
          <ul className="divide-y divide-line">
            <AnimatePresence initial={false}>
              {items.map((c) => (
                <motion.li
                  key={c.id}
                  layout
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.25, ease }}
                  className="group py-3.5"
                >
                  <div className="flex items-start justify-between gap-2">
                    <AuthorLine author={c.author} time={c.createdAt} />
                    <div className="flex shrink-0 items-center opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
                      {c.isMine ? (
                        <button type="button" onClick={() => setRemoving(c)} className="grid size-8 place-items-center rounded-md text-ink-3 hover:bg-danger-soft hover:text-danger" aria-label="删除这条评论">
                          <Trash2 size={15} />
                        </button>
                      ) : (
                        <button type="button" onClick={() => setReporting(c.id)} className="grid size-8 place-items-center rounded-md text-ink-3 hover:bg-danger-soft hover:text-danger" aria-label={`举报 ${c.author.nickname} 的评论`}>
                          <Flag size={14} />
                        </button>
                      )}
                    </div>
                  </div>
                  <p className="mt-2 pl-[46px] text-[15px] leading-relaxed whitespace-pre-wrap break-words text-ink">{c.body}</p>
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
        )}
      </div>

      <ConfirmDialog
        open={!!removing}
        tone="danger"
        title="删除这条评论？"
        desc="删除后其他同学将看不到它。"
        confirmText="删除"
        loading={removeBusy}
        onCancel={() => setRemoving(null)}
        onConfirm={() => void remove()}
      />
      {reporting !== null && <ReportDialog open onClose={() => setReporting(null)} targetType="comment" targetId={reporting} />}
    </section>
  );
}
