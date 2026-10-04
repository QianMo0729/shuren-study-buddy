import { AnimatePresence, Reorder, motion } from 'motion/react';
import { useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, ImagePlus, Search, X, ZoomIn } from 'lucide-react';
import { MAJOR_GROUPS, UNDECIDED } from '../../shared/majors';
import { MBTIS, STUDY_TYPES } from '../../shared/options';
import { api, ApiError, fileUrl } from '../lib/api';
import { cx } from '../lib/format';
import { compressImage } from '../lib/image';
import { ease } from '../lib/motion';
import { useToast } from '../lib/toast';
import { Button, Input, Modal, Spinner } from './ui';
import { Seal } from './brand';

// ---------------- 专业选择（可搜索、按院系分组） ----------------

export function MajorSelect({ value, onChange, invalid, placeholder = '选择专业 / 院系', allowClear }: {
  value: string;
  onChange: (v: string) => void;
  invalid?: boolean;
  placeholder?: string;
  allowClear?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [kw, setKw] = useState('');
  const groups = useMemo(() => {
    const k = kw.trim().toLowerCase();
    if (!k) return MAJOR_GROUPS;
    return MAJOR_GROUPS.map((g) => ({
      ...g,
      majors: g.college.toLowerCase().includes(k) ? g.majors : g.majors.filter((m) => m.toLowerCase().includes(k)),
    })).filter((g) => g.majors.length);
  }, [kw]);
  const college = MAJOR_GROUPS.find((g) => g.majors.includes(value))?.college;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cx(
          'flex h-11 w-full items-center gap-2 rounded-lg border bg-surface px-3.5 text-left text-[16px] transition-[border-color,box-shadow] hover:border-ink-4 sm:text-[15px]',
          invalid ? 'border-danger' : 'border-line-strong',
        )}
      >
        {value ? (
          <span className="min-w-0 flex-1 truncate text-ink">
            {value}
            {college && college !== '其他' && <span className="ml-2 text-[13px] text-ink-3">{college}</span>}
          </span>
        ) : (
          <span className="flex-1 text-ink-4">{placeholder}</span>
        )}
        {allowClear && value && (
          <span
            role="button"
            onClick={(e) => {
              e.stopPropagation();
              onChange('');
            }}
            className="grid size-6 place-items-center rounded text-ink-4 hover:bg-paper-2 hover:text-ink-2"
          >
            <X size={14} />
          </span>
        )}
        <ChevronDown size={17} className="text-ink-3" />
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="选择专业 / 院系" size="md">
        <div className="px-5 pt-3 sm:px-6">
          <Input autoFocus value={kw} onChange={(e) => setKw(e.target.value)} placeholder="搜索专业或院系，如「微电子」" leading={<Search size={16} />} />
        </div>
        <div className="mt-3 max-h-[56dvh] overflow-y-auto px-3 pb-5">
          {groups.map((g) => (
            <div key={g.college} className="mb-1">
              <p className="sticky top-0 z-10 bg-surface px-3 pt-3 pb-1.5 text-[12.5px] font-semibold text-ink-3">{g.college}</p>
              {g.majors.map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => {
                    onChange(m);
                    setOpen(false);
                    setKw('');
                  }}
                  className={cx('flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left text-[15px] transition-colors', m === value ? 'bg-brand-soft font-semibold text-brand-text' : 'text-ink hover:bg-paper-2')}
                >
                  {m}
                  {m === value && <Check size={16} />}
                </button>
              ))}
            </div>
          ))}
          {!groups.length && <p className="py-10 text-center text-[14px] text-ink-3">没有找到这个专业，可以先选择「{UNDECIDED}」。</p>}
        </div>
      </Modal>
    </>
  );
}

// ---------------- 照片 ----------------

async function uploadFile(file: File, kind: 'photo' | 'timetable') {
  const dataUrl = await compressImage(file, kind === 'timetable' ? 2000 : 1400);
  return (await api.upload(dataUrl, kind)).name;
}

