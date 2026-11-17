import { useEffect, useState, useSyncExternalStore } from 'react';
import { ApiError, del, get, post } from './api';

export interface BenefitStatus {
  xmind: { limit: number; remaining: number; waitSeconds: number };
  marginnote: { remaining: number; enabled: boolean; phase: 'upcoming' | 'open' | 'exhausted' | 'ended'; renewalTerms: string; redeemBefore: string };
}
export interface XmindRecord { id: number; phone: string; createdAt: string }
/** The student's own registration; the number is masked by the server. */
export interface XmindRegistration { phone: string; createdAt: string }

export const benefitsApi = {
  status: () => get<BenefitStatus>('/benefits/status'),
  visit: () => post<{ token: string; waitSeconds: number }>('/benefits/xmind/visit'),
  register: (token: string, phone: string, consent: boolean) => post<{ id: number }>('/benefits/xmind/register', { token, phone, consent }),
  myXmind: () => get<{ registration: XmindRegistration | null }>('/benefits/xmind/mine'),
  removeRecord: (id: number) => del<{ ok: true }>(`/benefits/xmind/registrations/${id}`),
  myCode: () => get<{ code: string | null }>('/benefits/marginnote/mine'),
  claim: () => post<{ code: string }>('/benefits/marginnote/claim', { acceptTerms: true }),
};

const message = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback);

/** State shared by every component on the page, and kept while moving between pages. */
function createStore<T>(initial: T) {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => state,
    set: (next: T | ((previous: T) => T)) => {
      state = typeof next === 'function' ? (next as (previous: T) => T)(state) : next;
      listeners.forEach((listener) => listener());
    },
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
}

// ---------- 活动状态 ----------
// 入口、专区和详情页共用一份状态：进入页面或回到页面时，过期了才重新读取，不做定时轮询。

const STATUS_FRESH_MS = 30_000;
const statusStore = createStore<{ status: BenefitStatus | null; error: string; at: number }>({ status: null, error: '', at: 0 });
let statusRequest: Promise<void> | null = null;

export function refreshBenefitsStatus() {
  statusRequest ??= benefitsApi.status()
    .then((status) => statusStore.set({ status, error: '', at: Date.now() }))
    // A failed read stays stale, so the next page or the next return to this one tries again.
    .catch((e) => statusStore.set((previous) => ({ ...previous, error: message(e, '活动状态暂时无法加载') })))
    .finally(() => { statusRequest = null; });
  return statusRequest;
}

export function useBenefitsStatus() {
  const { status, error } = useSyncExternalStore(statusStore.subscribe, statusStore.get);
  useEffect(() => {
    const refreshIfStale = () => { if (!document.hidden && Date.now() - statusStore.get().at > STATUS_FRESH_MS) void refreshBenefitsStatus(); };
    refreshIfStale();
    document.addEventListener('visibilitychange', refreshIfStale);
    return () => document.removeEventListener('visibilitychange', refreshIfStale);
  }, []);
  return { status, error, reload: refreshBenefitsStatus };
}

export function marginNoteStatusLabel(status: BenefitStatus | null, error: string) {
  if (error) return '状态暂时无法加载';
  if (!status) return '正在加载活动状态';
  return { upcoming: '暂未开放领取', open: '已开放领取', exhausted: '本批兑换码已领完', ended: '活动已结束' }[status.marginnote.phase];
}

// ---------- Xmind 浏览计时与登记 ----------
// 计时从打开 Xmind 活动页开始，按实际经过的时间计算，与服务器的判断方式一致：
// 切到别的标签页、打开模板链接、去别的福利页或刷新页面，都不会暂停或重新开始。

interface XmindVisit { token: string; userId: number; startedAt: number; waitMs: number }
interface ClaimState {
  userId: number | null;
  /** undefined：还没读到 */
  registration: XmindRegistration | null | undefined;
  visit: XmindVisit | null;
  formOpen: boolean;
  error: string;
}

const VISIT_KEY = 'dz:xmind-visit';
// 服务器上的浏览凭证一小时后过期；提前几分钟换新的，免得填到一半失效
const VISIT_MAX_AGE_MS = 55 * 60_000;
const EMPTY_CLAIM: ClaimState = { userId: null, registration: undefined, visit: null, formOpen: false, error: '' };
const claimStore = createStore<ClaimState>(EMPTY_CLAIM);
let visitRequest: Promise<void> | null = null;

const visitAlive = (visit: XmindVisit | null, userId: number): visit is XmindVisit =>
  !!visit && visit.userId === userId && Date.now() - visit.startedAt < VISIT_MAX_AGE_MS && Date.now() >= visit.startedAt;

function storedVisit(userId: number): XmindVisit | null {
  try {
    const visit = JSON.parse(sessionStorage.getItem(VISIT_KEY) ?? 'null') as XmindVisit | null;
    if (visit && typeof visit.token === 'string' && typeof visit.startedAt === 'number' && typeof visit.waitMs === 'number' && visitAlive(visit, userId)) return visit;
  } catch { /* 读不到就重新计时 */ }
  return null;
}
function saveVisit(visit: XmindVisit | null) {
  try {
    if (visit) sessionStorage.setItem(VISIT_KEY, JSON.stringify(visit));
    else sessionStorage.removeItem(VISIT_KEY);
  } catch { /* 无法保存时，计时只在本次打开的页面内有效 */ }
}

