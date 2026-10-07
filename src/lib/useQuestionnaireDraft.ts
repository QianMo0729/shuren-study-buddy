import { useEffect, useRef, useState } from 'react';
import { emptyProfile, pickProfileInput } from '../../shared/profileRules';
import type { MyProfile, ProfileInput, QuestionnaireSection } from '../../shared/types';
import { api } from './api';
import { localDraftExpired, restoreQuestionnaireDraft, type QuestionnaireSnapshot as Snapshot } from './questionnaireDraft';

type SaveState = 'idle' | 'saving' | 'saved' | 'local' | 'error';
const sections = ['identity', 'demographics', 'goals', 'study', 'personality', 'expectations', 'privacy', 'review'];
const signature = (s: Snapshot) => JSON.stringify([s.form, s.section]);
const draftWrites = new Map<string, Promise<void>>();

function localDraft(key: string): Snapshot | null {
  try {
    const raw = JSON.parse(localStorage.getItem(key) || 'null');
    if (!raw?.form || !Number.isFinite(raw.at)) return null;
    // 已同步的副本和过期的副本都不会再用到，不在本机多留一份私密资料
    if (raw.pending === false || localDraftExpired(raw.at)) {
      localStorage.removeItem(key);
      return null;
    }
    // Ignore corrupt storage instead of letting it break the questionnaire.
    const form = pickProfileInput(raw.form);
    for (const [key, value] of Object.entries(emptyProfile())) {
      const candidate = form[key as keyof ProfileInput];
      if (Array.isArray(value) ? !Array.isArray(candidate) : value !== null && typeof candidate !== typeof value) return null;
    }
    return { form, section: sections.includes(raw.section) ? raw.section : 'identity', at: raw.at, pending: typeof raw.pending === 'boolean' ? raw.pending : undefined };
  } catch { return null; }
}

/** Keep drafts separate from the published profile; serialize writes before submitting. */
export function useQuestionnaireDraft(userId: number | undefined) {
  const [profile, setProfile] = useState<MyProfile | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot>({ form: emptyProfile(), section: 'identity', at: 0 });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [restored, setRestored] = useState(false);
  const [version, setVersion] = useState(0);
  const latest = useRef(snapshot);
  const acknowledged = useRef('');
  const inFlight = useRef<Promise<void> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const paused = useRef(false);
  const mounted = useRef(false);
  const localOK = useRef(true);
  const ready = useRef(false);
  const key = `dz-draft-${userId}`;
  // 本机只保存尚未同步到服务器的修改；服务器确认之后立即删除（恢复时本来也只会采用未确认的副本）
  const stash = (s: Snapshot) => {
    if (userId === undefined) return;
    try { localStorage.setItem(key, JSON.stringify(s)); localOK.current = true; }
    catch { localOK.current = false; }
  };
  const unstash = () => { try { localStorage.removeItem(key); } catch { /* Storage can be disabled. */ } };
  const cancelTimer = () => { if (timer.current) clearTimeout(timer.current); timer.current = null; };

  const flush = (): Promise<void> => {
    if (inFlight.current) return inFlight.current;
    if (!ready.current || paused.current || !mounted.current || signature(latest.current) === acknowledged.current) return Promise.resolve();
    const sent = latest.current;
    setSaveState('saving');
    const work = (async () => {
      let failed = false;
      try {
        await api.saveProfileDraft(sent.form, sent.section);
        acknowledged.current = signature(sent);
        if (signature(latest.current) === acknowledged.current) {
          latest.current = { ...latest.current, pending: false };
          unstash();
        }
        if (mounted.current) setSaveState(signature(latest.current) === acknowledged.current ? 'saved' : 'saving');
      } catch {
        failed = true;
        // A lost response can hide a successful write. Re-send the latest answer
        // even when the user reverted to the previously acknowledged snapshot.
        acknowledged.current = '';
        if (mounted.current) setSaveState(localOK.current ? 'local' : 'error');
      } finally {
        inFlight.current = null;
        draftWrites.delete(key);
        if (mounted.current && !paused.current && signature(latest.current) !== acknowledged.current) {
          cancelTimer();
          timer.current = setTimeout(() => void flush(), failed ? 5000 : 650);
        }
      }
    })();
    inFlight.current = work;
    draftWrites.set(key, work);
    return work;
  };

  useEffect(() => {
    let alive = true;
    mounted.current = true;
    ready.current = false;
    paused.current = false;
    setLoading(true); setLoadError('');
    // A failed draft read must never overwrite an existing server draft.
    void (async () => {
      await draftWrites.get(key);
      const [{ profile: p }, { draft }] = await Promise.all([api.myProfile(), api.profileDraft()]);
      if (!alive) return;
      const base: Snapshot = { form: pickProfileInput(p), section: 'identity', at: 0 };
      const remote: Snapshot | null = draft ? { form: draft.form, section: draft.section, at: Date.parse(draft.updatedAt) } : null;
      const local = localDraft(key);
      const recovered = restoreQuestionnaireDraft({ base, remote, local, savedAt: p.savedAt });
      if (local && recovered.snapshot !== local) unstash();
      const next = { ...recovered.snapshot, form: { ...pickProfileInput(recovered.snapshot.form), studentId: p.email.split('@')[0] } };
      acknowledged.current = signature(recovered.server);
      latest.current = next;
      ready.current = true;
      setProfile(p); setSnapshot(next); setRestored(recovered.restored);
      setSaveState(recovered.server === remote ? 'saved' : 'idle');
      setLoading(false);
    })().catch((e) => { if (alive) { setLoadError(e instanceof Error ? e.message : '无法加载问卷'); setLoading(false); } });
    const online = () => { cancelTimer(); if (ready.current) void flush(); else setVersion((v) => v + 1); };
    window.addEventListener('online', online);
    return () => { alive = false; mounted.current = false; cancelTimer(); window.removeEventListener('online', online); };
  }, [key, version]);

  useEffect(() => {
    if (loading || !profile || paused.current) return;
    if (signature(snapshot) === acknowledged.current) {
      // Reverting an edit before the debounce fires needs no write, but must
      // settle both the visible status and the local recovery marker.
      if (!inFlight.current) {
        latest.current = { ...snapshot, pending: false };
        unstash();
        setSaveState('saved');
      }
      return;
    }
    stash(snapshot);
    setSaveState('saving');
    cancelTimer();
    timer.current = setTimeout(() => void flush(), 650);
    return cancelTimer;
  }, [snapshot, loading, profile]);

  const update = (form: ProfileInput, section = latest.current.section) => {
    if (paused.current) return;
    const next = { form, section, at: Date.now(), pending: true };
    latest.current = next;
    // Synchronous local backup also covers immediate navigation and closing the tab.
    stash(next);
    setSnapshot(next);
  };

  return {
    profile, form: snapshot.form, section: snapshot.section, loading, loadError, saveState, restored,
    reload: () => setVersion((v) => v + 1),
    setField: <K extends keyof ProfileInput>(field: K, value: ProfileInput[K]) => update({ ...latest.current.form, [field]: value }),
    setForm: (form: ProfileInput) => update(form),
    setSection: (section: QuestionnaireSection) => update(latest.current.form, section),
    pause: async () => { paused.current = true; cancelTimer(); await inFlight.current; },
    resume: () => { paused.current = false; void flush(); },
    complete: () => { paused.current = true; cancelTimer(); unstash(); },
  };
}
