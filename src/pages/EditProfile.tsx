import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { Check, ShieldAlert } from 'lucide-react';
import { GENDERS, GRADES, STUDY_TYPES, PLACES, PLAN_PRESETS, STUDY_METHODS, FREQUENCIES, DURATIONS, INTERESTS, DISLIKE_OPTIONS, STATUSES, slotsHours } from '../../shared/options';
import { emptyProfile, effectiveSchedule, missingFields, pickProfileInput } from '../../shared/profileRules';
import type { MyProfile, ProfileInput, PrivacyConsent } from '../../shared/types';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { dateTime } from '../lib/format';
import { useToast } from '../lib/toast';
import { Button, ChipGroup, ConfirmDialog, Field, Input, PageHeader, Skeleton, Tag, Textarea, Toggle } from '../components/ui';
import { PhotoUploader, OptionCards } from '../components/profileForm';
import { TimeGrid } from '../components/TimeGrid';
import { Nickname, ProfileCard } from '../components/ProfileCard';
import { Plate } from '../components/brand';

const SECTIONS = [
  { id: 'identity', title: 'A · 身份与展示', keys: ['realName'] },
  { id: 'demographics', title: 'B · 基础画像', keys: [] },
  { id: 'goals', title: 'C · 状态与目标', keys: ['planTags'] },
  { id: 'study', title: 'D · 时间、地点与方式', keys: ['places', 'schedule', 'studyType'] },
  { id: 'expectations', title: 'E · 学科与期待', keys: [] },
  { id: 'privacy', title: 'F · 补充与隐私', keys: ['privacyConsent'] },
];
const CONSENTS: { key: keyof PrivacyConsent; text: ReactNode }[] = [
  { key: 'policy', text: <>我已阅读并同意<Link to="/privacy" target="_blank" className="text-brand-text underline">《隐私政策》</Link>，知悉学号与邮箱仅管理员可见。</> },
  { key: 'contactExchange', text: '我知悉校园邮箱展示将暴露学号，同意仅在双方都确认后交换。' },
  { key: 'silentExclusion', text: '我知悉被排除的同学不会收到任何提示。' },
  { key: 'withdrawal', text: '我知悉内容撤下后原图链接立即失效，注销时公开内容将被撤回。' },
];

