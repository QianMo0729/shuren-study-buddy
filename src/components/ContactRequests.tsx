import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { Check, Copy, Lock, UserRoundX } from 'lucide-react';
import type { ContactRequest, ContactReveal } from '../../shared/types';
import { api, ApiError } from '../lib/api';
import { cx, timeAgo } from '../lib/format';
import { useToast } from '../lib/toast';
import { Button, ConfirmDialog, Empty, Skeleton, Tag, Textarea } from './ui';
import { Illustration } from './brand';

const statusLabels = { pending: '等待确认', accepted: '已同意交换', rejected: '未通过' };
const errorMessage = (cause: unknown) => cause instanceof ApiError ? cause.message : '操作失败，请稍后重试';

type ContactExchangeProps = { userId: number; nickname: string; onExcluded?: () => void };

export function ContactExchange(props: ContactExchangeProps) {
  // A different person always receives fresh state, even when the parent reuses this component.
  return <ContactExchangeForUser key={props.userId} {...props} />;
}

function ContactExchangeForUser({ userId, nickname, onExcluded }: ContactExchangeProps) {
  const [request, setRequest] = useState<ContactRequest | null>(null);
  const [contacts, setContacts] = useState<ContactReveal | null>(null);
  const [message, setMessage] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsProfile, setNeedsProfile] = useState(false);
  const [excluding, setExcluding] = useState(false);
  const [excluded, setExcluded] = useState(false);
  const alive = useRef(false);
  const loadRevision = useRef(0);
  const toast = useToast();
  const load = useCallback(async () => {
    const revision = ++loadRevision.current;
    const isCurrent = () => alive.current && revision === loadRevision.current;
    try {
      const result = await api.connection(userId);
      if (!isCurrent()) return false;
      setRequest(result.request);
      setContacts(result.contacts);
      setError(null);
      setNeedsProfile(false);
      return true;
    } catch (cause) {
      if (!isCurrent()) return false;
      setNeedsProfile(cause instanceof ApiError && cause.status === 403);
      setContacts(null);
      setError(errorMessage(cause));
      return false;
    } finally {
      if (isCurrent()) setLoaded(true);
    }
  }, [userId]);
  useEffect(() => {
    alive.current = true;
    setLoaded(false);
    setRequest(null);
    setContacts(null);
    setExcluded(false);
    setMessage('');
    void load();
    return () => { alive.current = false; loadRevision.current += 1; };
  }, [load]);

  const respond = async (action: 'accept' | 'reject') => {
    if (!request || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.respondConnection(request.id, action);
      if (!alive.current) return;
      if (await load()) toast.success(action === 'accept' ? '已同意交换联系方式' : '已拒绝请求');
    } catch (cause) { if (alive.current) setError(errorMessage(cause)); }
    finally { if (alive.current) setBusy(false); }
  };

  if (!loaded) return <Skeleton className="mt-5 h-32" />;
  if (excluded) return <p className="mt-5 rounded-lg bg-paper-2 p-4 text-[14px] text-ink-2" role="status">已排除这位同学，对方不会收到提示。可在「我的 · 匹配请求」中管理。</p>;
  return (
    <section className="mt-5 overflow-hidden rounded-lg border border-line bg-surface" aria-label="交换联系方式">
      <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
        <h3 className="flex items-center gap-2 text-[14px] font-semibold text-ink"><Lock size={15} aria-hidden />{contacts ? '双方已确认交换' : '联系方式需双方确认'}</h3>
        {request && <Tag tone={request.status === 'accepted' ? 'brand' : undefined}>{statusLabels[request.status]}</Tag>}
      </div>
      {contacts ? <ContactRows contacts={contacts} /> : <div className="space-y-3 p-4">
        {!request && !error && <>
          <p className="text-[13.5px] leading-relaxed text-ink-2">向 {nickname} 发起匹配请求。对方同意后，你们才能互相查看学校邮箱及已填写的联系方式。</p>
          <label className="block text-[13px] text-ink-3" htmlFor={`request-message-${userId}`}>介绍一下你的学习目标（选填）</label>
          <Textarea id={`request-message-${userId}`} value={message} onChange={(event) => setMessage(event.target.value)} maxLength={300} disabled={busy} placeholder="例如：想找周末一起复习高数的搭子，每次学习两小时。" className="min-h-24" />
          <Button variant="primary" loading={busy} onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              const result = await api.requestConnection(userId, message.trim());
              if (!alive.current) return;
              setRequest(result.request);
              setMessage('');
              toast.success('匹配请求已提交', result.emailStatus === 'sent' ? '对方会收到邮件提醒' : '可在「我的 · 匹配请求」查看处理状态');
            } catch (cause) { if (alive.current) setError(errorMessage(cause)); }
            finally { if (alive.current) setBusy(false); }
          }}>发起匹配请求</Button>
        </>}
        {request?.status === 'pending' && request.direction === 'outgoing' && <p className="text-[14px] text-ink-2">请求已发送，正在等待对方确认。确认前，双方联系方式保持隐藏。</p>}
        {request?.status === 'pending' && request.direction === 'incoming' && <>
          <p className="text-[14px] text-ink-2">{nickname} 希望与你交换联系方式。同意后，你选择分享的学校邮箱（包含学号）及已填写的联系方式将向对方开放。</p>
          {request.message && <blockquote className="rounded-md bg-paper-2 px-3 py-2 text-[14px] whitespace-pre-wrap text-ink-2">{request.message}</blockquote>}
          <div className="flex gap-2"><Button variant="primary" disabled={busy} onClick={() => respond('accept')}>同意交换</Button><Button disabled={busy} onClick={() => respond('reject')}>拒绝</Button></div>
        </>}
        {request?.status === 'rejected' && <p className="text-[14px] text-ink-2">{request.direction === 'outgoing' ? '对方未同意本次请求，联系方式仍保持隐藏。' : '你已拒绝本次请求，联系方式仍保持隐藏。'}</p>}
      </div>}
      {error && <div className="px-4 py-3"><p className="text-[13.5px] text-danger" role="alert">{error}</p>{needsProfile ? <Link to="/me/edit" className="mt-2 inline-block text-[13.5px] text-brand-text underline">完善并上传我的主页</Link> : <button type="button" disabled={busy} onClick={() => { setBusy(true); void load().finally(() => { if (alive.current) setBusy(false); }); }} className="mt-1 text-[13px] text-brand-text underline">{busy ? '加载中…' : '重新加载'}</button>}</div>}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line bg-surface-2 px-4 py-2.5">
        <p className="text-[12px] text-ink-3">学校邮箱会暴露学号，请谨慎确认。</p>
        <button type="button" onClick={() => setExcluding(true)} disabled={busy} className="inline-flex items-center gap-1 text-[12.5px] text-ink-3 hover:text-danger"><UserRoundX size={13} aria-hidden />排除这位同学</button>
      </div>
      <ConfirmDialog open={excluding} title="排除这位同学？" desc="排除后，双方将不再出现在彼此的匹配结果中，联系方式交换也会停止。对方不会收到提示；你可以在「我的」中取消排除。" confirmText="确认排除" tone="danger" loading={busy} onCancel={() => { if (!busy) setExcluding(false); }} onConfirm={async () => {
        setBusy(true);
        try { await api.excludeConnection(userId); if (!alive.current) return; loadRevision.current += 1; setContacts(null); setExcluded(true); setExcluding(false); onExcluded?.(); }
        catch (cause) { if (alive.current) setError(errorMessage(cause)); }
        finally { if (alive.current) setBusy(false); }
      }} />
    </section>
  );
}

