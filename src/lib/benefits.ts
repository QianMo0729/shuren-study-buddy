import { get, post } from './api';
import { useEffect, useState } from 'react';

export interface BenefitStatus {
  xmind: { limit: number; remaining: number; waitSeconds: number };
  marginnote: { remaining: number; enabled: boolean; phase: 'upcoming' | 'open' | 'exhausted' | 'ended'; renewalTerms: string; redeemBefore: string };
}
export interface XmindRecord { id: number; phone: string; createdAt: string }

export const benefitsApi = {
  status: () => get<BenefitStatus>('/benefits/status'),
  visit: () => post<{ token: string; waitSeconds: number }>('/benefits/xmind/visit'),
  register: (token: string, phone: string, consent: boolean) => post<{ id: number }>('/benefits/xmind/register', { token, phone, consent }),
  myCode: () => get<{ code: string | null }>('/benefits/marginnote/mine'),
  claim: () => post<{ code: string }>('/benefits/marginnote/claim', { acceptTerms: true }),
};

export function useBenefitsStatus() {
  const [status, setStatus] = useState<BenefitStatus | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    const load = () => benefitsApi.status().then((s) => { if (active) { setStatus(s); setError(''); } }).catch((e) => { if (active) setError(e instanceof Error ? e.message : '活动状态暂时无法加载'); });
    void load();
    const timer = window.setInterval(() => { if (!document.hidden) void load(); }, 10_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [attempt]);
  return { status, error, setStatus, reload: () => setAttempt((n) => n + 1) };
}

export function marginNoteStatusLabel(status: BenefitStatus | null, error: string) {
  if (error) return '状态暂时无法加载';
  if (!status) return '正在加载活动状态';
  return { upcoming: '暂未开放领取', open: '已开放领取', exhausted: '本批兑换码已领完', ended: '活动已结束' }[status.marginnote.phase];
}

export async function fetchXmindRecords(token: string, csv = false) {
  const response = await fetch(`/api/benefits/xmind/registrations${csv ? '?format=csv' : ''}`, {
    credentials: 'same-origin', cache: 'no-store',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || '名单读取失败，请重试');
  }
  return response;
}