export function PhotoUploader({ value, onChange, max = 4 }: { value: string[]; onChange: (v: string[]) => void; max?: number }) {
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(0);

  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    const room = max - value.length;
    const list = [...files].slice(0, room);
    if (files.length > room) toast.info(`最多上传 ${max} 张照片`);
    setBusy(list.length);
    const added: string[] = [];
    for (const f of list) {
      try {
        added.push(await uploadFile(f, 'photo'));
      } catch (e) {
        toast.error('上传失败', e instanceof ApiError || e instanceof Error ? e.message : undefined);
      }
      setBusy((b) => b - 1);
    }
    onChange([...value, ...added]);
  };

  return (
    <div>
      <div className="flex gap-2.5">
        <Reorder.Group axis="x" values={value} onReorder={onChange} className="flex gap-2.5">
          {value.map((name, i) => (
            <Reorder.Item
              key={name}
              value={name}
              className="group relative aspect-[3/4] w-[clamp(64px,21vw,104px)] cursor-grab overflow-hidden rounded-lg bg-paper-2 active:cursor-grabbing"
              whileDrag={{ scale: 1.06, boxShadow: 'var(--shadow-lg)', zIndex: 10 }}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <img src={fileUrl(name)} alt="" className="pointer-events-none h-full w-full object-cover" />
              {i === 0 ? (
                <span className="absolute inset-x-0 bottom-0 bg-black/55 py-0.5 text-center text-[11px] text-white">封面</span>
              ) : (
                <button
                  type="button"
                  onClick={() => onChange([name, ...value.filter((x) => x !== name)])}
                  className="absolute inset-x-0 bottom-0 bg-black/40 py-0.5 text-center text-[11px] text-white opacity-0 transition-opacity group-hover:opacity-100 max-sm:opacity-100"
                >
                  设为封面
                </button>
              )}
              <button
                type="button"
                onClick={() => onChange(value.filter((x) => x !== name))}
                className="absolute top-1 right-1 grid size-6 place-items-center rounded-md bg-black/45 text-white hover:bg-black/65"
                aria-label="删除照片"
              >
                <X size={13} />
              </button>
            </Reorder.Item>
          ))}
        </Reorder.Group>
        {Array.from({ length: busy }).map((_, i) => (
          <div key={`b${i}`} className="grid aspect-[3/4] w-[clamp(64px,21vw,104px)] place-items-center rounded-lg bg-paper-2 text-ink-3">
            <Spinner />
          </div>
        ))}
        {value.length + busy < max && (
          <button
            type="button"
            onClick={() => input.current?.click()}
            className="flex aspect-[3/4] w-[clamp(64px,21vw,104px)] flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-line-strong text-ink-3 transition-colors hover:border-ink-4 hover:text-ink"
          >
            <ImagePlus size={20} strokeWidth={1.7} />
            <span className="text-[12px]">{value.length ? '继续添加' : '添加照片'}</span>
          </button>
        )}
      </div>
      <input ref={input} type="file" accept="image/*" multiple hidden onChange={(e) => (onFiles(e.target.files), (e.target.value = ''))} />
    </div>
  );
}

export function TimetableUpload({ value, onChange }: { value: string | null; onChange: (v: string | null) => void }) {
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState(false);
  return (
    <div>
      {value ? (
        <div className="flex items-center gap-3 rounded-lg border border-line bg-surface p-2 pr-2.5">
          <button type="button" onClick={() => setView(true)} className="group relative size-14 shrink-0 overflow-hidden rounded-md bg-paper-2" aria-label="查看课程表">
            <img src={fileUrl(value)} alt="课程表" className="h-full w-full object-cover" />
            <span className="absolute inset-0 grid place-items-center bg-black/30 text-white opacity-0 transition-opacity group-hover:opacity-100">
              <ZoomIn size={16} />
            </span>
          </button>
          <div className="min-w-0 flex-1">
            <p className="text-[14px] font-semibold text-ink">课程表已上传</p>
            <p className="text-[13px] text-ink-3">仅自己及管理员可查看</p>
          </div>
          <Button size="sm" variant="ghost" onClick={() => input.current?.click()} loading={busy}>
            替换
          </Button>
          <Button size="sm" variant="ghost" onClick={() => onChange(null)} className="text-danger">
            移除
          </Button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => input.current?.click()}
          disabled={busy}
          className="flex w-full items-center gap-3 rounded-lg border border-dashed border-line-strong px-4 py-3 text-left text-ink-2 transition-colors hover:border-ink-4 hover:text-ink"
        >
          {busy ? <Spinner /> : <ImagePlus size={18} strokeWidth={1.7} />}
          <span className="text-[14px]">上传课程表截图（教务系统或课表 App 的截图即可）</span>
        </button>
      )}
      <input
        ref={input}
        type="file"
        accept="image/*"
        hidden
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (!f) return;
          setBusy(true);
          try {
            onChange(await uploadFile(f, 'timetable'));
          } catch (err) {
            toast.error('上传失败', err instanceof Error ? err.message : undefined);
          } finally {
            setBusy(false);
          }
        }}
      />
      <Lightbox src={value ? fileUrl(value) : null} open={view} onClose={() => setView(false)} />
    </div>
  );
}

