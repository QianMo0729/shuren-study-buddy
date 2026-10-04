import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Check, Copy } from 'lucide-react';
import type { ContactRequest, ContactReveal } from '../../shared/types';
import { api, ApiError } from '../lib/api';
import { cx, timeAgo } from '../lib/format';
import { useToast } from '../lib/toast';
import { Button, Empty, Skeleton, Tag } from './ui';
import { Illustration } from './brand';

// 交换联系方式已经搬进私聊（src/components/chat/ContactCard.tsx）。
// 这里保留：联系方式的展示行 ContactRows / CopyRow（私聊复用），以及旧版「匹配请求」列表（仅作兼容，不再被「我的」页使用）。

const statusLabels = { pending: '等待确认', accepted: '已交换', rejected: '未通过' };
const errorMessage = (cause: unknown) => cause instanceof ApiError ? cause.message : '操作失败，请稍后重试';

/** 旧版「匹配请求」列表：只读展示，处理申请请前往私聊 */
export function ContactRequests() {
  const [items, setItems] = useState<ContactRequest[] | null>(null);
  const [exclusions, setExclusions] = useState<{ id: number; nickname: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const toast = useToast();
  const load = useCallback(async () => {
    const result = await api.connections();
    setItems(result.items);
    setExclusions(result.exclusions);
    setError(null);
  }, []);
  useEffect(() => { void load().catch((cause) => setError(errorMessage(cause))); }, [load]);
  return <div className="space-y-4">
    <p className="text-[13.5px] leading-relaxed text-ink-2">交换联系方式现在在私聊中完成：互相感兴趣后，在聊天顶部申请或同意交换。</p>
    <Link to="/messages" className="inline-block text-[14px] text-brand-text underline">前往私聊</Link>
    {error && <p role="alert" className="rounded-lg bg-danger-soft p-3 text-[14px] text-danger">{error}</p>}
    {!items && !error ? <Skeleton className="h-32" /> : !!items?.length && <ul className="divide-y divide-line rounded-lg border border-line bg-surface">{items.map((item) => <li key={item.id} className="flex items-center justify-between gap-3 px-4 py-3">
      <div className="min-w-0"><p className="truncate text-[14px] text-ink">{item.other.nickname}</p><p className="text-[12px] text-ink-3">{item.direction === 'incoming' ? '对方发起' : '我发起'} · {timeAgo(item.updatedAt)}</p></div>
      <Tag tone={item.status === 'accepted' ? 'brand' : undefined}>{statusLabels[item.status]}</Tag>
    </li>)}</ul>}
    {exclusions.length > 0 && <section aria-label="已排除的同学">
      <h3 className="mb-2 text-[13px] font-semibold text-ink-3">已排除</h3>
      <ul className="divide-y divide-line rounded-lg border border-line bg-surface">{exclusions.map((person) => <li key={person.id} className="flex items-center justify-between gap-3 p-4"><span className="text-[14px] text-ink">{person.nickname}</span><Button size="sm" loading={busyId === person.id} disabled={busyId !== null} onClick={async () => { setBusyId(person.id); try { await api.restoreConnection(person.id); await load(); toast.success('已取消排除'); } catch (cause) { setError(errorMessage(cause)); } finally { setBusyId(null); } }}>取消排除</Button></li>)}</ul>
    </section>}
    {items && !items.length && !exclusions.length && <Empty art={<Illustration name="mascot-empty" className="mb-4 size-24" />} title="还没有交换联系方式的记录" desc="互相感兴趣后，可以在私聊里申请交换联系方式。" />}
  </div>;
}

/** 已交换的联系方式：每行可一键复制 */
export function ContactRows({ contacts }: { contacts: ContactReveal }) {
  const rows = [{ label: '学校邮箱', value: contacts.email }, { label: '微信', value: contacts.wechat }, { label: 'QQ', value: contacts.qq }, { label: '手机', value: contacts.phone }, { label: '其他', value: contacts.other }].filter((item) => item.value);
  return <div className="divide-y divide-line">{rows.length ? rows.map((row) => <CopyRow key={row.label} label={row.label} value={row.value!} />) : <p className="px-4 py-3 text-[14px] text-ink-3">对方尚未填写其他联系方式。</p>}</div>;
}

export function CopyRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  const toast = useToast();
  useEffect(() => { if (!copied) return; const timer = setTimeout(() => setCopied(false), 1400); return () => clearTimeout(timer); }, [copied]);
  return <div className="flex items-start gap-3 px-4 py-2.5"><span className="w-16 shrink-0 pt-1 text-[13px] text-ink-3">{label}</span><span className="min-w-0 flex-1 pt-1 text-[14px] break-all text-ink select-all">{value}</span><button type="button" onClick={async () => { try { if (!navigator.clipboard) throw new Error(); await navigator.clipboard.writeText(value); setCopied(true); } catch { toast.error('复制失败', '请长按或选中文字手动复制'); } }} className={cx('inline-flex h-8 shrink-0 items-center gap-1 rounded-md px-2 text-[12px] hover:bg-paper-2', copied ? 'text-brand-text' : 'text-ink-2')} aria-label={`复制${label}`}>{copied ? <Check size={14} /> : <Copy size={14} />}{copied ? '已复制' : '复制'}</button></div>;
}
