import { useEffect, useRef, useState } from 'react';
import { LockKeyhole, NotebookPen } from 'lucide-react';
import type { PrivateNote as Note } from '../../shared/types';
import { ApiError } from '../lib/api';
import { notesApi } from '../lib/notes';
import { useToast } from '../lib/toast';
import { Button, Field, Input, Modal, Textarea } from './ui';

export function PrivateNote({ targetId, nickname, value, onChanged }: {
  targetId: number; nickname: string; value: Note | null; onChanged: (note: Note | null) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-5 rounded-md border border-line bg-paper-2/60 p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-[13px] text-ink-3"><LockKeyhole size={13} aria-hidden />私人备注 · 仅自己可见</p>
        <Button size="sm" variant="ghost" icon={<NotebookPen size={14} />} onClick={() => setOpen(true)}>{value ? '编辑备注' : '添加备注'}</Button>
      </div>
      {value?.note && <p className="mt-2 break-words text-[14px] whitespace-pre-wrap text-ink-2">{value.note}</p>}
      {open && <PrivateNoteDialog key={targetId} targetId={targetId} nickname={nickname} value={value} onClose={() => setOpen(false)} onSaved={onChanged} />}
    </div>
  );
}

/** 每次打开及切换目标重新挂载，保存中的异步回调不会覆盖其他同学的备注。 */
export function PrivateNoteDialog({ targetId, nickname, value, onClose, onSaved }: {
  targetId: number; nickname: string; value: Note | null; onClose: () => void; onSaved: (note: Note | null) => void;
}) {
  const [remarkName, setRemarkName] = useState(value?.remarkName ?? '');
  const [note, setNote] = useState(value?.note ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const alive = useRef(true);
  const submitting = useRef(false);
  const toast = useToast();
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const save = async (remove = false) => {
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError('');
    try {
      let saved: Note | null = null;
      if (remove) await notesApi.remove(targetId);
      else saved = (await notesApi.save(targetId, { remarkName, note })).privateNote;
      if (!alive.current) return;
      onSaved(saved);
      toast.success(saved ? '私人备注已保存' : '私人备注已清除');
      onClose();
    } catch (cause) {
      if (alive.current) setError(cause instanceof ApiError ? cause.message : '保存失败，请稍后重试');
    } finally {
      submitting.current = false;
      if (alive.current) setBusy(false);
    }
  };
  return (
    <Modal open title="私人备注" size="md" dismissible={!busy} onClose={() => { if (!busy) onClose(); }}>
      <form className="space-y-4 p-5" onSubmit={(event) => { event.preventDefault(); void save(); }}>
        <p className="text-[13px] text-ink-3">原昵称：{nickname}。备注只有你能看到，对方不会收到通知。</p>
        <Field label="备注名" optional hint="便于认出这位同学，原昵称会同时保留。">
          <Input aria-label="备注名" value={remarkName} onChange={(event) => setRemarkName(event.target.value)} maxLength={40} disabled={busy} placeholder="例如：周三离散数学搭子" autoFocus />
        </Field>
        <Field label="备注内容" optional>
          <Textarea aria-label="备注内容" value={note} onChange={(event) => setNote(event.target.value)} maxLength={300} rows={4} disabled={busy} placeholder="记下你想记住的事" />
        </Field>
        {error && <p role="alert" className="text-[13px] text-danger">{error}</p>}
        <div className="flex flex-wrap justify-end gap-2 pt-1">
          {value && <Button type="button" variant="ghost" className="mr-auto" disabled={busy} onClick={() => void save(true)}>清除备注</Button>}
          <Button type="button" disabled={busy} onClick={onClose}>取消</Button>
          <Button type="submit" variant="primary" loading={busy}>保存</Button>
        </div>
      </form>
    </Modal>
  );
}