export function ContactRequests() {
  const [items, setItems] = useState<ContactRequest[] | null>(null);
  const [exclusions, setExclusions] = useState<{ id: number; nickname: string }[]>([]);
  const [view, setView] = useState<'incoming' | 'outgoing' | 'excluded'>('incoming');
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);
  const toast = useToast();
  const load = useCallback(async () => {
    const result = await api.connections();
    setItems(result.items);
    setExclusions(result.exclusions);
    setError(null);
  }, []);
  useEffect(() => { void load().catch((cause) => setError(errorMessage(cause))); }, [load]);
  const filtered = items?.filter((item) => item.direction === view) ?? [];
  return <div className="space-y-4">
    <p className="text-[13.5px] leading-relaxed text-ink-2">发起请求后，只有对方同意才能互相查看联系方式。校园邮箱包含学号，同意前请确认你的分享意愿。</p>
    <div className="flex flex-wrap gap-2" aria-label="请求分类">
      {([{ id: 'incoming', label: '收到的请求' }, { id: 'outgoing', label: '发出的请求' }, { id: 'excluded', label: '已排除' }] as const).map((item) => <Button key={item.id} size="sm" variant={view === item.id ? 'soft' : 'ghost'} aria-pressed={view === item.id} onClick={() => { setView(item.id); setOpenId(null); }}>{item.label}{item.id === 'incoming' && !!items?.some((request) => request.direction === 'incoming' && request.status === 'pending') && ' · 待处理'}</Button>)}
    </div>
    {error && <p role="alert" className="rounded-lg bg-danger-soft p-3 text-[14px] text-danger">{error}<button type="button" onClick={() => { void load().catch((cause) => setError(errorMessage(cause))); }} className="ml-3 underline">重试</button></p>}
    {!items && !error ? <Skeleton className="h-48" /> : view === 'excluded' ? exclusions.length ? <ul className="divide-y divide-line rounded-lg bg-surface">{exclusions.map((person) => <li key={person.id} className="flex items-center justify-between gap-3 p-4"><span className="text-[14px] text-ink">{person.nickname}</span><Button size="sm" loading={busyId === person.id} disabled={busyId !== null} onClick={async () => { setBusyId(person.id); try { await api.restoreConnection(person.id); await load(); toast.success('已取消排除'); } catch (cause) { setError(errorMessage(cause)); } finally { setBusyId(null); } }}>取消排除</Button></li>)}</ul> : <Empty art={<Illustration name="mascot-empty" className="mb-4 size-24" />} title="没有排除的同学" desc="排除操作不会向对方发送提示。" /> : !filtered.length ? <Empty art={<Illustration name="mascot-empty" className="mb-4 size-24" />} title={view === 'incoming' ? '还没有收到匹配请求' : '还没有发出匹配请求'} desc="在搭子主页可以发起请求，结识学习目标相近的同学。" /> : <ul className="space-y-3">{filtered.map((item) => <li key={item.id} className="rounded-xl border border-line bg-surface p-4">
      <div className="flex items-start justify-between gap-3"><div><Link to={`/u/${item.other.id}`} className="font-display text-[18px] text-ink hover:text-brand-text">{item.other.nickname}</Link><p className="mt-0.5 text-[12px] text-ink-3">{timeAgo(item.createdAt)}</p></div><Tag tone={item.status === 'accepted' ? 'brand' : undefined}>{statusLabels[item.status]}</Tag></div>
      {item.message && <p className="mt-3 rounded-md bg-paper-2 px-3 py-2 text-[14px] whitespace-pre-wrap text-ink-2">{item.message}</p>}
      {item.status === 'pending' && item.direction === 'incoming' && <div className="mt-3 flex gap-2">{(['accept', 'reject'] as const).map((action) => <Button key={action} size="sm" variant={action === 'accept' ? 'primary' : 'secondary'} disabled={busyId !== null} onClick={async () => { setBusyId(item.id); try { await api.respondConnection(item.id, action); await load(); toast.success(action === 'accept' ? '已同意交换联系方式' : '已拒绝请求'); } catch (cause) { setError(errorMessage(cause)); } finally { setBusyId(null); } }}>{action === 'accept' ? '同意交换联系方式' : '拒绝'}</Button>)}</div>}
      {item.status === 'accepted' && <button type="button" className="mt-3 text-[13.5px] text-brand-text underline" aria-expanded={openId === item.id} onClick={() => setOpenId(openId === item.id ? null : item.id)}>{openId === item.id ? '收起联系方式' : '查看已交换的联系方式'}</button>}
      {openId === item.id && <ContactExchange userId={item.other.id} nickname={item.other.nickname} onExcluded={() => { setOpenId(null); void load().catch((cause) => setError(errorMessage(cause))); }} />}
    </li>)}</ul>}
  </div>;
}

