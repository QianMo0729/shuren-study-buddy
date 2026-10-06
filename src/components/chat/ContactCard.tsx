import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router';
import { ChevronDown, Lock, ShieldCheck } from 'lucide-react';
import type { ChatSummary, ContactRequest, ContactReveal } from '../../../shared/types';
import { api, ApiError } from '../../lib/api';
import { cx } from '../../lib/format';
import { useToast } from '../../lib/toast';
import { Button, ConfirmDialog, Input } from '../ui';
import { ContactRows } from '../ContactRequests';

const REREQUEST_DAYS = 7;
type Problem = { kind: 'needContacts' | 'notEligible' | 'unavailable' | 'error'; message: string } | null;

const retryDate = (request: ContactRequest) => new Date(new Date(request.updatedAt).getTime() + REREQUEST_DAYS * 86_400_000);
const shortDate = (d: Date) => `${d.getMonth() + 1}月${d.getDate()}日`;

/**
 * 私聊顶部的「交换联系方式」卡片。状态来自会话摘要（contactState），
 * 具体申请与已交换的联系方式通过 /connections/:userId 读取，双方同意后才会返回联系方式。
 */
export function ContactCard({ other, contactState, onChanged }: {
  other: ChatSummary['other'];
  contactState: ChatSummary['contactState'];
  /** 申请 / 同意 / 拒绝之后通知聊天窗刷新（会出现新的系统消息） */
  onChanged: () => void;
}) {
  const toast = useToast();
  const [request, setRequest] = useState<ContactRequest | null>(null);
  const [contacts, setContacts] = useState<ContactReveal | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [problem, setProblem] = useState<Problem>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<'request' | 'accept' | 'reject' | null>(null);
  const [expanded, setExpanded] = useState(false);
  const revision = useRef(0);
  // 因为自己还没填联系方式而没做成的那一步：填好之后接着做，不用回到问卷再绕回来
  const blocked = useRef<'request' | 'accept'>('request');
  const [own, setOwn] = useState({ wechat: '', qq: '' });

  const load = useCallback(async () => {
    const mine = ++revision.current;
    try {
      const result = await api.connection(other.id);
      if (mine !== revision.current) return;
      setRequest(result.request);
      setContacts(result.contacts);
      setProblem((current) => (current?.kind === 'needContacts' ? current : null));
    } catch (cause) {
      if (mine !== revision.current) return;
      setRequest(null);
      setContacts(null);
      if (cause instanceof ApiError && cause.status === 404) setProblem({ kind: 'unavailable', message: '对方的主页暂不可用，暂时无法交换联系方式。' });
      else if (cause instanceof ApiError && cause.status === 403) setProblem({ kind: 'notEligible', message: '发布主页并确认四项隐私同意后，才能交换联系方式。' });
      else setProblem({ kind: 'error', message: cause instanceof ApiError ? cause.message : '加载失败，请稍后重试' });
    } finally {
      if (mine === revision.current) setLoaded(true);
    }
  }, [other.id]);

  // 对方在别处处理了申请时，会话摘要的 contactState 会随轮询变化，这里跟着重新读取
  useEffect(() => { void load(); }, [load, contactState]);
  useEffect(() => () => { revision.current += 1; }, []);

  const act = async (fn: () => Promise<unknown>, success: string) => {
    setBusy(true);
    try {
      await fn();
      setProblem(null);
      toast.success(success);
      onChanged();
      await load();
    } catch (cause) {
      if (cause instanceof ApiError && cause.data?.needContacts) {
        setProblem({ kind: 'needContacts', message: cause.message });
      } else {
        toast.error('操作失败', cause instanceof ApiError ? cause.message : undefined);
        onChanged();
        await load();
      }
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  };
  const sendRequest = () => {
    blocked.current = 'request';
    return act(() => api.requestConnection(other.id, ''), '已申请交换联系方式');
  };
  const respond = (action: 'accept' | 'reject') => {
    if (!request) return;
    if (action === 'accept') blocked.current = 'accept';
    void act(() => api.respondConnection(request.id, action), action === 'accept' ? '已同意交换联系方式' : '已拒绝交换');
  };
  const saveMineAndContinue = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || (!own.wechat.trim() && !own.qq.trim())) return;
    setBusy(true);
    try {
      await api.saveContacts({ wechat: own.wechat.trim(), qq: own.qq.trim() });
    } catch (cause) {
      setBusy(false);
      toast.error('联系方式没有保存成功', cause instanceof ApiError ? cause.message : undefined);
      return;
    }
    if (blocked.current === 'accept') respond('accept');
    else void sendRequest();
  };

  if (!loaded) return <div className="h-[52px] border-b border-line bg-surface-2" aria-hidden />;

  const state = request
    ? request.status === 'pending' ? (request.direction === 'outgoing' ? 'pending_outgoing' : 'pending_incoming') : request.status
    : 'none';
  const canRetryAt = request?.status === 'rejected' && request.direction === 'outgoing' ? retryDate(request) : null;
  const retryLocked = !!canRetryAt && canRetryAt.getTime() > Date.now();

  let text: string;
  let actions: ReactNode = null;
  if (problem && problem.kind !== 'needContacts') {
    text = problem.message;
    if (problem.kind === 'notEligible') actions = <Link to="/me/edit" className="text-[13px] font-semibold text-brand-text underline">去完善主页</Link>;
    if (problem.kind === 'error') actions = <Button size="sm" variant="ghost" onClick={() => void load()}>重试</Button>;
  } else if (state === 'accepted' && contacts) {
    text = '已交换联系方式';
    actions = (
      <Button size="sm" variant="ghost" aria-expanded={expanded} aria-controls={`contacts-${other.id}`} onClick={() => setExpanded((v) => !v)} iconRight={<ChevronDown size={15} className={cx('transition-transform', expanded && 'rotate-180')} />}>
        {expanded ? '收起' : '查看联系方式'}
      </Button>
    );
  } else if (state === 'accepted') {
    text = '你们已同意交换联系方式，暂时无法读取，请稍后再试。';
    actions = <Button size="sm" variant="ghost" onClick={() => void load()}>重试</Button>;
  } else if (state === 'pending_outgoing') {
    text = '已申请交换联系方式，等待对方同意。';
  } else if (state === 'pending_incoming') {
    text = `${other.nickname} 想和你交换联系方式`;
    actions = (
      <>
        <Button size="sm" variant="primary" disabled={busy} onClick={() => setConfirm('accept')}>同意</Button>
        <Button size="sm" disabled={busy} onClick={() => setConfirm('reject')}>拒绝</Button>
      </>
    );
  } else if (state === 'rejected' && request?.direction === 'outgoing') {
    text = retryLocked ? `对方暂时没有同意，${shortDate(canRetryAt!)}后可以再次申请。` : '对方上次没有同意，现在可以再次申请。';
    if (!retryLocked) actions = <Button size="sm" variant="soft" disabled={busy} onClick={() => setConfirm('request')}>再次申请</Button>;
  } else if (state === 'rejected') {
    text = '你拒绝了交换联系方式。';
    actions = <Button size="sm" variant="ghost" disabled={busy} onClick={() => setConfirm('request')}>改为申请交换</Button>;
  } else {
    text = '聊得合适，再决定是否交换联系方式。';
    actions = <Button size="sm" variant="soft" disabled={busy} onClick={() => setConfirm('request')}>申请交换联系方式</Button>;
  }

  return (
    <section className="border-b border-line bg-surface-2" aria-label="交换联系方式">
      <div className="flex min-h-[52px] flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5">
        <p className="flex min-w-0 flex-1 items-center gap-2 text-[13.5px] text-ink-2" role="status">
          {state === 'accepted' && contacts ? <ShieldCheck size={15} className="shrink-0 text-brand-text" aria-hidden /> : <Lock size={14} className="shrink-0 text-ink-3" aria-hidden />}
          <span className="min-w-0">{text}</span>
        </p>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
      {problem?.kind === 'needContacts' && (
        <form className="border-t border-line px-4 py-3" onSubmit={saveMineAndContinue}>
          <p className="text-[13px] leading-relaxed text-ink-2" role="alert">交换之前，先填一种你自己的联系方式。它只在双方都同意后给对方看到，之后可以在问卷里修改。</p>
          <div className="mt-2.5 grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
            <Input aria-label="我的微信号" placeholder="微信号" maxLength={40} value={own.wechat} disabled={busy} onChange={(e) => setOwn((v) => ({ ...v, wechat: e.target.value }))} />
            <Input aria-label="我的 QQ 号" placeholder="QQ 号" inputMode="numeric" maxLength={20} value={own.qq} disabled={busy} onChange={(e) => setOwn((v) => ({ ...v, qq: e.target.value.replace(/\D/g, '') }))} />
            <Button type="submit" variant="primary" loading={busy} disabled={!own.wechat.trim() && !own.qq.trim()}>
              {blocked.current === 'accept' ? '保存并同意交换' : '保存并发送申请'}
            </Button>
          </div>
        </form>
      )}
      {state === 'pending_incoming' && !problem && (
        <p className="border-t border-line px-4 py-2 text-[12.5px] text-ink-3">同意后，你在资料里填写的联系方式会向对方开放；开启了交换校园邮箱的话，邮箱里包含学号。</p>
      )}
      {state === 'accepted' && contacts && expanded && (
        <div id={`contacts-${other.id}`} className="border-t border-line bg-surface">
          <ContactRows contacts={contacts} />
        </div>
      )}
      <ConfirmDialog
        open={confirm !== null}
        title={confirm === 'accept' ? '同意交换联系方式？' : confirm === 'reject' ? '暂时不交换联系方式？' : '申请交换联系方式？'}
        desc={confirm === 'accept'
          ? `同意后，你和 ${other.nickname} 会互相看到对方在资料里填写的联系方式（微信、QQ、手机等；开启交换的校园邮箱包含学号）。`
          : confirm === 'reject'
            ? `${other.nickname} 会在聊天里看到你暂时不想交换，${REREQUEST_DAYS} 天内不能再次申请。你之后可以随时改为主动申请。`
            : `对方同意后，你们会互相看到对方在资料里填写的联系方式。被拒绝后需要等 ${REREQUEST_DAYS} 天才能再次申请。`}
        confirmText={confirm === 'accept' ? '同意交换' : confirm === 'reject' ? '暂不交换' : '发送申请'}
        loading={busy}
        onCancel={() => { if (!busy) setConfirm(null); }}
        onConfirm={() => (confirm === 'accept' ? respond('accept') : confirm === 'reject' ? respond('reject') : void sendRequest())}
      />
    </section>
  );
}
