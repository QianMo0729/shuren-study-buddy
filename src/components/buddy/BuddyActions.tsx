import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { Handshake, UsersRound } from 'lucide-react';
import { beijingDay, shortDate, weekdayLabel } from '../../../shared/activity';
import type { BuddyRelation, BuddyStatus } from '../../../shared/types';
import { api, ApiError } from '../../lib/api';
import { useToast } from '../../lib/toast';
import { useActivityConfig } from '../../lib/activity';
import { Button, Modal, Tag } from '../ui';

type Pending = { mode: 'invite'; userId: number; nickname: string } | { mode: 'accept'; inviteId: number; nickname: string };

/**
 * 邀请 / 接受搭子的确认弹窗：说明计分规则。
 * onDone 拿到最新的搭子状态；接受后还有私聊的 matchId。
 */
export function useBuddyActions(onDone?: (status: BuddyStatus & { matchId?: number }) => void) {
  const toast = useToast();
  const { config } = useActivityConfig();
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const done = useRef(onDone);
  done.current = onDone;

  const run = async (fn: () => Promise<BuddyStatus & { matchId?: number }>, success: string) => {
    setBusy(true);
    try {
      const result = await fn();
      toast.success(success);
      done.current?.(result);
      return true;
    } catch (cause) {
      toast.error('操作失败', cause instanceof ApiError ? cause.message : '请稍后重试');
      return false;
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    if (!pending) return;
    const ok = pending.mode === 'invite'
      ? await run(() => api.activity.invite(pending.userId), '邀请已发出，等对方接受')
      : await run(() => api.activity.accept(pending.inviteId), '已绑定为学习搭子');
    if (ok) setPending(null);
  };

  const decline = useCallback((inviteId: number) => run(() => api.activity.decline(inviteId), '已婉拒邀请'), []); // eslint-disable-line react-hooks/exhaustive-deps
  const cancel = useCallback((inviteId: number) => run(() => api.activity.cancel(inviteId), '已撤回邀请'), []); // eslint-disable-line react-hooks/exhaustive-deps

  const dialog: ReactNode = (
    <Modal open={!!pending} onClose={() => !busy && setPending(null)} title={pending?.mode === 'accept' ? '接受搭子邀请' : '邀请成为学习搭子'} size="md" dismissible={!busy}>
      {pending && (
        <div className="space-y-4 p-5 pt-3 sm:p-6 sm:pt-3">
          <p className="text-[14.5px] leading-relaxed text-ink-2">
            {pending.mode === 'accept' ? `接受后，你和 ${pending.nickname} 会绑定为学习搭子。` : `对方接受后，你和 ${pending.nickname} 会绑定为学习搭子。`}
          </p>
          <ul className="list-disc space-y-1 pl-5 text-[13.5px] leading-relaxed text-ink-2 marker:text-ink-4">
            <li>
              {beijingDay() >= config.seasonStart
                ? '每人同时只能有一个搭子，从下一个周一开始计分。'
                : pending.mode === 'accept'
                  ? `每人同时只能有一个搭子。现在接受，从赛季第一天 ${shortDate(config.seasonStart)}（${weekdayLabel(config.seasonStart)}）开始计分。`
                  : `每人同时只能有一个搭子。对方在赛季开始前接受的，从赛季第一天 ${shortDate(config.seasonStart)}（${weekdayLabel(config.seasonStart)}）开始计分；之后才接受的，从下一个周一开始。`}
            </li>
            <li>同一天两人在 {config.windowMinutes} 分钟内各自拍照打卡，算一次相同事件打卡，每周最多计 {config.weeklyCap} 次。</li>
            <li>任何一方都可以随时解绑，解绑后两人的搭子积分都清零。</li>
            <li>组合里至少一人是树仁书院学生才参与排名和评奖，书院身份按学号判断。</li>
          </ul>
          <p className="text-[12.5px] text-ink-3">
            详细规则见 <Link to="/rules" className="text-brand-text underline" onClick={() => setPending(null)}>活动规则</Link>。
          </p>
          <div className="flex justify-end gap-2 pt-1">
            <Button disabled={busy} onClick={() => setPending(null)}>取消</Button>
            <Button variant="primary" loading={busy} onClick={() => void confirm()}>
              {pending.mode === 'accept' ? '接受并绑定' : '发出邀请'}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );

  return {
    invite: (userId: number, nickname: string) => setPending({ mode: 'invite', userId, nickname }),
    accept: (inviteId: number, nickname: string) => setPending({ mode: 'accept', inviteId, nickname }),
    decline,
    cancel,
    busy,
    dialog,
  };
}

/** 由最新的搭子状态推出与某位同学的关系 */
function relationFrom(status: BuddyStatus, userId: number, previous: BuddyRelation): BuddyRelation {
  const iHaveBuddy = !!status.pair && status.pair.partner.id !== userId;
  if (status.pair?.partner.id === userId) return { state: 'bound', inviteId: null, otherHasBuddy: false, iHaveBuddy: false };
  const incoming = status.invites.find((i) => i.direction === 'incoming' && i.other.id === userId);
  if (incoming) return { state: 'incoming', inviteId: incoming.id, otherHasBuddy: previous.otherHasBuddy, iHaveBuddy };
  const outgoing = status.invites.find((i) => i.direction === 'outgoing' && i.other.id === userId);
  if (outgoing) return { state: 'outgoing', inviteId: outgoing.id, otherHasBuddy: previous.otherHasBuddy, iHaveBuddy };
  return { state: iHaveBuddy || previous.otherHasBuddy ? 'unavailable' : 'none', inviteId: null, otherHasBuddy: previous.otherHasBuddy, iHaveBuddy };
}

/** 对方主页上的搭子按钮 */
export function BuddyButton({ relation: initial, userId, nickname, onChanged }: {
  relation: BuddyRelation; userId: number; nickname: string; onChanged?: () => void;
}) {
  const [relation, setRelation] = useState(initial);
  useEffect(() => setRelation(initial), [initial]);
  const actions = useBuddyActions((status) => {
    setRelation((current) => relationFrom(status, userId, current));
    onChanged?.();
  });
  let body: ReactNode = null;
  if (relation.state === 'bound') body = <Tag tone="brand"><Handshake size={13} aria-hidden />你的学习搭子</Tag>;
  else if (relation.state === 'incoming') {
    body = (
      <>
        <Button size="sm" variant="primary" icon={<Handshake size={14} />} onClick={() => actions.accept(relation.inviteId!, nickname)}>接受搭子邀请</Button>
        <Button size="sm" variant="ghost" disabled={actions.busy} onClick={() => void actions.decline(relation.inviteId!)}>婉拒</Button>
      </>
    );
  } else if (relation.state === 'outgoing') {
    body = (
      <span className="inline-flex items-center gap-2 text-[13px] text-ink-3">
        已邀请成为搭子，等待回应
        <button type="button" disabled={actions.busy} className="text-ink-2 underline hover:text-ink" onClick={() => void actions.cancel(relation.inviteId!)}>撤回</button>
      </span>
    );
  } else if (relation.state === 'none') {
    body = <Button size="sm" variant="secondary" icon={<UsersRound size={14} />} onClick={() => actions.invite(userId, nickname)}>邀请成为搭子</Button>;
  }
  return <>{body}{actions.dialog}</>;
}

/** 私聊顶部：有待处理的搭子邀请时显示 */
export function BuddyBar({ relation, nickname, onChanged }: {
  relation: BuddyRelation; nickname: string; onChanged: () => void;
}) {
  const actions = useBuddyActions(() => onChanged());
  if (relation.state !== 'incoming' && relation.state !== 'outgoing') return actions.dialog;
  return (
    <section className="border-b border-line bg-brand-softer" aria-label="搭子邀请">
      <div className="flex min-h-[48px] flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2">
        <p className="flex min-w-0 flex-1 items-center gap-2 text-[13.5px] text-ink-2" role="status">
          <Handshake size={15} className="shrink-0 text-brand-text" aria-hidden />
          {relation.state === 'incoming' ? `${nickname} 邀请你成为学习搭子` : '已邀请对方成为学习搭子，等待回应'}
        </p>
        <div className="flex shrink-0 items-center gap-2">
          {relation.state === 'incoming' ? (
            <>
              <Button size="sm" variant="primary" onClick={() => actions.accept(relation.inviteId!, nickname)}>接受</Button>
              <Button size="sm" disabled={actions.busy} onClick={() => void actions.decline(relation.inviteId!)}>婉拒</Button>
            </>
          ) : (
            <Button size="sm" variant="ghost" disabled={actions.busy} onClick={() => void actions.cancel(relation.inviteId!)}>撤回</Button>
          )}
        </div>
      </div>
      {actions.dialog}
    </section>
  );
}
