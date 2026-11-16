import { get, post } from './api';

export interface BenefitStatus {
  xmind: { limit: number; remaining: number; waitSeconds: number };
  marginnote: { remaining: number; enabled: boolean; renewalTerms: string; redeemBefore: string };
}
export interface XmindRecord { id: number; phone: string; createdAt: string }

export const benefitsApi = {
  status: () => get<BenefitStatus>('/benefits/status'),
  visit: () => post<{ token: string; waitSeconds: number }>('/benefits/xmind/visit'),
  register: (token: string, phone: string, consent: boolean) => post<{ id: number }>('/benefits/xmind/register', { token, phone, consent }),
  myCode: () => get<{ code: string | null }>('/benefits/marginnote/mine'),
  claim: () => post<{ code: string }>('/benefits/marginnote/claim', { acceptTerms: true }),
};

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
