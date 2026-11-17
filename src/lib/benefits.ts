import { useEffect, useState, useSyncExternalStore } from 'react';
import { ApiError, del, get, post, put } from './api';

export interface BenefitStatus {
  xmind: { open: boolean; limit: number; remaining: number; waitSeconds: number };
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
  setXmindOpen: (open: boolean) => put<BenefitStatus>('/benefits/xmind/open', { open }),
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

/** 管理员开放或暂停登记后，用接口返回的新状态直接更新页面 */
export function setBenefitsStatus(status: BenefitStatus) {
  statusStore.set({ status, error: '', at: Date.now() });
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
// 只有在浏览活动时才计时：福利页面开着并且在屏幕上，或者刚从福利页面点开了模板、视频、指南（它们在新标签页打开）。
// 去了网站的其他页面、切到别的应用或关掉页面，计时暂停；回来后接着之前的秒数继续，刷新也不会重来。

interface XmindVisit { token: string; userId: number; startedAt: number; waitMs: number; /** 已经累计的浏览时间 */ activeMs: number }
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
    if (visit && typeof visit.token === 'string' && [visit.startedAt, visit.waitMs, visit.activeMs].every((n) => typeof n === 'number') && visitAlive(visit, userId)) return visit;
  } catch { /* 读不到就重新计时 */ }
  return null;
}
function saveVisit(visit: XmindVisit | null) {
  try {
    if (visit) sessionStorage.setItem(VISIT_KEY, JSON.stringify(visit));
    else sessionStorage.removeItem(VISIT_KEY);
  } catch { /* 无法保存时，计时只在本次打开的页面内有效 */ }
}

// 累计浏览时间。福利页面在屏幕上时由 startTracking 开始、stopTracking 结束（按页面数计数，页面之间跳转不会中断）。
let trackers = 0;
let tickTimer: number | undefined;
let lastTick = 0;
let hiddenSince: number | null = null;
let awayOnActivityLink = false;

function credit(ms: number) {
  const { visit } = claimStore.get();
  if (!visit || ms <= 0 || visit.activeMs >= visit.waitMs) return;
  const next = { ...visit, activeMs: Math.min(visit.waitMs, visit.activeMs + ms) };
  claimStore.set((state) => (state.visit === visit ? { ...state, visit: next } : state));
  // 每满一秒存一次，刷新页面后从这里接着算
  if (next.activeMs >= next.waitMs || Math.floor(next.activeMs / 1000) !== Math.floor(visit.activeMs / 1000)) saveVisit(next);
}
function tick() {
  const now = Date.now();
  // 页面被系统挂起后恢复时，两次计时之间可能隔了很久，那段时间不算
  if (!document.hidden) credit(Math.min(now - lastTick, 1000));
  lastTick = now;
}
function onVisibility() {
  const now = Date.now();
  if (document.hidden) {
    credit(Math.min(now - lastTick, 1000));
    hiddenSince = now;
  } else {
    // 是点开活动里的模板、视频或指南离开的：看它们的时间也算浏览
    if (hiddenSince !== null && awayOnActivityLink) credit(now - hiddenSince);
    hiddenSince = null;
    awayOnActivityLink = false;
  }
  lastTick = now;
}
function onActivityLink(event: MouseEvent) {
  const target = event.target instanceof Element ? event.target.closest('a[target="_blank"]') : null;
  if (!target?.closest('.benefits-page main')) return;
  awayOnActivityLink = true;
  // 链接没有把页面切到后台（比如在后台标签页打开）时，这个标记不保留，免得之后切走也被算进去
  window.setTimeout(() => { if (!document.hidden) awayOnActivityLink = false; }, 3000);
}
function startTracking() {
  trackers += 1;
  if (trackers > 1) return;
  lastTick = Date.now();
  hiddenSince = document.hidden ? lastTick : null;
  tickTimer = window.setInterval(tick, 250);
  document.addEventListener('visibilitychange', onVisibility);
  document.addEventListener('click', onActivityLink, true);
}
function stopTracking() {
  trackers -= 1;
  if (trackers > 0) return;
  tick();
  window.clearInterval(tickTimer);
  document.removeEventListener('visibilitychange', onVisibility);
  document.removeEventListener('click', onActivityLink, true);
  hiddenSince = null;
  awayOnActivityLink = false;
  const { visit } = claimStore.get();
  if (visit) saveVisit(visit);
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
      const visit = { token: data.token, userId, startedAt: Date.now(), waitMs: data.waitSeconds * 1000, activeMs: 0 };
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
 * `start`：Xmind 活动页传 true，表示登记开放时从这里开始计时；其他福利页只跟着显示已经开始的计时。
 * `track`：每个福利页面上由倒计时小球传 true，这个页面在屏幕上的时间才会累计。
 */
export function useXmindClaim(user: { id: number } | null | undefined, { start = false, track = false }: { start?: boolean; track?: boolean } = {}) {
  const userId = user?.id ?? null;
  const state = useSyncExternalStore(claimStore.subscribe, claimStore.get);
  useEffect(() => { followUser(userId); }, [userId]);
  const mine = state.userId === userId ? state : EMPTY_CLAIM;
  const { registration, error } = mine;

  // 凭证过期的那一刻没有别的东西触发重新渲染，到点自己刷新一次
  const [, refresh] = useState(0);
  const visit = userId !== null && visitAlive(mine.visit, userId) ? mine.visit : null;
  const startedAt = visit?.startedAt;
  useEffect(() => {
    if (startedAt === undefined) return;
    const timer = window.setTimeout(() => refresh((n) => n + 1), Math.max(1000, startedAt + VISIT_MAX_AGE_MS - Date.now() + 500));
    return () => window.clearTimeout(timer);
  }, [startedAt]);

  useEffect(() => {
    if (start && userId !== null && registration === null && !visit && !error) startVisit(userId);
  }, [start, userId, registration, visit, error]);

  useEffect(() => {
    if (!track) return;
    startTracking();
    return stopTracking;
  }, [track]);

  const remainingMs = visit ? Math.max(0, visit.waitMs - visit.activeMs) : null;
  return {
    registration,
    error,
    formOpen: mine.formOpen,
    /** 计时已经开始（无论是否结束） */
    timing: remainingMs !== null,
    ready: remainingMs === 0,
    remaining: remainingMs === null ? null : Math.ceil(remainingMs / 1000),
    progress: visit ? visit.activeMs / visit.waitMs : 0,
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
