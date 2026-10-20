import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { MessageCircle } from 'lucide-react';
import { shortDate } from '../../../shared/activity';
import type { BuddyStatus } from '../../../shared/types';
import { api, ApiError } from '../../lib/api';
import { useToast } from '../../lib/toast';
import { Cover, Nickname } from '../ProfileCard';
import { Button, ConfirmDialog, Skeleton } from '../ui';
import { ShurenChoice, useBuddyActions } from './BuddyActions';

/** 「我的」页：我的学习搭子、本周进度与名次（不显示分数）、待处理的邀请、解绑 */
export function BuddyPanel() {
  const toast = useToast();
  const nav = useNavigate();
  const [status, setStatus] = useState<BuddyStatus | null>(null);
  const [error, setError] = useState('');
  const [unbinding, setUnbinding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [editCollege, setEditCollege] = useState(false);
  const load = useCallback(() => api.activity.me().then((s) => { setStatus(s); setError(''); }).catch((e) => setError(e instanceof ApiError ? e.message : '加载失败')), []);
  useEffect(() => { void load(); }, [load]);
  const actions = useBuddyActions((s) => {
    setStatus(s);
    if (s.matchId) nav(`/messages/${s.matchId}`);
  });

  if (error && !status) {
    return (
      <div className="rounded-xl bg-surface p-5 text-[14px] text-ink-2">
        搭子信息加载失败：{error}
        <Button size="sm" className="ml-2" onClick={() => void load()}>重试</Button>
      </div>
    );
  }
  if (!status) return <Skeleton className="h-40 rounded-xl" />;

  const { pair, invites, week, rank, season } = status;
  const incoming = invites.filter((i) => i.direction === 'incoming');
  const outgoing = invites.filter((i) => i.direction === 'outgoing');

  const unbind = async () => {
    setBusy(true);
    try {
      setStatus(await api.activity.unbind());
      setUnbinding(false);
      toast.success('已解除绑定', '你们的搭子积分已清零');
    } catch (cause) {
      toast.error('操作失败', cause instanceof ApiError ? cause.message : undefined);
    } finally {
      setBusy(false);
    }
  };

  const saveCollege = async (value: 'yes' | 'no') => {
    try {
      setStatus(await api.activity.setCollege(value));
      setEditCollege(false);
    } catch (cause) {
      toast.error('保存失败', cause instanceof ApiError ? cause.message : undefined);
    }
  };

  let progress: string | null = null;
  if (pair && season.status === 'ended') progress = '本赛季已经结束。';
  else if (pair && !pair.started) progress = `从 ${shortDate(pair.startsOn)}（周一）开始计分。`;
  else if (week) progress = `本周相同事件打卡 ${week.count} / ${week.cap} 次`;

  return (
    <section aria-labelledby="buddy-title" className="mt-4 rounded-xl bg-surface p-5">
      <div className="flex items-baseline justify-between gap-2">
        <h2 id="buddy-title" className="font-display text-[18px] text-ink">我的学习搭子</h2>
        <Link to="/rules" className="text-[12.5px] text-ink-3 underline-offset-2 hover:text-ink hover:underline">活动规则</Link>
      </div>

      {pair ? (
        <div className="mt-3">
          <Link to={`/u/${pair.partner.id}`} className="flex items-center gap-3 rounded-lg p-1 -m-1 hover:bg-paper-2/70">
            <Cover nickname={pair.partner.nickname} cover={pair.partner.cover} className="size-11 shrink-0 overflow-hidden rounded-md" />
            <Nickname name={pair.partner.nickname} size={17} />
          </Link>
          <dl className="mt-3 space-y-1.5 text-[13.5px]">
            {progress && <div className="text-ink-2">{progress}</div>}
            {pair.ineligible ? (
              <div className="text-danger">{pair.ineligible}</div>
            ) : rank ? (
              <div className="text-ink-2">搭子榜 第 <b className="font-semibold text-ink tabular">{rank.rank}</b> 名{rank.tied ? '（并列）' : ''}<span className="text-ink-3"> · 共 {rank.total} 组</span></div>
            ) : pair.started ? (
              <div className="text-ink-3">完成第一个计分周后显示名次。</div>
            ) : null}
          </dl>
          <div className="mt-4 flex gap-2">
            {pair.matchId && (
              <Button size="sm" variant="secondary" icon={<MessageCircle size={14} />} onClick={() => nav(`/messages/${pair.matchId}`)}>约时间打卡</Button>
            )}
            <Button size="sm" variant="ghost" className="ml-auto text-ink-3 hover:text-danger" onClick={() => setUnbinding(true)}>解除绑定</Button>
          </div>
        </div>
      ) : (
        <p className="mt-2 text-[13.5px] leading-relaxed text-ink-3">
          还没有搭子。在私聊或对方主页上点「邀请成为搭子」；已经认识的同学，可以在<Link to="/match/search" className="text-brand-text underline">找同学</Link>里输入对方的 ID。
        </p>
      )}

      {incoming.length > 0 && (
        <ul className="mt-4 space-y-2 border-t border-line pt-3">
          {incoming.map((invite) => (
            <li key={invite.id} className="flex flex-wrap items-center gap-2 text-[13.5px]">
              <Link to={`/u/${invite.other.id}`} className="min-w-0 flex-1 truncate text-ink-2 hover:text-ink">{invite.other.nickname} 邀请你成为搭子</Link>
              <Button size="sm" variant="primary" disabled={!!pair} onClick={() => actions.accept(invite.id, invite.other.nickname)}>接受</Button>
              <Button size="sm" disabled={actions.busy} onClick={() => void actions.decline(invite.id)}>婉拒</Button>
            </li>
          ))}
        </ul>
      )}
      {outgoing.length > 0 && (
        <ul className="mt-4 space-y-2 border-t border-line pt-3">
          {outgoing.map((invite) => (
            <li key={invite.id} className="flex items-center gap-2 text-[13.5px] text-ink-3">
              <span className="min-w-0 flex-1 truncate">已邀请 {invite.other.nickname}，等待回应</span>
              <button type="button" disabled={actions.busy} className="shrink-0 text-ink-2 underline hover:text-ink" onClick={() => void actions.cancel(invite.id)}>撤回</button>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4 border-t border-line pt-3 text-[12.5px] text-ink-3">
        {status.shurenMember && !editCollege ? (
          <>已登记为{status.shurenMember === 'yes' ? '树仁书院学生' : '非树仁书院学生'} · <button type="button" className="underline hover:text-ink" onClick={() => setEditCollege(true)}>修改</button></>
        ) : (
          <ShurenChoice value={status.shurenMember} onChange={(v) => void saveCollege(v)} />
        )}
      </div>

      {actions.dialog}
      <ConfirmDialog
        open={unbinding}
        title="解除搭子绑定？"
        desc="解除后立即生效，你们两人的搭子积分都会清零，组合从搭子榜移除，对方会收到通知。私聊不受影响。之后和任何人重新绑定，都从下一个周一开始重新计分。"
        confirmText="解除绑定"
        tone="danger"
        loading={busy}
        onCancel={() => !busy && setUnbinding(false)}
        onConfirm={() => void unbind()}
      />
    </section>
  );
}