export function Lightbox({ src, open, onClose }: { src: string | null; open: boolean; onClose: () => void }) {
  return createPortal(
    <AnimatePresence>
      {open && src && (
        <motion.div
          className="fixed inset-0 z-[95] grid place-items-center bg-black/85 p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <motion.img
            src={src}
            alt=""
            className="max-h-[90dvh] max-w-full rounded-2xl object-contain shadow-2xl"
            initial={{ scale: 0.92, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            transition={{ duration: 0.3, ease }}
          />
          <button className="absolute top-4 right-4 grid size-10 place-items-center rounded-full bg-white/10 text-white hover:bg-white/20" aria-label="关闭">
            <X size={20} />
          </button>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

// ---------------- 学习类型（含 30 秒小测） ----------------

// ---------------- MBTI ----------------

export function MbtiPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="grid grid-cols-4 gap-1.5 sm:max-w-sm">
      {MBTIS.map((m) => {
        const on = m === value;
        return (
          <button
            key={m}
            type="button"
            onClick={() => onChange(on ? '' : m)}
            aria-pressed={on}
            className={cx('h-9 rounded-md border text-[13px] tracking-wide transition-colors', on ? 'border-brand bg-brand font-semibold text-white' : 'border-line-strong bg-surface text-ink-2 hover:border-ink-4')}
          >
            {m}
          </button>
        );
      })}
    </div>
  );
}

// ---------------- 选项列表（单选 / 多选） ----------------

export function OptionCards<T extends { value: string; label: string; hint?: string; color?: string }>({
  options, value, onChange, multi, invalid, cols = 3,
}: {
  options: T[];
  value: string[];
  onChange: (v: string[]) => void;
  multi?: boolean;
  invalid?: boolean;
  cols?: 1 | 2 | 3;
}) {
  const grid = { 1: 'grid-cols-1', 2: 'grid-cols-1 sm:grid-cols-2', 3: 'grid-cols-1 sm:grid-cols-3' }[cols];
  return (
    <div className={cx('grid gap-2', grid, invalid && 'rounded-lg outline-2 outline-offset-4 outline-danger/50')} role={multi ? 'group' : 'radiogroup'}>
      {options.map((o) => {
        const on = value.includes(o.value);
        return (
          <button
            key={o.value}
            type="button"
            role={multi ? 'checkbox' : 'radio'}
            aria-checked={on}
            onClick={() => onChange(multi ? (on ? value.filter((v) => v !== o.value) : [...value, o.value]) : [o.value])}
            className={cx('flex items-center gap-3 rounded-lg border px-3.5 py-2.5 text-left transition-colors', on ? 'border-brand bg-brand-softer' : 'border-line-strong bg-surface hover:border-ink-4')}
          >
            <span className={cx('grid size-[18px] shrink-0 place-items-center border-[1.5px]', multi ? 'rounded-[4px]' : 'rounded-full', on ? 'border-brand bg-brand text-white' : 'border-line-strong')}>
              {on && <Check size={11} strokeWidth={3} />}
            </span>
            {o.color && <span className="size-2 shrink-0 rounded-full" style={{ background: o.color }} />}
            <span className="min-w-0 flex-1">
              <span className="block text-[15px] text-ink">{o.label}</span>
              {o.hint && <span className="block text-[13px] text-ink-3">{o.hint}</span>}
            </span>
          </button>
        );
      })}
    </div>
  );
}