function ContactRows({ contacts }: { contacts: ContactReveal }) {
  const rows = [{ label: '学校邮箱', value: contacts.email }, { label: '微信', value: contacts.wechat }, { label: 'QQ', value: contacts.qq }, { label: '手机', value: contacts.phone }, { label: '其他', value: contacts.other }].filter((item) => item.value);
  return <div className="divide-y divide-line">{rows.length ? rows.map((row) => <CopyRow key={row.label} label={row.label} value={row.value!} />) : <p className="px-4 py-3 text-[14px] text-ink-3">对方尚未填写其他联系方式。</p>}</div>;
}

function CopyRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  const toast = useToast();
  useEffect(() => { if (!copied) return; const timer = setTimeout(() => setCopied(false), 1400); return () => clearTimeout(timer); }, [copied]);
  return <div className="flex items-start gap-3 px-4 py-2.5"><span className="w-16 shrink-0 pt-1 text-[13px] text-ink-3">{label}</span><span className="min-w-0 flex-1 pt-1 text-[14px] break-all text-ink select-all">{value}</span><button type="button" onClick={async () => { try { if (!navigator.clipboard) throw new Error(); await navigator.clipboard.writeText(value); setCopied(true); } catch { toast.error('复制失败', '请长按或选中文字手动复制'); } }} className={cx('inline-flex h-8 shrink-0 items-center gap-1 rounded-md px-2 text-[12px] hover:bg-paper-2', copied ? 'text-brand-text' : 'text-ink-2')} aria-label={`复制${label}`}>{copied ? <Check size={14} /> : <Copy size={14} />}{copied ? '已复制' : '复制'}</button></div>;
}