function loadRegistration(userId: number) {
  benefitsApi.myXmind()
    .then((data) => { if (claimStore.get().userId === userId) claimStore.set((s) => ({ ...s, registration: data.registration, error: '' })); })
    .catch((e) => { if (claimStore.get().userId === userId) claimStore.set((s) => ({ ...s, error: message(e, '登记状态暂时无法加载') })); });
}

function followUser(userId: number | null) {
  if (claimStore.get().userId === userId) return;
  if (userId === null) { claimStore.set(EMPTY_CLAIM); return; }
  claimStore.set({ ...EMPTY_CLAIM, userId, visit: storedVisit(userId) });
  loadRegistration(userId);
}

function startVisit(userId: number) {
  visitRequest ??= benefitsApi.visit()
    .then((data) => {
      if (claimStore.get().userId !== userId) return;
      const visit = { token: data.token, userId, startedAt: Date.now(), waitMs: data.waitSeconds * 1000 };
      saveVisit(visit);
      claimStore.set((s) => ({ ...s, visit, error: '' }));
    })
    .catch((e) => { if (claimStore.get().userId === userId) claimStore.set((s) => ({ ...s, error: message(e, '浏览计时暂时无法开始') })); })
    .finally(() => { visitRequest = null; });
}

export const openXmindForm = () => claimStore.set((s) => ({ ...s, formOpen: true }));
export const closeXmindForm = () => claimStore.set((s) => ({ ...s, formOpen: false }));

/** Reads the registration again and, if the countdown never started, starts it. */
export function retryXmindClaim() {
  const { userId, registration, visit } = claimStore.get();
  if (userId === null) return;
  claimStore.set((s) => ({ ...s, error: '' }));
  if (registration === undefined) loadRegistration(userId);
  else if (registration === null && !visitAlive(visit, userId)) startVisit(userId);
}

/** Resolves when the registration is recorded; rejects with a message that can be shown as is. */
export async function submitXmindRegistration(phone: string) {
  const { userId, visit } = claimStore.get();
  if (userId === null || !visitAlive(visit, userId)) throw new Error('页面打开太久了，请关闭后稍等片刻再登记');
  try {
    await benefitsApi.register(visit.token, phone, true);
  } catch (e) {
    void refreshBenefitsStatus();
    if (e instanceof ApiError && e.status === 409) loadRegistration(userId);
    // 凭证失效：换一个新的重新计时，同学不用自己刷新页面
    if (e instanceof ApiError && e.status === 400 && e.message.includes('过期')) {
      saveVisit(null);
      claimStore.set((s) => ({ ...s, visit: null, formOpen: false }));
      startVisit(userId);
      throw new Error('页面打开太久，已为你重新开始 30 秒计时');
    }
    throw e;
  }
  saveVisit(null);
  if (claimStore.get().userId === userId) {
    claimStore.set((s) => ({ ...s, visit: null, formOpen: false, registration: { phone: `${phone.slice(0, 3)}****${phone.slice(-4)}`, createdAt: new Date().toISOString() } }));
  }
  void refreshBenefitsStatus();
}

/**
 * `start`：Xmind 活动页传 true，表示从这里开始计时；其他福利页只跟着显示已经开始的计时。
 */
export function useXmindClaim(user: { id: number } | null | undefined, { start = false }: { start?: boolean } = {}) {
  const userId = user?.id ?? null;
  const state = useSyncExternalStore(claimStore.subscribe, claimStore.get);
  useEffect(() => { followUser(userId); }, [userId]);
  const mine = state.userId === userId ? state : EMPTY_CLAIM;
  const { registration, error } = mine;

  const [now, setNow] = useState(() => Date.now());
  const visit = userId !== null && visitAlive(mine.visit, userId) && now - mine.visit.startedAt < VISIT_MAX_AGE_MS ? mine.visit : null;
  const remainingMs = visit ? Math.max(0, visit.waitMs - (now - visit.startedAt)) : null;
  const counting = remainingMs !== null && remainingMs > 0;

  useEffect(() => {
    if (start && userId !== null && registration === null && !visit && !error) startVisit(userId);
  }, [start, userId, registration, visit, error]);

  // 计时中每秒刷新几次；计时结束后只需要在凭证快过期时再看一眼
  useEffect(() => {
    if (!visit) return;
    const tick = () => setNow(Date.now());
    tick();
    if (!counting) {
      const expiry = window.setTimeout(tick, Math.max(1000, visit.startedAt + VISIT_MAX_AGE_MS - Date.now() + 500));
      return () => window.clearTimeout(expiry);
    }
    const timer = window.setInterval(tick, 250);
    // 后台标签页的定时器会被浏览器放慢；回到页面时立刻对一次表
    document.addEventListener('visibilitychange', tick);
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', tick); };
  }, [visit, counting]);

  return {
    registration,
    error,
    formOpen: mine.formOpen,
    /** 计时已经开始（无论是否结束） */
    timing: remainingMs !== null,
    ready: remainingMs === 0,
    remaining: remainingMs === null ? null : Math.ceil(remainingMs / 1000),
    progress: visit && remainingMs !== null ? 1 - remainingMs / visit.waitMs : 0,
  };
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
