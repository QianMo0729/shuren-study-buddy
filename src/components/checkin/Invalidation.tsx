import { useState } from 'react';
import { INVALID_OTHER, INVALID_REASONS } from '../../../shared/activity';
import type { Checkin } from '../../../shared/types';
import { api, ApiError } from '../../lib/api';
import { fullDateTime } from '../../lib/format';
import { useToast } from '../../lib/toast';
import { Button, Field, Input, Modal, Textarea } from '../ui';

const APPEAL_MAX = 300;

/** 作者看到的「没有计分」说明与申诉入口（审核人员也能看到） */
export function InvalidNotice({ checkin, onChanged }: { checkin: Checkin; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const info = checkin.invalid;
  if (!info) return null;
  const appealText = {
    none: info.canAppeal ? `如有异议，可在 ${fullDateTime(info.appealDeadline)} 前申诉一次，会由另一位审核员复核。` : '申诉期已过。',
    open: '已提交申诉，等待另一位审核员复核。',
    upheld: '申诉已复核，维持无效。',
    overturned: '申诉通过，已恢复计分。',
  }[info.appeal];
  return (
    <div className="mb-4 rounded-md border border-accent/30 bg-accent-soft px-4 py-3 text-[14px] text-ink-2" role="status">
      <p><b className="font-semibold text-ink">这次打卡没有计入搭子积分</b>：{info.reason}。打卡本身仍然保留。</p>
      <p className="mt-1 text-[13px] text-ink-3">{appealText}</p>
      {checkin.isMine && info.canAppeal && <Button size="sm" className="mt-2" onClick={() => setOpen(true)}>申诉</Button>}
      {open && <AppealDialog checkinId={checkin.id} onClose={() => setOpen(false)} onDone={() => { setOpen(false); onChanged(); }} />}
    </div>
  );
}

function AppealDialog({ checkinId, onClose, onDone }: { checkinId: number; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      await api.activity.appeal(checkinId, body.trim());
      toast.success('申诉已提交', '会由另一位审核员复核，结果会通知你');
      onDone();
    } catch (cause) {
      toast.error('提交失败', cause instanceof ApiError ? cause.message : undefined);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open title="申诉这次判定" size="md" onClose={() => !busy && onClose()} dismissible={!busy}>
      <form className="space-y-4 p-5" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <p className="text-[13.5px] leading-relaxed text-ink-3">每条打卡只能申诉一次。请说明照片里能看到的学习内容，或者当时的具体情况。</p>
        <Field label="申诉理由">
          <Textarea aria-label="申诉理由" value={body} maxLength={APPEAL_MAX} rows={4} onChange={(e) => setBody(e.target.value)} disabled={busy} placeholder="例如：照片左下角是线代课本第三章，光线有点暗" />
        </Field>
        <div className="flex justify-end gap-2">
          <Button type="button" disabled={busy} onClick={onClose}>取消</Button>
          <Button type="submit" variant="primary" loading={busy} disabled={!body.trim()}>提交申诉</Button>
        </div>
      </form>
    </Modal>
  );
}

/** 审核人员判无效：只能从固定理由里选；选「其他」时必须写明 */
export function InvalidateDialog({ checkinId, label, onClose, onDone }: { checkinId: number; label: string; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const reasons = [...INVALID_REASONS, INVALID_OTHER];
  const submit = async () => {
    setBusy(true);
    try {
      const r = await api.admin.invalidate(checkinId, reason, note.trim());
      toast.success('已判为无效', r.emailStatus === 'failed' ? '站内通知已发出，邮件发送失败' : '已通知本人，可在申诉期内申诉');
      onDone();
    } catch (cause) {
      toast.error('操作失败', cause instanceof ApiError ? cause.message : undefined);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open title="判为无效（不计分）" size="md" onClose={() => !busy && onClose()} dismissible={!busy}>
      <div className="space-y-4 p-5">
        <p className="text-[13.5px] text-ink-3">{label}。打卡仍然保留，只是不计分；本人会收到站内通知和邮件，可以申诉一次。内容本身违规请用「撤下」。</p>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="判无效的理由">
          {reasons.map((r) => (
            <button key={r} type="button" role="radio" aria-checked={reason === r} onClick={() => setReason(r)}
              className={reason === r ? 'rounded-md border border-danger bg-danger px-2.5 py-1.5 text-[13px] text-white' : 'rounded-md border border-line-strong px-2.5 py-1.5 text-[13px] text-ink-2 hover:border-ink-4'}>
              {r}
            </button>
          ))}
        </div>
        <Field label={reason === INVALID_OTHER ? '具体原因' : '补充说明'} optional={reason !== INVALID_OTHER}>
          <Input aria-label="补充说明" value={note} maxLength={120} onChange={(e) => setNote(e.target.value)} disabled={busy} />
        </Field>
        <div className="flex justify-end gap-2">
          <Button disabled={busy} onClick={onClose}>取消</Button>
          <Button variant="danger" loading={busy} disabled={!reason || (reason === INVALID_OTHER && !note.trim())} onClick={() => void submit()}>判为无效</Button>
        </div>
      </div>
    </Modal>
  );
}
