import { PendingReviewNotice } from '../components/ReviewStatus';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useBlocker, useLocation, useNavigate, useSearchParams } from 'react-router';
import { ArrowLeft, ArrowRight, Check, ChevronDown, CloudCheck, Info, ShieldAlert } from 'lucide-react';
import {
  BUDDY_GENDERS, GENDERS, GRADES, STUDY_TYPES, PLACES, PLAN_PRESETS, STUDY_METHODS, FREQUENCIES, DURATIONS, INTERESTS, DISLIKE_OPTIONS,
  PERSONALITY_ITEMS, STATUSES, STUDY_FORMATS, SUBJECT_LIMIT, SEMESTER_COURSE_LIMIT, MBTIS, slotsHours,
} from '../../shared/options';
import { effectiveSchedule, missingFields, pickProfileInput } from '../../shared/profileRules';
import { invalidSelectedSubjects, invalidSelectedSemesterCourses } from '../../shared/courseCatalog';
import { canonicalMajor } from '../../shared/majors';
import { beijingToday, goalDateError, goalDateInput, goalDateToIso } from '../../shared/goalDate';
import type { ProfileInput, PrivacyConsent, QuestionnaireSection, StudyFormat } from '../../shared/types';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useQuestionnaireDraft } from '../lib/useQuestionnaireDraft';
import { dateTime } from '../lib/format';
import { useToast } from '../lib/toast';
import { Button, ChipGroup, ConfirmDialog, Field, Input, PageHeader, Skeleton, Tag, Textarea, Toggle } from '../components/ui';
import { PhotoUploader, OptionCards, PersonalityScales, SubjectsInput, MajorSelect } from '../components/profileForm';
import { ChoiceAnswer } from '../components/ChoiceAnswer';
import { TimetableEditor } from '../components/TimetableEditor';
import { TimeGrid } from '../components/TimeGrid';
import { Nickname, ProfileCard } from '../components/ProfileCard';
import { Illustration, Plate } from '../components/brand';