export function EditProfile() {
  const { user, refresh } = useAuth();
  const toast = useToast();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const onboarding = params.get('onboarding') === '1' || !user?.questionnaireComplete;
  const [form, setForm] = useState<ProfileInput>(emptyProfile);
  const [profile, setProfile] = useState<MyProfile | null>(null);
  const [saved, setSaved] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const [draft, setDraft] = useState<{ form: ProfileInput; at: number } | null>(null);
  const draftKey = `dz-draft-${user?.id}`;
  const missing = useMemo(() => missingFields(form), [form]);
  const dirty = !!profile && JSON.stringify(form) !== saved;
  const set = <K extends keyof ProfileInput>(k: K, v: ProfileInput[K]) => setForm((f) => ({ ...f, [k]: v }));
  const error = (key: keyof ProfileInput) => showErrors && missing.some((m) => m.key === key) ? '请完成此项' : undefined;
  const accept = (p: MyProfile) => {
    const data = pickProfileInput(p);
    setProfile(p); setForm(data); setSaved(JSON.stringify(data));
  };
  const load = () => {
    setLoading(true); setLoadError('');
    api.myProfile().then(({ profile: p }) => {
      accept(p);
      try {
        const raw = JSON.parse(localStorage.getItem(`dz-draft-${p.userId}`) || 'null');
        if (raw?.form && JSON.stringify(pickProfileInput(raw.form)) !== JSON.stringify(pickProfileInput(p))) setDraft(raw);
      } catch { /* A malformed local draft must not stop server data loading. */ }
    }).catch((e) => setLoadError(e.message)).finally(() => setLoading(false));
  };
  useEffect(load, []);
  useEffect(() => {
    if (!dirty || !user) return;
    const t = setTimeout(() => {
      try { localStorage.setItem(draftKey, JSON.stringify({ form, at: Date.now() })); } catch { /* Storage can be disabled. */ }
    }, 500);
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => { clearTimeout(t); window.removeEventListener('beforeunload', warn); };
  }, [dirty, form, user, draftKey]);

  const save = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const { profile: p } = await api.saveProfile(form);
      accept(p); setDraft(null);
      try { localStorage.removeItem(draftKey); } catch {}
      toast.success('内容已保存', profile?.published && !p.published ? '资料缺少必填项，已暂时从广场撤回，补全后可重新发布。' : p.published ? '问卷已更新，下次推荐会使用新答案' : '点击“提交问卷并匹配”，确认发布后查看推荐');
      await refresh();
    } catch (e) { toast.error('保存失败', e instanceof Error ? e.message : undefined); }
    finally { setSaving(false); }
  };
  const preparePublish = () => {
    if (missing.length) { setShowErrors(true); document.getElementById(`f-${missing[0].key}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }
    setConfirm(true);
  };
  const publish = async () => {
    if (publishing || saving) return;
    setPublishing(true);
    try {
      const { profile: p, missing: required } = await api.saveProfile(form);
      accept(p); setDraft(null);
      try { localStorage.removeItem(draftKey); } catch {}
      if (required.length) {
        setShowErrors(true); setConfirm(false); await refresh();
        toast.error('请补全问卷', required.map((item) => item.label).join('、'));
        return;
      }
      if (!p.published || p.takenDown) await api.publish();
      await refresh(); setConfirm(false);
      nav('/square', { state: { justMatched: true } });
    } catch (e) { toast.error('提交失败', e instanceof Error ? e.message : undefined); }
    finally { setPublishing(false); }
  };
  if (loading) return <div className="space-y-6 py-10"><Skeleton className="h-14 w-64" /><Skeleton className="h-96 w-full" /></div>;
  if (!profile) return <div className="py-16"><p role="alert">{loadError || '无法加载资料'}</p><Button onClick={load} className="mt-4">重新加载</Button></div>;
  const liveCard = {
    id: profile.userId, nickname: profile.nickname, major: form.major, gender: form.gender, grade: form.grade,
    studyType: form.studyType, modes: [], status: form.status,
    cover: form.photoVisibility === 'public' ? form.photos[0] ?? null : null,
    mbti: '', isMe: true, overlapHours: 0, publishedAt: null, studyPlan: form.studyPlan, planTags: form.planTags,
  };
  return (
    <div className="pb-16">
      <PageHeader title={onboarding ? '填写你的搭子问卷' : '我的搭子问卷'} desc="填写学习目标、时间和偏好，提交后为你推荐合适的同学。带 * 的项目为必填。" actions={<Tag tone={profile.published ? 'brand' : undefined}>{profile.published ? '已在广场展示' : '尚未发布'}</Tag>} />
      {onboarding && <ol aria-label="开始匹配的步骤" className="mb-6 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl border border-line bg-surface px-5 py-4 text-sm"><li className="flex items-center gap-2 text-brand-text"><Check size={16} />账号已激活</li><li aria-current="step" className="font-semibold text-ink">2 · 填写问卷</li><li className="text-ink-3">3 · 查看搭子推荐</li></ol>}
      {profile.takenDown && <div className="mb-5 flex gap-3 rounded-lg bg-danger-soft p-4 text-sm"><ShieldAlert className="shrink-0 text-danger" size={20} /><p>主页已于 {dateTime(profile.takenDownAt)} 被撤下：{profile.takedownReason}。修改后可重新发布。</p></div>}
      {draft && <div className="mb-5 flex flex-wrap items-center gap-3 rounded-lg bg-surface p-4 text-sm"><p className="flex-1">发现未保存的草稿（{dateTime(new Date(draft.at).toISOString())}）</p><Button size="sm" onClick={() => { setDraft(null); try { localStorage.removeItem(draftKey); } catch {} }}>丢弃</Button><Button size="sm" variant="primary" onClick={() => { setForm({ ...pickProfileInput(draft.form), studentId: profile.email.split('@')[0] }); setDraft(null); }}>恢复草稿</Button></div>}
      <div className="grid gap-7 lg:grid-cols-[180px_minmax(0,1fr)] xl:grid-cols-[180px_minmax(0,1fr)_250px]">
        <nav className="sticky top-14 z-20 -mx-4 flex gap-4 overflow-auto bg-paper px-4 py-3 lg:top-20 lg:mx-0 lg:block lg:h-fit lg:space-y-2 lg:rounded-lg lg:p-0" aria-label="资料表单目录">
          {SECTIONS.map((s) => <a key={s.id} href={`#${s.id}`} className="flex shrink-0 items-center justify-between gap-2 rounded-lg px-2 py-2 text-sm text-ink-2 hover:bg-surface">{s.title}{s.keys.length > 0 && s.keys.every((k) => !missing.some((m) => m.key === k)) && <Check size={14} className="text-brand" />}</a>)}
          <p className="hidden px-2 pt-3 text-xs text-ink-3 lg:block">{missing.length ? `还有 ${missing.length} 项必填` : '必填项已完成'}</p>
        </nav>
        <fieldset disabled={saving || publishing} className="min-w-0 space-y-8 disabled:opacity-70">
          <Section index={0} desc="系统自动分配固定昵称。真实姓名和校园身份不会出现在广场上。">
            <Field label="Q1. 展示昵称" hint="昵称由系统随机分配，不可修改。">
              <div className="flex items-center gap-4"><Plate nickname={profile.nickname} className="h-24 w-20 shrink-0 rounded" /><Nickname name={profile.nickname} size={24} /></div>
            </Field>
            <Field id="f-realName" label="Q2. 真实姓名" required privateNote="仅管理员可见" error={error('realName')}><Input aria-label="真实姓名" value={form.realName} onChange={(e) => set('realName', e.target.value)} maxLength={30} placeholder="请输入真实姓名" /></Field>
            <p className="text-sm text-ink-3">学号已从登录邮箱自动获取：{profile.email.split('@')[0]}，无需填写。</p>
            <Field label="联系方式" optional hint="仅在申请联系并被接受后，双方才可查看彼此填写的联系方式。">
              <div className="grid gap-3 sm:grid-cols-2"><Input aria-label="微信号" placeholder="微信号" value={form.contacts.wechat} maxLength={40} onChange={(e) => set('contacts', { ...form.contacts, wechat: e.target.value })} /><Input aria-label="QQ号" placeholder="QQ 号" inputMode="numeric" maxLength={20} value={form.contacts.qq} onChange={(e) => set('contacts', { ...form.contacts, qq: e.target.value })} /></div>
              {(profile.contacts.phone || profile.contacts.other) && <div className="mt-3 space-y-3"><p className="text-xs text-ink-3">原有补充联系方式，可在这里修改或清除。</p><Input aria-label="原有手机号" placeholder="手机号（选填）" value={form.contacts.phone} maxLength={20} onChange={(e) => set('contacts', { ...form.contacts, phone: e.target.value })} /><Input aria-label="原有其他联系方式" placeholder="其他联系方式（选填）" value={form.contacts.other} maxLength={60} onChange={(e) => set('contacts', { ...form.contacts, other: e.target.value })} /></div>}
              <div className="mt-4"><Toggle checked={form.contacts.showEmail} onChange={(v) => set('contacts', { ...form.contacts, showEmail: v })} label="双方确认后也交换校园邮箱（将同时暴露学号）" /></div>
            </Field>
          </Section>
          <Section index={1} desc="以下信息均为选填，用来帮助同学了解你。">
            <Field label="Q3. 性别" optional><ChipGroup options={GENDERS} value={form.gender ? [form.gender] : []} onChange={(v) => set('gender', v[0] ?? '')} /></Field>
            <Field label="Q4. 年级" optional><ChipGroup options={GRADES} value={form.grade ? [form.grade] : []} onChange={(v) => set('grade', v[0] ?? '')} /></Field>
            <Field label="Q5. 专业 / 院系" optional><Input aria-label="专业或院系" value={form.major} onChange={(e) => set('major', e.target.value)} maxLength={60} placeholder="如：计算机科学与技术 / 计算机系" /></Field>
          </Section>
          <Section index={2} desc="写下近期想完成的事，让有共同目标的同学更容易找到你。">
            <Field label="照片 · 展示生活" optional hint="最多 4 张。照片默认仅自己可见，公开展示须在模块 F 中主动选择。"><PhotoUploader value={form.photos} onChange={(v) => set('photos', v)} /></Field>
            <Field id="f-planTags" label="Q6. 近期学习目标" required hint="可多选" error={error('planTags')}><ChipGroup options={PLAN_PRESETS.map((p) => ({ value: p, label: p }))} value={form.planTags} onChange={(v) => set('planTags', v)} multi /></Field>
            {form.planTags.includes('科研/竞赛项目') && <Field label="科研 / 备赛内容" optional><Textarea aria-label="科研或备赛内容" value={form.goalResearch} maxLength={200} onChange={(e) => set('goalResearch', e.target.value)} placeholder="能否具体描述你的科研 / 备赛内容，如备战大学生电子设计大赛" /></Field>}
            {form.planTags.includes('技能自学') && <Field label="自学技能内容" optional><Textarea aria-label="自学技能内容" value={form.goalSkills} maxLength={200} onChange={(e) => set('goalSkills', e.target.value)} placeholder="描述一下正在自学的技能" /></Field>}
            {form.planTags.includes('其他') && <Field label="其他学习目标" optional><Input aria-label="其他学习目标" value={form.goalOther} maxLength={200} onChange={(e) => set('goalOther', e.target.value)} /></Field>}
            <Field label="补充描述" optional hint="用一句话补充，将展示在广场卡片上。"><Textarea aria-label="目标补充描述" value={form.studyPlan} maxLength={200} onChange={(e) => set('studyPlan', e.target.value)} placeholder="如：每周练两次口语，希望找到一起坚持的伙伴" /></Field>
            <Field label="目前状态" optional><OptionCards options={STATUSES} value={[form.status]} onChange={(v) => set('status', v[0] || 'seeking')} cols={1} /></Field>
          </Section>
          <Section index={3} desc="填写你的实际安排，也可以补充希望对方的地点与时间。">
            <Field id="f-places" label="Q7. 我的学习地点" required error={error('places')}><ChipGroup options={PLACES} value={form.places} onChange={(v) => set('places', v)} multi /></Field>
            <Field label="期望对方的地点" optional hint="用于推荐中的地点契合度，也可作为手动检索条件。"><ChipGroup options={PLACES} value={form.expectedPlaces} onChange={(v) => set('expectedPlaces', v)} multi /><Input aria-label="期望对方地点补充" className="mt-3" value={form.expectedPlacesOther} maxLength={60} onChange={(e) => set('expectedPlacesOther', e.target.value)} placeholder="还可以补充具体地点" /></Field>
            <Field id="f-schedule" label="Q8. 我的空闲时间格" required error={error('schedule')}><TimeGrid value={form.schedule} onChange={(v) => set('schedule', v)} /></Field>
            <Field label="期望对方的时间" optional hint="将与你的空闲时间取交集；不选择时使用你的全部空闲时间。通宵表示当日 00–08 点。"><TimeGrid value={form.expectedSchedule} onChange={(v) => set('expectedSchedule', v)} /><p className="mt-3 text-sm text-brand-text">用于对比的时间：每周 {slotsHours(effectiveSchedule(form))} 小时</p></Field>
            <Field id="f-studyType" label="Q9. 和伙伴在一起的主要学习方式" required error={error('studyType')}><OptionCards options={STUDY_TYPES} value={form.studyType ? [form.studyType] : []} onChange={(v) => set('studyType', v[0] ?? '')} cols={1} /></Field>
            <Field label="Q10. 主要学习模式" optional><ChipGroup options={STUDY_METHODS} value={form.studyMethods} onChange={(v) => set('studyMethods', v)} multi />{form.studyMethods.includes('other') && <Input aria-label="其他学习模式" className="mt-3" maxLength={120} value={form.studyMethodsOther} onChange={(e) => set('studyMethodsOther', e.target.value)} placeholder="其他学习模式" />}</Field>
            <Field label="Q11. 学习频率" optional><ChipGroup options={FREQUENCIES} value={form.frequency ? [form.frequency] : []} onChange={(v) => set('frequency', v[0] ?? '')} /></Field>
            <Field label="单次持续学习时长" optional><ChipGroup options={DURATIONS} value={form.duration ? [form.duration] : []} onChange={(v) => set('duration', v[0] ?? '')} /></Field>
          </Section>
          <Section index={4} desc="自由描述展示给同学，也可通过高级检索查找；推荐评分依据前面的结构化答案，不猜测文字中的偏好。">
            <Field label="Q12. 你对学习搭子的期待" optional><Textarea aria-label="对学习搭子的期待" value={form.expectations} onChange={(e) => set('expectations', e.target.value)} maxLength={500} placeholder="可描述性别、年级、专业、学习方式、频率、目标、性格或学科互补等方面的期待" /></Field>
            <Field label="Q13. 自我介绍" optional hint="广场的关键词搜索只检索这一部分。"><Textarea aria-label="自我介绍" value={form.bio} onChange={(e) => set('bio', e.target.value)} maxLength={300} className="min-h-36" placeholder="介绍你的学习习惯、擅长的学科，或者其他想让搭子了解的事" /></Field>
          </Section>
          <Section index={5} desc="你可以自行决定展示范围，发布前请逐项确认隐私说明。">
            <Field label="Q14. 你的雷区" optional hint="仅在主页展示，便于他人了解，不用于自动匹配。"><ChipGroup options={DISLIKE_OPTIONS} value={form.dislikeTags} onChange={(v) => set('dislikeTags', v)} multi />{(form.dislikeTags.includes('other') || form.dislikes) && <Input aria-label="其他雷区" className="mt-3" value={form.dislikes} maxLength={120} onChange={(e) => set('dislikes', e.target.value)} placeholder="补充不希望发生的行为" />}</Field>
            <Field label="Q15. MBTI" optional hint="只在详情页补充展示，不参与推荐评分或标准检索。"><Input aria-label="MBTI" value={form.mbti} maxLength={30} onChange={(e) => set('mbti', e.target.value)} placeholder="自由填写，如 INFP" /></Field>
            <Field label="Q16. 兴趣爱好" optional><ChipGroup options={INTERESTS} value={form.interests} onChange={(v) => set('interests', v)} multi />{form.interests.includes('other') && <Input aria-label="其他兴趣爱好" className="mt-3" maxLength={120} value={form.interestsOther} onChange={(e) => set('interestsOther', e.target.value)} placeholder="其他兴趣爱好" />}</Field>
            <Field label="Q17. 照片分享意愿" optional hint="默认不公开。选择展示后，只有已登录同学可以在卡片和详情页看到照片；第一张作为封面。"><OptionCards options={[{ value: 'private', label: '不展示照片' }, { value: 'public', label: '愿意在卡片上展示照片' }]} value={[form.photoVisibility]} onChange={(v) => set('photoVisibility', v[0] === 'public' ? 'public' : 'private')} cols={1} /></Field>
            <Field id="f-privacyConsent" label="Q18. 隐私同意" required error={error('privacyConsent')}><div className="space-y-4">{CONSENTS.map((c) => <label key={c.key} className="flex cursor-pointer items-start gap-3 text-sm leading-relaxed"><input type="checkbox" className="mt-1 size-4 shrink-0 accent-brand" checked={form.privacyConsent[c.key]} onChange={(e) => set('privacyConsent', { ...form.privacyConsent, [c.key]: e.target.checked })} /><span>{c.text}</span></label>)}</div></Field>
          </Section>
        </fieldset>
        <aside className="hidden xl:block"><div className="sticky top-24 space-y-4"><p className="text-sm text-ink-3">在广场上的样子</p><ProfileCard card={liveCard} onOpen={() => {}} /><p className="text-xs leading-relaxed text-ink-3">照片按你选择的范围展示。联系方式始终需要申请并获得同意。</p></div></aside>
      </div>
      {showErrors && missing.length > 0 && <div className="mt-6 rounded-lg bg-danger-soft p-4 text-sm text-danger" role="alert">请补全：{missing.map((m) => m.label).join('、')}</div>}
      <div className="fixed inset-x-0 bottom-[calc(58px+env(safe-area-inset-bottom))] z-30 px-3 pb-2 md:bottom-5"><div className="glass mx-auto flex max-w-[720px] items-center gap-3 rounded-xl border border-line p-3 shadow-lg"><p className="hidden flex-1 text-sm text-ink-3 sm:block" aria-live="polite">{dirty ? '有未保存的修改' : profile.savedAt ? `已保存 ${dateTime(profile.savedAt)}` : '尚未保存'}</p><Button id="save-profile" variant="secondary" onClick={save} loading={saving} disabled={publishing} className="flex-1 sm:flex-none">{profile.published ? '保存修改' : '保存草稿'}</Button><Button variant="primary" onClick={preparePublish} disabled={saving || publishing} className="flex-1 sm:flex-none">{profile.published ? '保存并重新匹配' : '提交问卷并匹配'}</Button></div></div>
      <ConfirmDialog open={confirm} onCancel={() => setConfirm(false)} title={profile.published ? '保存问卷并重新匹配？' : '提交问卷并开启匹配？'} desc="提交后将保存问卷并在广场展示公开资料，为你推荐有共同学习时间的同学。照片按分享意愿展示，联系方式只在联系申请被接受后交换。" confirmText="确认并查看推荐" onConfirm={publish} loading={publishing} />
    </div>
  );
}

function Section({ index, desc, children }: { index: number; desc: string; children: ReactNode }) {
  return <section id={SECTIONS[index].id} className="scroll-mt-32"><h2 className="font-display text-2xl text-ink">{SECTIONS[index].title}</h2><p className="mt-2 mb-4 text-sm leading-relaxed text-ink-3">{desc}</p><div className="space-y-7 rounded-xl border border-line bg-surface p-5 sm:p-6">{children}</div></section>;
}
