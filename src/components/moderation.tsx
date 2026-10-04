import { useState } from 'react';
import { REPORT_REASONS, TAKEDOWN_REASONS } from '../../shared/options';
import { api, ApiError } from '../lib/api';
import { cx } from '../lib/format';
import { useToast } from '../lib/toast';
import { Button, Modal, Textarea } from './ui';
import type { ModerationTargetType, ReportTargetType } from '../../shared/types';

const TARGET_TEXT: Record<ReportTargetType, string> = {
  profile: '主页', post: '招募', forum_post: '帖子', comment: '评论', checkin: '打卡', message: '消息',
};

export function ReportDialog({ open, onClose, targetType, targetId }: { open: boolean; onClose: () => void; targetType: ReportTargetType; targetId: number }) {
  const toast = useToast();
  const [reason, setReason] = useState('');
  const [detail, setDetail] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Modal open={open} onClose={onClose} title={`举报该${TARGET_TEXT[targetType]}`} size="sm">
      <div className="px-6 pt-2 pb-6">
        <p className="text-[14px] text-ink-2">{targetType === 'message' ? '举报后，这条消息的内容会提交给管理员核实；其他聊天记录不会被查看。' : '举报只有管理员能看到，学发会尽快核实。'}</p>
        <div className="mt-4 space-y-1.5">
          {REPORT_REASONS.map((r) => (
            <button
              key={r}
              onClick={() => setReason(r)}
              role="radio"
              aria-checked={reason === r}
              className={cx('flex w-full items-center gap-3 rounded-lg border px-3.5 py-2.5 text-left text-[15px] transition-colors', reason === r ? 'border-danger/50 bg-danger-soft text-ink' : 'border-line-strong text-ink hover:border-ink-4')}
            >
              <span className={cx('size-[18px] shrink-0 rounded-full border-[1.5px]', reason === r ? 'border-danger bg-danger shadow-[inset_0_0_0_3px_var(--surface)]' : 'border-line-strong')} />
              {r}
            </button>
          ))}
        </div>
        <Textarea className="mt-3 min-h-20" value={detail} onChange={(e) => setDetail(e.target.value)} maxLength={200} placeholder="补充说明（选填）" />
        <Button
          variant="danger"
          size="lg"
          className="mt-5 w-full"
          disabled={!reason}
          loading={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await api.report({ targetType, targetId, reason, detail });
              toast.success('已提交举报', '感谢你帮助维护良好的社区氛围');
              onClose();
              setReason('');
              setDetail('');
            } catch (e) {
              toast.error('提交失败', e instanceof ApiError ? e.message : undefined);
            } finally {
              setBusy(false);
            }
          }}
        >
          提交举报
        </Button>
      </div>
    </Modal>
  );
}

/** 管理员撤下：选择原因 → 系统记录时间并给对方发送邮件 */
export function TakedownDialog({
  open, onClose, type, id, label, onDone,
}: {
  open: boolean;
  onClose: () => void;
  type: ModerationTargetType;
  id: number;
  label: string;
  onDone?: () => void;
}) {
  const toast = useToast();
  const [reason, setReason] = useState('');
  const [custom, setCustom] = useState('');
  const [busy, setBusy] = useState(false);
  const final = custom.trim() || reason;
  return (
    <Modal open={open} onClose={onClose} title={`撤下该${TARGET_TEXT[type]}`} size="sm">
      <div className="px-6 pt-2 pb-6">
        <p className="text-[14px] leading-relaxed text-ink-2">
          将撤下「<b className="font-semibold text-ink">{label}</b>」。系统会记录撤下时间，并向对方的注册邮箱发送通知：「您的{TARGET_TEXT[type]}因违规被管理员撤下，时间：……」
        </p>
        <div className="mt-4 flex flex-wrap gap-1.5">
          {TAKEDOWN_REASONS.map((r) => (
            <button
              key={r}
              onClick={() => (setReason(r), setCustom(''))}
              className={cx('rounded-md border px-2.5 py-1.5 text-[13px] transition-colors', reason === r && !custom ? 'border-danger bg-danger text-white' : 'border-line-strong text-ink-2 hover:border-ink-4')}
            >
              {r}
            </button>
          ))}
        </div>
        <Textarea className="mt-3 min-h-20" value={custom} onChange={(e) => setCustom(e.target.value)} maxLength={120} placeholder="或填写具体原因（会写入通知邮件）" />
        <Button
          variant="danger"
          size="lg"
          className="mt-5 w-full"
          disabled={!final}
          loading={busy}
          onClick={async () => {
            setBusy(true);
            try {
              const r = await api.admin.takedown(type, id, final);
              toast.success('已撤下', r.emailStatus === 'sent' ? `已发送邮件通知 · ${r.time}` : r.emailStatus === 'logged' ? `未配置邮件服务，通知已记录在服务器日志 · ${r.time}` : '邮件发送失败，已记录撤下');
              onClose();
              setReason('');
              setCustom('');
              onDone?.();
            } catch (e) {
              toast.error('操作失败', e instanceof ApiError ? e.message : undefined);
            } finally {
              setBusy(false);
            }
          }}
        >
          撤下并发送通知
        </Button>
      </div>
    </Modal>
  );
}