const SECTIONS: { id: QuestionnaireSection; title: string; keys: (keyof ProfileInput)[] }[] = [
  { id: 'identity', title: 'A · 身份与展示', keys: ['realName'] },
  { id: 'demographics', title: 'B · 基础画像', keys: ['gender', 'grade'] },
  { id: 'goals', title: 'C · 状态与目标', keys: ['planTags'] },
  { id: 'study', title: 'D · 时间、地点与方式', keys: ['places', 'schedule', 'studyType'] },
  { id: 'personality', title: 'E · 学习性格', keys: [] },
  { id: 'expectations', title: 'F · 学科与期待', keys: [] },
  { id: 'privacy', title: 'G · 补充与隐私', keys: ['privacyConsent'] },
];
const MBTI_PATTERN = /^[EI][SN][TF][JP](?:-[AT])?$/;
const isMbti = (value: string) => MBTI_PATTERN.test(value.normalize('NFKC').trim().toUpperCase());
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
  const { hash } = useLocation();
  const [params] = useSearchParams();
  const onboarding = params.get('onboarding') === '1' || !user?.questionnaireComplete;
  const draft = useQuestionnaireDraft(user?.id);
  const { form, profile, section, loading, loadError, setField: set } = draft;
  const [publishing, setPublishing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [timetableDirty, setTimetableDirty] = useState(false);
  const leaveBlocker = useBlocker(({ currentLocation, nextLocation }) => timetableDirty && currentLocation.pathname !== nextLocation.pathname);
  const [showErrors, setShowErrors] = useState(false);
  const [focusTarget, setFocusTarget] = useState('');
  // 选填的大块内容默认收起，必填题之间不再隔着几屏选填项；填过的、或用户点开过的保持展开
  const [opened, setOpened] = useState<Record<'timetable' | 'expectedPlaces' | 'expectedSchedule', boolean>>({ timetable: false, expectedPlaces: false, expectedSchedule: false });
  const open = (key: keyof typeof opened) => setOpened((current) => ({ ...current, [key]: true }));
  const ownHash = useRef<string | null>(null);
  const missing = useMemo(() => missingFields(form), [form]);
  const invalidSubjects = useMemo(() => invalidSelectedSubjects(form.subjects), [form.subjects]);
  const invalidSemesterCourses = useMemo(() => invalidSelectedSemesterCourses(form.semesterCourses), [form.semesterCourses]);
  // 已发布的资料：草稿里的修改要提交后才会生效，保存提示里说清楚
  const unpublishedChanges = useMemo(
    () => !!profile?.published && JSON.stringify(pickProfileInput(profile)) !== JSON.stringify(pickProfileInput(form)),
    [profile, form],
  );
  const subjectsOverLimit = form.subjects.length > SUBJECT_LIMIT;
  const semesterCoursesOverLimit = form.semesterCourses.length > SEMESTER_COURSE_LIMIT;
  const invalidMajor = canonicalMajor(form.major) === null;
  const courseAnswersInvalid = !!invalidSubjects.length || !!invalidSemesterCourses.length || subjectsOverLimit || semesterCoursesOverLimit || invalidMajor;
  const earliestGoalDate = beijingToday();
  const deadlineError = goalDateError(form.goalDeadline, earliestGoalDate);
  const step = SECTIONS.findIndex((s) => s.id === section);
  const reviewing = section === 'review';
  const error = (key: keyof ProfileInput) => showErrors && missing.some((m) => m.key === key) ? '请完成此项' : undefined;
  const go = (next: QuestionnaireSection, field?: string) => {
    if (publishing || uploading) return;
    if (timetableDirty) { toast.error('请先保存或撤销课表修改', '课表单独保存，保存后即可继续问卷。'); return; }
    draft.setSection(next);
    setFocusTarget(field || next);
    ownHash.current = hash !== `#${next}` ? `#${next}` : null;
    nav({ pathname: '/me/edit', search: params.toString() ? `?${params}` : '', hash: `#${next}` }, { replace: true });
  };
  // Existing links such as /me/edit#personality must open the corresponding part.
  useEffect(() => {
    if (loading || !hash) return;
    if (ownHash.current === hash) { ownHash.current = null; return; }
    const id = hash.slice(1);
    if (id === 'review' || SECTIONS.some((s) => s.id === id)) {
      if (id !== section && (timetableDirty || publishing || uploading)) {
        if (timetableDirty) toast.error('请先保存或撤销课表修改', '课表单独保存，保存后即可继续问卷。');
        ownHash.current = `#${section}`;
        nav({ pathname: '/me/edit', search: params.toString() ? `?${params}` : '', hash: `#${section}` }, { replace: true });
        return;
      }
      if (id !== section) draft.setSection(id as QuestionnaireSection);
      setFocusTarget((current) => current || id);
    }
  }, [loading, hash]);
  useEffect(() => {
    if (!focusTarget || loading) return;
    const target = document.getElementById(focusTarget);
    if (!target) return;
    const frame = requestAnimationFrame(() => {
      target.scrollIntoView({ block: 'start', behavior: 'smooth' });
      const control = target.querySelector<HTMLElement>('input, button, textarea');
      (control ?? target).focus({ preventScroll: true });
      setFocusTarget('');
    });
    return () => cancelAnimationFrame(frame);
  }, [section, focusTarget, loading]);
  const checkAnswers = () => { setShowErrors(true); go('review'); };
  const publish = async () => {
    if (publishing || uploading || timetableDirty || missing.length || courseAnswersInvalid) return;
    if (goalDateError(form.goalDeadline)) { setShowErrors(true); go('review'); return; }
    setPublishing(true);
    await draft.pause();
    try {
      const { profile: p, missing: required } = await api.saveProfile({ ...form, goalDeadline: goalDateToIso(form.goalDeadline)! });
      if (required.length) {
        draft.resume(); draft.setForm(pickProfileInput(p));
        setShowErrors(true); go('review');
        toast.error('请补全问卷', required.map((item) => item.label).join('、'));
        return;
      }
      const result = await api.publish();
      draft.complete();
      await refresh();
      toast.success(result.reviewPending ? '已提交，等待审核' : '已发布');
      if (result.reviewPending) nav('/me');
      else nav('/match', { state: { justMatched: true } });
    } catch (e) {
      draft.resume();
      toast.error('提交失败，草稿已保留', e instanceof Error ? e.message : undefined);
    } finally { setPublishing(false); }
  };
  if (loading) return <div className="space-y-6 py-10"><Skeleton className="h-14 w-64" /><Skeleton className="h-96 w-full" /></div>;
  if (!profile || loadError) return <div className="py-16"><p role="alert">{loadError || '无法加载资料'}</p><Button onClick={draft.reload} className="mt-4">重新加载</Button></div>;
  const liveCard = {
    id: profile.userId, nickname: profile.nickname, major: form.major, gender: form.genderVisibility === 'private' ? '' : form.gender, grade: form.grade,
    studyType: form.studyType, modes: [], status: form.status,
    cover: form.photoVisibility === 'public' ? form.photos[0] ?? null : null,
    mbti: '', isMe: true, overlapHours: 0, publishedAt: null, studyPlan: form.studyPlan, planTags: form.planTags, subjects: form.subjects,
  };
  const answered = PERSONALITY_ITEMS.filter((item) => form.personality[item.key] > 0).length;
  const progress: Record<string, string> = { personality: `${answered}/${PERSONALITY_ITEMS.length}` };
  const missingQuestions = missing.flatMap((m) => {
    if (m.key === 'privacyConsent') {
      const unchecked = CONSENTS.filter((c) => !form.privacyConsent[c.key]);
      return [{ section: SECTIONS[6], target: `consent-${unchecked[0]?.key ?? CONSENTS[0].key}`, label: 'Q23. 隐私同意', detail: `还有 ${unchecked.length} 项没有勾选，四项都确认后才能提交` }];
    }
    const owner = SECTIONS.find((s) => s.keys.includes(m.key))!;
    const number = ({ realName: 2, gender: 3, grade: 4, planTags: 6, places: 9, schedule: 11, studyType: 12 } as Record<string, number>)[m.key];
    return [{ section: owner, target: `f-${m.key}`, label: `Q${number}. ${m.label}`, detail: '尚未填写，点击补全' }];
  });
  if (invalidSubjects.length) missingQuestions.push({ section: SECTIONS[2], target: 'f-subjects', label: 'Q7. 具体科目 / 课程 / 考试', detail: `请从标准目录重新选择或移除：${invalidSubjects.join('、')}` });
  if (subjectsOverLimit) missingQuestions.push({ section: SECTIONS[2], target: 'f-subjects', label: 'Q7. 具体科目 / 课程 / 考试', detail: `最多选择 ${SUBJECT_LIMIT} 项，请保留最想一起学习的重点。目前已选 ${form.subjects.length} 项。` });
  if (invalidSemesterCourses.length) missingQuestions.push({ section: SECTIONS[2], target: 'f-semesterCourses', label: '本学期课表课程', detail: `请从课程目录重新选择或移除：${invalidSemesterCourses.join('、')}` });
  if (semesterCoursesOverLimit) missingQuestions.push({ section: SECTIONS[2], target: 'f-semesterCourses', label: '本学期课表课程', detail: `最多选择 ${SEMESTER_COURSE_LIMIT} 门课程。` });
  if (deadlineError) missingQuestions.push({ section: SECTIONS[2], target: 'f-goalDeadline', label: 'Q8. 目标日期', detail: deadlineError });
  if (invalidMajor) missingQuestions.push({ section: SECTIONS[1], target: 'f-major', label: 'Q5. 专业 / 院系', detail: '原有专业文字已保留，请从目录重新选择或清空这一选填项。' });
  const saveText = { idle: '填写时会自动保存草稿', saving: '正在自动保存…', saved: unpublishedChanges ? profile.reviewPending ? '修改已存为草稿；提交后会重新检查待审主页' : profile.takenDown ? '修改已存为草稿；恢复展示需由管理员处理' : '修改已存为草稿；提交后才会更新已发布的主页' : '草稿已自动保存', local: '已保存在此设备，联网后自动同步', error: '草稿暂未保存，请检查网络并重试' }[draft.saveState];
  return (
    <div className="pb-16">
      <ConfirmDialog
        open={leaveBlocker.state === 'blocked'}
        title="课表还有未保存的修改"
        desc="离开会放弃本次课表修改和待确认的导入内容。已经保存的课表和问卷草稿会保留。"
        cancelText="继续编辑"
        confirmText="放弃修改并离开"
        tone="danger"
        onCancel={() => { if (leaveBlocker.state === 'blocked') leaveBlocker.reset(); }}
        onConfirm={() => { if (leaveBlocker.state === 'blocked') leaveBlocker.proceed(); }}
      />
      <PageHeader title={onboarding ? '填写你的搭子问卷' : '我的搭子问卷'} desc="分 7 个部分，慢慢认识你。草稿会自动保存，带 * 的项目为必填，其余可以跳过。" actions={<Tag tone={profile.takenDown ? 'danger' : profile.published && !profile.reviewPending ? 'brand' : undefined}>{profile.reviewPending ? '主页等待审核' : profile.takenDown ? '主页已撤下' : profile.published ? '主页已发布' : '尚未发布'}</Tag>} />
      {onboarding && <ol aria-label="开始匹配的步骤" className="mb-6 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl border border-line bg-surface px-5 py-4 text-sm"><li className="flex items-center gap-2 text-brand-text"><Check size={16} />账号已激活</li><li aria-current="step" className="font-semibold text-ink">2 · 填写问卷</li><li className="text-ink-3">3 · 查看搭子推荐</li></ol>}
      {profile.reviewPending ? <PendingReviewNotice /> : profile.takenDown && <div className="mb-5 flex gap-3 rounded-lg bg-danger-soft p-4 text-sm"><ShieldAlert className="shrink-0 text-danger" size={20} /><p>主页已于 {dateTime(profile.takenDownAt)} 被撤下：{profile.takedownReason}。可修改内容，恢复展示需由管理员处理。</p></div>}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-2 text-[13px] text-ink-3">
        <p className="flex items-center gap-2" role="status"><CloudCheck size={16} aria-hidden />{saveText}</p>
        {draft.restored && <span>已接着上次的进度填写</span>}
        {(draft.saveState === 'local' || draft.saveState === 'error') && <Button size="sm" variant="ghost" onClick={draft.resume}>重试同步</Button>}
      </div>
      <div className="grid items-start gap-7 lg:grid-cols-[180px_minmax(0,1fr)] xl:grid-cols-[180px_minmax(0,1fr)_250px]">
        <nav className="flex gap-1 overflow-auto rounded-lg border border-line bg-surface p-2 lg:sticky lg:top-24 lg:block lg:space-y-1" aria-label="问卷部分">
          {SECTIONS.map((s, index) => {
            const done = s.keys.length > 0 && s.keys.every((k) => !missing.some((m) => m.key === k)) && (s.id !== 'goals' || (!deadlineError && !courseAnswersInvalid));
            return (
              <button type="button" key={s.id} disabled={publishing || uploading} onClick={() => go(s.id)} aria-current={section === s.id ? 'step' : undefined} className={`flex shrink-0 items-center justify-between gap-2 rounded-md px-3 py-2.5 text-left text-sm lg:w-full ${section === s.id ? 'bg-brand-softer font-semibold text-brand-text' : 'text-ink-2 hover:bg-paper'}`}>
                <span><span className="lg:hidden">{'ABCDEFG'[index]}</span><span className="hidden lg:inline">{s.title}</span></span>
                {done && <Check size={14} className="text-brand" aria-label="必填项已完成" />}
                {progress[s.id] && <span className="hidden text-xs text-ink-3 tabular lg:inline" aria-label={`已回答 ${progress[s.id]}`}>{progress[s.id]}</span>}
              </button>
            );
          })}
          {(reviewing || showErrors) && <button type="button" disabled={publishing || uploading} onClick={checkAnswers} aria-current={reviewing ? 'step' : undefined} className={`shrink-0 rounded-md px-3 py-2.5 text-left text-sm lg:w-full ${reviewing ? 'bg-brand-softer font-semibold text-brand-text' : 'text-ink-2 hover:bg-paper'}`}>完成检查</button>}
        </nav>
        <div className="min-w-0">
          {!reviewing && <div className="mb-5 flex items-center gap-4"><span className="shrink-0 text-xs text-ink-3">第 {step + 1} / 7 部分</span><div className="h-1 flex-1 overflow-hidden rounded-full bg-line" role="progressbar" aria-label="问卷填写进度" aria-valuemin={1} aria-valuemax={7} aria-valuenow={step + 1}><div className="h-full rounded-full bg-brand transition-all" style={{ width: `${(step + 1) / 7 * 100}%` }} /></div></div>}
        <fieldset disabled={publishing} className="min-w-0 space-y-8 disabled:opacity-70">
          <Section active={step === 0} index={0} desc="系统自动分配固定昵称。真实姓名和校园身份不会公开展示。">
            <Field label="Q1. 展示昵称" hint="昵称由系统随机分配，不可修改。">
              <div className="flex items-center gap-4"><Plate nickname={profile.nickname} className="h-24 w-20 shrink-0 rounded" /><Nickname name={profile.nickname} size={24} /></div>
            </Field>
            <Field id="f-realName" label="Q2. 真实姓名" required privateNote="仅管理员可见" error={error('realName')}><Input aria-label="真实姓名" value={form.realName} onChange={(e) => set('realName', e.target.value)} maxLength={30} placeholder="请输入真实姓名" /></Field>
            <p className="text-sm text-ink-3">学号已从登录邮箱自动获取：{profile.email.split('@')[0]}，无需填写。</p>
            <Field label="联系方式" optional hint="互相感兴趣后，可在私聊中申请交换；双方都同意后，才能看到彼此填写的联系方式。">
              <div className="grid gap-3 sm:grid-cols-2"><Input aria-label="微信号" placeholder="微信号" value={form.contacts.wechat} maxLength={40} onChange={(e) => set('contacts', { ...form.contacts, wechat: e.target.value })} /><Input aria-label="QQ号" placeholder="QQ 号" inputMode="numeric" maxLength={20} value={form.contacts.qq} onChange={(e) => set('contacts', { ...form.contacts, qq: e.target.value })} /></div>
              {(profile.contacts.phone || profile.contacts.other) && <div className="mt-3 space-y-3"><p className="text-xs text-ink-3">原有补充联系方式，可在这里修改或清除。</p><Input aria-label="原有手机号" placeholder="手机号（选填）" value={form.contacts.phone} maxLength={20} onChange={(e) => set('contacts', { ...form.contacts, phone: e.target.value })} /><Input aria-label="原有其他联系方式" placeholder="其他联系方式（选填）" value={form.contacts.other} maxLength={60} onChange={(e) => set('contacts', { ...form.contacts, other: e.target.value })} /></div>}
              <div className="mt-4"><Toggle checked={form.contacts.showEmail} onChange={(v) => set('contacts', { ...form.contacts, showEmail: v })} label="双方确认后也交换校园邮箱（将同时暴露学号）" /></div>
            </Field>
          </Section>
          <Section active={step === 1} index={1} desc="性别和年级为必填，专业 / 院系可选填。你可以自行决定是否展示性别。">
            <Field id="f-gender" label="Q3. 性别" required error={error('gender')}>
              <ChipGroup options={GENDERS.filter((option) => option.value !== 'other')} value={form.gender ? [form.gender] : []} onChange={(v) => set('gender', v[0] ?? '')} />
              <div className="mt-4 rounded-lg bg-paper p-4"><Toggle checked={form.genderVisibility === 'public'} onChange={(show) => set('genderVisibility', show ? 'public' : 'private')} label="展示我的性别" /><p className="mt-2 text-xs leading-relaxed text-ink-3">关闭并提交问卷后，其他同学在主页和卡片上看不到你的性别；性别仍用于匹配双方的搭子偏好。</p></div>
            </Field>
            <Field id="f-grade" label="Q4. 年级" required error={error('grade')}><ChipGroup options={GRADES} value={form.grade ? [form.grade] : []} onChange={(v) => set('grade', v[0] ?? '')} /></Field>
            <Field id="f-major" label="Q5. 专业 / 院系" optional hint="搜索专业或按院系选择；尚未分专业可以选择大类培养。" error={invalidMajor ? '原有专业尚未对应目录，请重新选择或清空；草稿会保留原内容。' : undefined}><MajorSelect value={form.major} onChange={(value) => set('major', value)} invalid={invalidMajor} allowClear /></Field>
          </Section>
          <Section active={step === 2} index={2} desc="写下近期想完成的事，让有共同目标的同学更容易找到你。">
            <Field label="照片 · 展示生活" optional hint="最多 4 张。照片默认仅自己可见，公开展示须在模块 G 中主动选择。"><PhotoUploader onBusyChange={setUploading} value={form.photos} onChange={(v) => set('photos', v)} /></Field>
            <Field id="f-planTags" label="Q6. 近期学习目标" required hint="可多选，多选不会降低匹配度" error={error('planTags')}><ChipGroup options={PLAN_PRESETS.map((p) => ({ value: p, label: p }))} value={form.planTags} onChange={(v) => set('planTags', v)} multi /></Field>
            {opened.timetable || form.semesterCourses.length > 0 ? (
              <Field id="f-semesterCourses" label="本学期课表课程" optional hint="选择这学期正在上的课程，理论课与实验课按同一门课选择。课表仅自己可见，你可以在下方 Q7 中挑选最想一起学的重点。">
                <SubjectsInput id="semester-courses-input" coursesOnly max={SEMESTER_COURSE_LIMIT} value={form.semesterCourses} onChange={(v) => set('semesterCourses', v)} />
              </Field>
            ) : (
              <Collapsed id="f-semesterCourses" label="本学期课表课程" summary="选填 · 先存下这学期的课，方便在 Q7 里从中挑重点；课表只有自己能看到" action="添加课表" onOpen={() => open('timetable')} />
            )}
            <Field id="f-subjects" label="Q7. 具体科目 / 课程 / 考试" optional hint={`最多选择 ${SUBJECT_LIMIT} 项最想和搭子一起学习的重点。可以从课表中选，也可以搜索其他课程或考试；这些选择会用于匹配。`} error={subjectsOverLimit ? `请删选至最多 ${SUBJECT_LIMIT} 项` : undefined}>
              {form.semesterCourses.length > 0 && <div className="mb-4 rounded-xl border border-line bg-paper/50 p-3.5"><p className="mb-2.5 text-[13px] font-semibold text-ink-2">从我的课表中选</p><div className="flex flex-wrap gap-2" role="group" aria-label="从课表选择重点科目">{form.semesterCourses.filter((course) => !invalidSemesterCourses.includes(course)).map((course) => {
                const chosen = form.subjects.includes(course);
                return <button key={course} type="button" aria-pressed={chosen} aria-label={`${chosen ? '取消重点' : '设为重点'} ${course}`} disabled={!chosen && form.subjects.length >= SUBJECT_LIMIT} onClick={() => set('subjects', chosen ? form.subjects.filter((subject) => subject !== course) : [...form.subjects, course])} className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-left text-[13px] transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${chosen ? 'border-brand/45 bg-brand-softer text-brand-text' : 'border-line bg-surface text-ink-2 hover:border-brand/45'}`}>{chosen && <Check size={13} aria-hidden className="shrink-0" />}{course}</button>;
              })}</div></div>}
              <SubjectsInput id="subjects-input" value={form.subjects} onChange={(v) => set('subjects', v)} />
            </Field>
            <Field id="f-goalDeadline" label="Q8. 目标日期" optional error={deadlineError} hint="考试或截止的日期，8 位数字，如 20261231。和学同一门课的同学日期相近时，推荐会略微加分。">
              <div className="flex items-center gap-2">
                <Input type="text" inputMode="numeric" pattern="[0-9]{8}" maxLength={8} placeholder="20261231" aria-label="目标日期" value={goalDateInput(form.goalDeadline)} invalid={!!deadlineError} onChange={(e) => set('goalDeadline', goalDateInput(e.target.value))} className="max-w-56 tabular" />
                {form.goalDeadline && <Button size="sm" variant="ghost" onClick={() => set('goalDeadline', '')}>清除</Button>}
              </div>
            </Field>
            {form.planTags.includes('科研/竞赛项目') && <Field label="科研 / 备赛内容" optional hint="可多选，也可补充具体项目。"><ChoiceAnswer label="科研或备赛内容" options={['数学建模', '程序设计竞赛', '电子设计竞赛', '实验室科研', '论文阅读', '创新创业项目']} value={form.goalResearch} maxLength={200} onChange={(value) => set('goalResearch', value)} /></Field>}
            {form.planTags.includes('技能自学') && <Field label="自学技能内容" optional hint="可多选，也可补充学习进度。"><ChoiceAnswer label="自学技能内容" options={['Python', 'Java', 'C / C++', '数据分析', '机器学习', '网页开发', '英语口语', '设计与剪辑']} value={form.goalSkills} maxLength={200} onChange={(value) => set('goalSkills', value)} /></Field>}
            {form.planTags.includes('其他') && <Field label="其他学习目标" optional><Input aria-label="其他学习目标" value={form.goalOther} maxLength={200} onChange={(e) => set('goalOther', e.target.value)} /></Field>}
            <Field label="补充描述" optional hint="用一句话补充，将展示在推荐卡片上。"><Textarea aria-label="目标补充描述" value={form.studyPlan} maxLength={200} onChange={(e) => set('studyPlan', e.target.value)} placeholder="如：每周练两次口语，希望找到一起坚持的伙伴" /></Field>
            <Field label="目前状态" optional><OptionCards options={STATUSES} value={[form.status]} onChange={(v) => set('status', v[0] || 'seeking')} cols={1} /></Field>
          </Section>
          <div hidden={step !== 2} className="mt-6 rounded-xl border border-line bg-surface p-5 sm:p-6">
            <TimetableEditor semesterCourses={form.semesterCourses} onCoursesChange={(courses) => set('semesterCourses', courses)} schedule={form.schedule} onScheduleChange={(slots) => set('schedule', slots)} onDirtyChange={setTimetableDirty} />
          </div>
          <Section active={step === 3} index={3} desc="填写你的实际安排，也可以补充希望对方的地点与时间。">
            <Field id="f-places" label="Q9. 我的学习地点" required error={error('places')}><ChipGroup options={PLACES} value={form.places} onChange={(v) => set('places', v)} multi /></Field>
            {opened.expectedPlaces || form.expectedPlaces.length > 0 || !!form.expectedPlacesOther ? (
              <Field label="期望对方的地点" optional hint="用于推荐中的地点契合度，也可作为手动检索条件。不选时按你自己的学习地点来比。"><ChipGroup options={PLACES} value={form.expectedPlaces} onChange={(v) => set('expectedPlaces', v)} multi /><Input aria-label="期望对方地点补充" className="mt-3" value={form.expectedPlacesOther} maxLength={60} onChange={(e) => set('expectedPlacesOther', e.target.value)} placeholder="还可以补充具体地点" /></Field>
            ) : (
              <Collapsed label="期望对方的地点" summary="选填 · 现在按你自己的学习地点来比" action="单独设置" onOpen={() => open('expectedPlaces')} />
            )}
            <Field id="f-studyFormat" label="Q10. 学习形式" optional hint="硬性条件：只线下与只线上的同学不会互相推荐；选「都可以」或不填时，两种同学都可能推荐给你。">
              <OptionCards options={STUDY_FORMATS} value={form.studyFormat ? [form.studyFormat] : []} onChange={(v) => set('studyFormat', (v[0] ?? '') as StudyFormat)} />
            </Field>
            <Field id="f-schedule" label="Q11. 我的空闲时间格" required error={error('schedule')}><TimeGrid value={form.schedule} onChange={(v) => set('schedule', v)} /></Field>
            {opened.expectedSchedule || form.expectedSchedule.length > 0 ? (
              <Field label="期望对方的时间" optional hint="将与你的空闲时间取交集；不选择时使用你的全部空闲时间。通宵表示当日 00–08 点。"><TimeGrid value={form.expectedSchedule} onChange={(v) => set('expectedSchedule', v)} /><p className="mt-3 text-sm text-brand-text">用于对比的时间：每周 {slotsHours(effectiveSchedule(form))} 小时</p></Field>
            ) : (
              <Collapsed label="期望对方的时间" summary={`选填 · 现在按你的全部空闲时间来比（每周 ${slotsHours(effectiveSchedule(form))} 小时）`} action="单独设置" onOpen={() => open('expectedSchedule')} />
            )}
            <Field id="f-studyType" label="Q12. 和伙伴在一起的主要学习方式" required error={error('studyType')}><OptionCards options={STUDY_TYPES} value={form.studyType ? [form.studyType] : []} onChange={(v) => set('studyType', v[0] ?? '')} cols={1} /></Field>
            <Field label="Q13. 主要学习模式" optional><ChipGroup options={STUDY_METHODS} value={form.studyMethods} onChange={(v) => set('studyMethods', v)} multi />{form.studyMethods.includes('other') && <Input aria-label="其他学习模式" className="mt-3" maxLength={120} value={form.studyMethodsOther} onChange={(e) => set('studyMethodsOther', e.target.value)} placeholder="其他学习模式" />}</Field>
            <Field label="Q14. 学习频率" optional hint="学习频率 × 单次时长 = 你每周想一起学习的时间，用来判断共同时间够不够用。"><ChipGroup options={FREQUENCIES} value={form.frequency ? [form.frequency] : []} onChange={(v) => set('frequency', v[0] ?? '')} /></Field>
            <Field label="单次持续学习时长" optional><ChipGroup options={DURATIONS} value={form.duration ? [form.duration] : []} onChange={(v) => set('duration', v[0] ?? '')} /></Field>
            <Field id="f-buddyGender" label="Q15. 希望搭子的性别" optional hint="硬性条件，双向生效：选择「男」或「女」后，只会推荐该性别的同学；对搭子性别有要求的同学，也只会在你符合时看到你。不想限制请选「皆可」。">
              <ChipGroup options={BUDDY_GENDERS} value={[form.buddyGender || 'any']} onChange={(v) => set('buddyGender', v[0] ?? 'any')} />
              {!form.gender && <p className="mt-2.5 flex gap-1.5 text-[13px] leading-relaxed text-ink-2"><Info size={14} className="mt-0.5 shrink-0 text-ink-3" aria-hidden />你还没有填写自己的性别（模块 B），对搭子性别有要求的同学不会看到你。</p>}
            </Field>
          </Section>
          <Section active={step === 4} index={4} desc="7 道小题，每题 1–5 分，用来找学习习惯合得来的搭子。会参与推荐评分：相似的题越接近越合拍，「被督促 / 督促」看双方能否互补。拿不准的题可以先跳过。">
            <Field id="f-personality" label="Q16. 学习性格" optional><PersonalityScales value={form.personality} onChange={(v) => set('personality', v)} /></Field>
            <Field label="Q17. MBTI" optional hint="不了解自己的类型可以选不清楚；这一项在学习性格中的权重很小。"><ChipGroup options={[{ value: '', label: '不清楚 / 不填写' }, ...MBTIS.map((value) => ({ value, label: value }))]} value={[isMbti(form.mbti) ? form.mbti.trim().toUpperCase().slice(0, 4) : '']} onChange={(values) => set('mbti', values[0] ?? '')} />{form.mbti && !isMbti(form.mbti) && <p className="mt-2 text-xs text-ink-3">旧答案「{form.mbti}」已保留；重新选择后更新。</p>}</Field>
            <Field label="Q18. 你的雷区" optional hint="「迟到爽约」「全程沉默」「过度社交」会用于匹配：可能触及雷区的同学会排得靠后，推荐时也会提醒你。其他选项只在主页展示。"><ChipGroup options={DISLIKE_OPTIONS} value={form.dislikeTags} onChange={(v) => set('dislikeTags', v)} multi />{(form.dislikeTags.includes('other') || form.dislikes) && <Input aria-label="其他雷区" className="mt-3" value={form.dislikes} maxLength={120} onChange={(e) => set('dislikes', e.target.value)} placeholder="补充不希望发生的行为" />}</Field>
          </Section>
          <Section active={step === 5} index={5} desc="自由描述展示给同学，也可通过高级检索查找；推荐评分依据前面的结构化答案，不猜测文字中的偏好。">
            <Field label="Q19. 你对学习搭子的期待" optional hint="可多选并补充；性别、时间和学习频率沿用前面的设置。这些描述用于展示与检索。"><ChoiceAnswer label="对学习搭子的期待" options={['一起梳理知识点', '互相讲解难题', '交流学习资料', '共同完成项目', '分享学习方法', '及时沟通安排']} value={form.expectations} onChange={(value) => set('expectations', value)} maxLength={500} /></Field>
            <Field label="Q20. 自我介绍" optional hint="「找同学」中的自我介绍关键词会检索这一部分。"><Textarea aria-label="自我介绍" value={form.bio} onChange={(e) => set('bio', e.target.value)} maxLength={300} className="min-h-36" placeholder="介绍你的学习习惯、擅长的学科，或者其他想让搭子了解的事" /></Field>
          </Section>
          <Section active={step === 6} index={6} desc="你可以自行决定展示范围，发布前请逐项确认隐私说明。">
            <Field label="Q21. 兴趣爱好" optional hint="有共同兴趣会略微加分。"><ChipGroup options={INTERESTS} value={form.interests} onChange={(v) => set('interests', v)} multi />{form.interests.includes('other') && <Input aria-label="其他兴趣爱好" className="mt-3" maxLength={120} value={form.interestsOther} onChange={(e) => set('interestsOther', e.target.value)} placeholder="其他兴趣爱好" />}</Field>
            <Field label="Q22. 照片分享意愿" optional hint="默认不公开。选择展示后，只有已登录同学可以在卡片和详情页看到照片；第一张作为封面。"><OptionCards options={[{ value: 'private', label: '不展示照片' }, { value: 'public', label: '愿意在卡片上展示照片' }]} value={[form.photoVisibility]} onChange={(v) => set('photoVisibility', v[0] === 'public' ? 'public' : 'private')} cols={1} /></Field>
            <Field id="f-privacyConsent" label="Q23. 隐私同意" required error={error('privacyConsent')}><div className="space-y-4">{CONSENTS.map((c) => <label id={`consent-${c.key}`} key={c.key} className="flex cursor-pointer items-start gap-3 text-sm leading-relaxed"><input type="checkbox" className="mt-1 size-4 shrink-0 accent-brand" checked={form.privacyConsent[c.key]} onChange={(e) => set('privacyConsent', { ...form.privacyConsent, [c.key]: e.target.checked })} /><span>{c.text}</span></label>)}</div></Field>
          </Section>
        </fieldset>
          {reviewing ? (
            <section id="review" tabIndex={-1} className="scroll-mt-24 rounded-xl border border-line bg-surface p-5 outline-none sm:p-8">
              {missingQuestions.length ? <>
                <h2 className="font-display text-2xl text-ink">还差几项，就可以遇见搭子了</h2>
                <p className="mt-2 text-sm text-ink-3" role="status">还有 {missingQuestions.length} 处需要补全或修改。点击下方题目即可返回修改，选填项留空也没关系。</p>
                <ul className="mt-6 space-y-3">{missingQuestions.map((item) => <li key={item.target}><button type="button" onClick={() => go(item.section.id, item.target)} className="flex w-full items-center justify-between gap-3 rounded-lg border border-danger/20 bg-danger-soft p-4 text-left transition-colors hover:border-danger/50"><span><span className="block text-xs text-ink-3">{item.section.title}</span><span className="mt-1 block text-sm font-semibold text-ink">{item.label}</span><span className="mt-1 block text-xs text-ink-2">{item.detail}</span></span><ArrowRight size={18} className="shrink-0 text-danger" aria-hidden /></button></li>)}</ul>
              </> : <div className="text-center">
                <Illustration name="mascot-cheer" className="mx-auto mb-5 size-40" />
                <h2 className="font-display text-[28px] text-ink">{profile.published ? '修改已检查完毕' : '恭喜你完成问卷！'}</h2>
                <p className="mx-auto mt-3 max-w-sm text-sm leading-relaxed text-ink-2">{profile.reviewPending ? '提交后会重新检查这些答案；审核通过后参与匹配推荐。' : profile.takenDown ? '可以保存修改后的答案；恢复主页展示需由管理员处理。' : profile.published ? '提交后，已发布的主页和为你推荐的同学都会按新的答案更新。' : '你可以提交问卷，查看为你推荐的学习搭子。小树仁已经准备好啦。'}</p>
                <p className="mx-auto mt-5 max-w-sm text-xs leading-relaxed text-ink-3">{profile.reviewPending ? '不提交的话，修改只保存在草稿里，当前主页仍等待审核。' : profile.takenDown ? '修改内容不会自动恢复公开展示。' : profile.published ? '不提交的话，修改只保存在草稿里，别人看到的仍是原来的主页。' : '提交后将发布主页，照片按你的分享意愿展示。联系方式仅在双方确认后交换。'}</p>
                <Button variant="primary" size="lg" className="mt-6 w-full sm:w-auto" onClick={() => void publish()} loading={publishing}>{profile.published ? '提交修改' : '提交问卷并匹配'}<ArrowRight size={16} aria-hidden /></Button>
              </div>}
              <Button variant="ghost" className="mt-6" disabled={publishing || uploading} onClick={() => go('privacy')}><ArrowLeft size={16} aria-hidden />返回 G 部分</Button>
            </section>
          ) : <><p role="status" className="mt-4 text-sm text-ink-3">{uploading ? '照片正在上传，完成后即可进入下个部分。' : ''}</p><div className="mt-6 flex items-center justify-between gap-3 border-t border-line pt-5">
            <Button variant="ghost" disabled={step === 0 || publishing || uploading} onClick={() => go(SECTIONS[step - 1].id)}><ArrowLeft size={16} aria-hidden />上个部分</Button>
            <Button variant="primary" disabled={publishing || uploading} onClick={() => step === 6 ? checkAnswers() : go(SECTIONS[step + 1].id)}>{step === 6 ? '完成填写，检查问卷' : '下个部分'}<ArrowRight size={16} aria-hidden /></Button>
          </div></>}
        </div>
        <aside className="hidden xl:block"><div className="sticky top-24 space-y-4"><p className="text-sm text-ink-3">在推荐里的样子</p><ProfileCard card={liveCard} onOpen={() => {}} /><p className="text-xs leading-relaxed text-ink-3">照片按你选择的范围展示。联系方式只在互相感兴趣、双方都同意后交换。</p></div></aside>
      </div>
    </div>
  );
}

function Section({ active, index, desc, children }: { active: boolean; index: number; desc: string; children: ReactNode }) {
  if (!active) return null;
  return <section id={SECTIONS[index].id} tabIndex={-1} className="scroll-mt-24 outline-none"><h2 className="font-display text-2xl text-ink">{SECTIONS[index].title}</h2><p className="mt-2 mb-4 text-sm leading-relaxed text-ink-3">{desc}</p><div className="space-y-7 rounded-xl border border-line bg-surface p-5 sm:p-6">{children}</div></section>;
}

/** 选填的大块内容收起时的一行：说明现在按什么默认值处理，点开才出现完整的题目 */
function Collapsed({ id, label, summary, action, onOpen }: { id?: string; label: string; summary: string; action: string; onOpen: () => void }) {
  return (
    <div id={id} className="scroll-mt-24">
      <button type="button" onClick={onOpen} aria-expanded={false} className="flex w-full items-center justify-between gap-3 rounded-lg border border-line bg-paper/50 px-4 py-3 text-left transition-colors hover:border-brand/45">
        <span className="min-w-0">
          <span className="block text-[14px] font-semibold text-ink">{label}</span>
          <span className="mt-0.5 block text-[13px] leading-relaxed text-ink-3">{summary}</span>
        </span>
        <span className="inline-flex shrink-0 items-center gap-1 text-[13px] font-semibold text-brand-text">{action}<ChevronDown size={15} aria-hidden /></span>
      </button>
    </div>
  );
}
