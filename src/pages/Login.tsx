import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { ArrowLeft, Check, Eye, EyeOff, Mail, MailCheck } from 'lucide-react';
import { PASSWORD_HINT, PASSWORD_MIN_LENGTH, STUDENT_EMAIL_DOMAIN, normalizeStudentEmail, passwordError } from '../../shared/authRules';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { cx } from '../lib/format';
import { ease } from '../lib/motion';
import { useToast } from '../lib/toast';
import { Button, Field, Input } from '../components/ui';
import { Illustration, Wordmark } from '../components/brand';
import { CampusPhoto, useCredits } from '../components/credits';

type Mode = 'login' | 'activate' | 'reset';
type Step = 'identity' | 'code' | 'password';

// Only navigate to an internal, non-login destination after authentication.
function safeNext(value: string | null) {
  if (!value?.startsWith('/') || value.startsWith('//') || /[\\\u0000-\u001f]/.test(value)) return null;
  try {
    const url = new URL(value, window.location.origin);
    const path = decodeURIComponent(url.pathname).replace(/\/+$/, '').toLowerCase();
    if (url.origin !== window.location.origin || path === '/login') return null;
    return url.pathname + url.search + url.hash;
  } catch {
    return null;
  }
}

export function Login() {
  const [params, setParams] = useSearchParams();
  const mode: Mode = params.get('mode') === 'activate' ? 'activate' : params.get('mode') === 'reset' ? 'reset' : 'login';
  const nav = useNavigate();
  const { user, loading, setUser } = useAuth();
  const toast = useToast();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const previousScreen = useRef(`${mode}:identity`);
  const [step, setStep] = useState<Step>('identity');
  const [studentId, setStudentId] = useState('');
  const [email, setEmail] = useState(() => normalizeStudentEmail(params.get('email')) ?? '');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [setupToken, setSetupToken] = useState<string | null>(null);
  const [verifiedEmail, setVerifiedEmail] = useState('');
  const [sentAddress, setSentAddress] = useState<string | null>(null);
  const [devCode, setDevCode] = useState<string | null>(null);
  const [busy, setBusy] = useState<'send' | 'submit' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [deadlines, setDeadlines] = useState<Record<string, number>>({});
  const [now, setNow] = useState(Date.now());
  const validStudentId = /^[0-9]{8}$/.test(studentId);
  const fullEmail = `${studentId}@${STUDENT_EMAIL_DOMAIN}`;
  const normalizedEmail = normalizeStudentEmail(email);
  const recipient = mode === 'activate' ? fullEmail : normalizedEmail ?? email.trim().toLowerCase();
  const cooldownKey = `${mode}:${recipient}`;
  const cooldown = Math.max(0, Math.ceil(((deadlines[cooldownKey] ?? 0) - now) / 1000));
  const next = safeNext(params.get('next'));
  const disabled = loading || busy !== null;
  const validCode = /^[0-9]{6}$/.test(code);
  const validNewPassword = !passwordError(password) && password === confirmation;
  const newPasswordError = password ? passwordError(password) : null;
  const titles = { login: '欢迎回到树仁搭子', activate: step === 'password' ? '设置你的登录密码' : '激活你的搭子账号', reset: '重新设置登录密码' };

  useEffect(() => {
    if (!loading && user && mode !== 'reset') nav(mode === 'activate' || !user.questionnaireComplete ? '/me/edit?onboarding=1' : next || '/square', { replace: true });
  }, [user, loading, mode, nav, next]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  useEffect(() => {
    const screen = `${mode}:${step}`;
    if (previousScreen.current !== screen) headingRef.current?.focus();
    previousScreen.current = screen;
  }, [mode, step]);

  // Browser back/forward between modes must discard verification credentials too.
  useEffect(() => {
    setStep('identity');
    setCode('');
    setPassword('');
    setConfirmation('');
    setSetupToken(null);
    setVerifiedEmail('');
    setSentAddress(null);
    setDevCode(null);
    setError(null);
  }, [mode]);

  const switchMode = (target: Mode) => {
    if (disabled) return;
    setNotice(null);
    const query = new URLSearchParams(params);
    query.delete('email');
    if (target === 'login') query.delete('mode');
    else query.set('mode', target);
    setParams(query, { replace: true });
  };

  const restartVerification = () => {
    setStep('identity');
    setCode('');
    setPassword('');
    setConfirmation('');
    setSetupToken(null);
    setVerifiedEmail('');
    setSentAddress(null);
    setDevCode(null);
    setError(null);
  };

  const showFailure = (cause: unknown, fallback: string) => {
    setError(cause instanceof ApiError ? cause.message : fallback);
    if (cause instanceof ApiError && cause.status === 429) {
      const seconds = Number(cause.data.retryAfter ?? 60);
      setDeadlines((values) => ({ ...values, [cooldownKey]: Date.now() + Math.max(1, Number.isFinite(seconds) ? seconds : 60) * 1000 }));
      setNow(Date.now());
    }
  };

  const sendCode = async () => {
    if (disabled || cooldown > 0 || (mode === 'activate' ? !validStudentId : !normalizedEmail)) return;
    setBusy('send');
    setError(null);
    setNotice(null);
    try {
      const result = mode === 'activate' ? await api.requestActivationCode(studentId) : await api.requestResetCode(normalizedEmail!);
      setSentAddress(recipient);
      setCode('');
      setDevCode(import.meta.env.DEV ? result.devCode ?? null : null);
      setDeadlines((values) => ({ ...values, [cooldownKey]: Date.now() + 60_000 }));
      setNow(Date.now());
      setStep('code');
      toast.success(mode === 'activate' ? '验证码已发送' : '重设密码请求已提交', mode === 'activate' ? `请查收 ${recipient} 的邮件` : '如果邮箱对应已激活账号，将收到重设密码验证码');
    } catch (cause) {
      showFailure(cause, '发送失败，请稍后重试');
    } finally {
      setBusy(null);
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (disabled) return;
    if (mode !== 'login' && step === 'identity') {
      await sendCode();
      return;
    }
    if (mode === 'login' && (!normalizedEmail || !password)) return;
    if (mode === 'activate' && step === 'code' && (!validStudentId || !validCode)) return;
    if ((mode === 'activate' && step === 'password') || mode === 'reset') {
      const validation = passwordError(password) || (password !== confirmation ? '两次输入的密码不一致' : null);
      if (validation) { setError(validation); return; }
      if (mode === 'reset' && (!normalizedEmail || !validCode)) return;
      if (mode === 'activate' && !setupToken) return;
    }
    setBusy('submit');
    setError(null);
    setNotice(null);
    try {
      if (mode === 'login') {
        const result = await api.login(normalizedEmail!, password);
        setPassword('');
        setUser(result.user);
        toast.success('登录成功', '欢迎回来');
      } else if (mode === 'activate' && step === 'code') {
        const result = await api.verifyActivationCode(studentId, code);
        setSetupToken(result.setupToken);
        setVerifiedEmail(result.email);
        setEmail(result.email);
        setCode('');
        setDevCode(null);
        setStep('password');
      } else if (mode === 'activate') {
        const result = await api.activate(setupToken!, password);
        setPassword('');
        setConfirmation('');
        setSetupToken(null);
        setUser(result.user);
        toast.success('账号已激活', '接下来填写问卷，为你寻找合适的学习搭子');
      } else {
        await api.resetPassword(normalizedEmail!, code, password);
        setUser(null);
        setPassword('');
        setConfirmation('');
        setCode('');
        setDevCode(null);
        setNotice('密码已重设，请使用学校邮箱和新密码登录。');
        const query = new URLSearchParams(params);
        query.delete('mode');
        query.delete('email');
        setParams(query, { replace: true });
      }
    } catch (cause) {
      showFailure(cause, '操作失败，请稍后重试');
    } finally {
      setBusy(null);
    }
  };

  const canSubmit = mode === 'login'
    ? !!normalizedEmail && !!password
    : step === 'identity'
      ? (mode === 'activate' ? validStudentId : !!normalizedEmail) && cooldown === 0
      : mode === 'activate' && step === 'code'
        ? validCode
        : validNewPassword && (mode === 'activate' ? !!setupToken : validCode);
  const submitLabel = mode === 'login' ? '登录'
    : step === 'identity' ? cooldown > 0 ? `${cooldown}s 后重新发送` : '发送验证码'
      : mode === 'activate' && step === 'code' ? '验证邮箱，继续设置密码'
        : mode === 'activate' ? '设置密码并激活账号' : '重设密码';

  return (
    <div className="grid min-h-dvh lg:grid-cols-[1.1fr_1fr]">
      <figure className="relative hidden overflow-hidden bg-mat lg:block">
        <CampusPhoto file="branch.jpg" className="absolute inset-0" priority />
        <div className="absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-black/35 to-transparent" />
        <div className="absolute inset-x-0 bottom-0 h-56 bg-gradient-to-t from-black/55 to-transparent" />
        <Link to="/" className="absolute top-8 left-10 inline-flex items-center gap-2.5 text-white">
          <img src="/assets/brand/shield-white.png" alt="" className="h-8 w-auto" />
          <span className="font-display text-[20px]">树仁搭子</span>
        </Link>
        <figcaption className="absolute right-10 bottom-8 left-10 flex items-end justify-between gap-6 text-white">
          <span className="font-display text-[26px] leading-snug">居高怀仁<br />止于至善</span>
          <PhotoCredit file="branch.jpg" />
        </figcaption>
      </figure>

      <div className="relative flex flex-col">
        <div className="flex items-center justify-between px-6 pt-6 lg:px-12 lg:pt-10">
          <Link to="/" className="lg:hidden" aria-label="返回首页"><Wordmark /></Link>
          <Link to="/" className="ml-auto text-[13.5px] text-ink-3 hover:text-ink">返回首页</Link>
        </div>
        <div className="flex flex-1 items-center justify-center px-6 py-10 lg:px-12">
          <motion.div initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.22, ease }} className="w-full max-w-[420px]">
            {mode !== 'login' && <button type="button" disabled={disabled} onClick={() => switchMode('login')} className="mb-6 inline-flex items-center gap-1.5 py-1 text-[13.5px] text-ink-3 transition-colors hover:text-brand-text disabled:opacity-60"><ArrowLeft size={15} aria-hidden />返回登录</button>}
            <h1 ref={headingRef} tabIndex={-1} className="font-display text-[32px] tracking-[-0.02em] text-ink outline-none sm:text-[36px]">{titles[mode]}</h1>
            <p className="mt-2 text-[14.5px] leading-relaxed text-ink-2">
              {mode === 'login' ? '使用学校邮箱和密码登录，继续寻找合拍的学习搭子。' : mode === 'activate' ? '先验证学校邮箱，再设置一个只有你知道的密码。' : '通过学校邮箱接收验证码，验证后即可重设密码。'}
            </p>
            {mode === 'activate' && (
              <ol aria-label="激活步骤" className="mt-6 flex items-center gap-2 text-[12px] text-ink-3 sm:text-[13px]">
                {['输入学号', '验证邮箱', '设置密码'].map((label, index) => {
                  const current = step === 'identity' ? 0 : step === 'code' ? 1 : 2;
                  return <li key={label} aria-current={current === index ? 'step' : undefined} className={cx('flex flex-1 items-center gap-1.5', current >= index && 'text-brand-text')}><span className={cx('grid size-5 shrink-0 place-items-center rounded-full text-[11px]', current >= index ? 'bg-brand-soft' : 'bg-paper-2')}>{current > index ? <Check size={12} aria-hidden /> : index + 1}</span>{label}{index < 2 && <span className="ml-auto h-px w-3 bg-line-strong" aria-hidden />}</li>;
                })}
              </ol>
            )}

            <form onSubmit={submit} className="mt-7 space-y-5" aria-busy={disabled}>
              {notice && <p className="rounded-lg bg-brand-soft px-3.5 py-3 text-[14px] text-brand-text" role="status">{notice}</p>}
              {mode === 'activate' && step === 'password' ? (
                <div className="rounded-lg border border-line bg-surface p-3.5">
                  <p className="flex items-center gap-2 text-[13px] text-brand-text"><MailCheck size={16} aria-hidden />学校邮箱已验证</p>
                  <p className="mt-1 break-all text-[14px] text-ink">{verifiedEmail}</p>
                  <button type="button" onClick={restartVerification} disabled={disabled} className="mt-1 text-[12.5px] text-ink-3 underline">重新验证邮箱</button>
                </div>
              ) : mode === 'activate' ? (
                <Field label="学号" hint={step === 'identity' ? '只需输入 8 位学号，验证码将发送到对应学校邮箱。' : undefined}>
                  <div className="flex h-11 items-center overflow-hidden rounded-md border border-line-strong bg-surface transition-[border-color,box-shadow] focus-within:border-brand focus-within:shadow-[0_0_0_3px_var(--brand-soft)]">
                    <Mail size={17} className="ml-3 shrink-0 text-ink-3" aria-hidden />
                    <input value={studentId} onChange={(event) => { setStudentId(event.target.value.replace(/[^0-9]/g, '').slice(0, 8)); setError(null); }} aria-label="8 位学号" aria-describedby="school-email-domain" name="studentId" type="text" inputMode="numeric" autoComplete="username" pattern="[0-9]{8}" maxLength={8} required disabled={disabled || step === 'code'} placeholder="请输入你的学号" className="tabular h-full min-w-0 flex-1 bg-transparent px-2.5 text-[16px] text-ink outline-none disabled:opacity-60 sm:text-[15px]" />
                    <span id="school-email-domain" className="shrink-0 border-l border-line px-2 text-[11px] text-ink-3 sm:px-3 sm:text-[13px]">@{STUDENT_EMAIL_DOMAIN}</span>
                  </div>
                </Field>
              ) : (
                <Field label="学校邮箱">
                  <Input value={email} onChange={(event) => { setEmail(event.target.value); setError(null); }} aria-label="学校邮箱" name="email" type="email" inputMode="email" autoComplete="username" autoCapitalize="none" spellCheck={false} required disabled={disabled || (mode === 'reset' && step === 'code')} placeholder="请输入学校邮箱" leading={<Mail size={17} aria-hidden />} />
                </Field>
              )}

              {mode !== 'login' && step === 'code' && (
                <Field label="邮箱验证码" aside={<button type="button" onClick={sendCode} disabled={disabled || cooldown > 0} className="tabular text-[12.5px] text-brand-text hover:underline disabled:text-ink-4 disabled:no-underline">{busy === 'send' ? '发送中…' : cooldown > 0 ? `${cooldown}s 后重新发送` : '重新发送验证码'}</button>}>
                  <Input value={code} onChange={(event) => { setCode(event.target.value.replace(/[^0-9]/g, '').slice(0, 6)); setError(null); }} aria-label="6 位邮箱验证码" name="code" type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required disabled={disabled} placeholder="输入 6 位验证码" className="tabular tracking-[0.2em] placeholder:tracking-normal" />
                  <p className="mt-2.5 text-[13px] leading-relaxed text-ink-2" role="status">{mode === 'activate' ? `验证码已发送至 ${sentAddress}，10 分钟内有效。` : `如果 ${sentAddress} 对应已激活账号，将收到验证码，10 分钟内有效。`}</p>
                  <button type="button" onClick={restartVerification} disabled={disabled} className="mt-1 text-[12.5px] text-brand-text underline">{mode === 'activate' ? '修改学号' : '修改邮箱'}</button>
                  {devCode && import.meta.env.DEV && <p className="mt-2.5 flex items-center gap-2 rounded-lg bg-paper-2 px-3 py-2 text-[13px] text-ink-2">开发模式验证码 <b className="font-semibold tracking-wider tabular">{devCode}</b><button type="button" disabled={disabled} className="ml-auto underline" onClick={() => setCode(devCode)}>填入</button></p>}
                </Field>
              )}

              {(mode === 'login' || (mode === 'activate' && step === 'password') || (mode === 'reset' && step === 'code')) && (
                <>
                  <Field label={mode === 'login' ? '密码' : '新密码'} hint={mode !== 'login' ? <span id="password-hint">{PASSWORD_HINT}</span> : undefined} error={mode !== 'login' ? newPasswordError : null}>
                    <PasswordInput value={password} onChange={(value) => { setPassword(value); setError(null); }} name="password" label={mode === 'login' ? '密码' : '新密码'} disabled={disabled} isNew={mode !== 'login'} invalid={mode !== 'login' && !!newPasswordError} />
                    {mode === 'login' && <div className="mt-2 flex justify-end"><button type="button" disabled={disabled} onClick={() => switchMode('reset')} className="py-1 text-[13.5px] text-brand-text underline-offset-4 hover:underline disabled:opacity-60">忘记密码？</button></div>}
                  </Field>
                  {mode !== 'login' && <Field label="确认新密码" error={confirmation && password !== confirmation ? '两次输入的密码不一致' : null}><PasswordInput value={confirmation} onChange={(value) => { setConfirmation(value); setError(null); }} name="confirmation" label="确认新密码" disabled={disabled} isNew invalid={!!confirmation && password !== confirmation} /></Field>}
                </>
              )}

              <AnimatePresence>
                {error && <motion.p initial={{ opacity: 0, y: -4, height: 0 }} animate={{ opacity: 1, y: 0, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="rounded-lg bg-danger-soft px-3.5 py-2.5 text-[14px] text-danger" role="alert">{error}</motion.p>}
              </AnimatePresence>
              <Button type="submit" variant="primary" size="lg" className="w-full" loading={busy !== null} disabled={!canSubmit || disabled}>{loading ? '正在检查登录状态…' : submitLabel}</Button>
            </form>
            <div className="mt-7 flex items-start gap-3 border-t border-line pt-5">
              <Illustration name="mascot-empty" className="size-14 shrink-0" />
              <p className="pt-1 text-[13.5px] leading-relaxed text-ink-2">{mode === 'login' ? <>第一次使用，或以前通过验证码登录？请先<button type="button" disabled={disabled} onClick={() => switchMode('activate')} className="mx-0.5 font-semibold text-brand-text underline underline-offset-4 disabled:opacity-60">激活账号</button>设置密码，已有主页和资料会保留。</> : mode === 'activate' ? <>已有账号且设置过密码？直接<button type="button" disabled={disabled} onClick={() => switchMode('login')} className="mx-0.5 font-semibold text-brand-text underline underline-offset-4 disabled:opacity-60">登录</button>。忘记密码可通过学校邮箱重设。</> : '重设后，所有设备上的旧登录状态都会失效。请使用新密码重新登录。'}</p>
            </div>
          </motion.div>
        </div>
      </div>
    </div>
  );
}

function PasswordInput({ value, onChange, name, label, disabled, isNew, invalid }: { value: string; onChange: (value: string) => void; name: string; label: string; disabled: boolean; isNew: boolean; invalid?: boolean }) {
  const [visible, setVisible] = useState(false);
  return <Input value={value} onChange={(event) => onChange(event.target.value)} aria-label={label} aria-describedby={isNew ? 'password-hint' : undefined} name={name} type={visible ? 'text' : 'password'} autoComplete={isNew ? 'new-password' : 'current-password'} minLength={isNew ? PASSWORD_MIN_LENGTH : undefined} required disabled={disabled} invalid={invalid} placeholder={isNew ? '设置一个新密码' : '输入你的密码'} trailing={<button type="button" disabled={disabled} onClick={() => setVisible((current) => !current)} aria-label={visible ? `隐藏${label}` : `显示${label}`} aria-pressed={visible} className="grid size-8 place-items-center rounded text-ink-3 hover:text-ink">{visible ? <EyeOff size={17} aria-hidden /> : <Eye size={17} aria-hidden />}</button>} />;
}

function PhotoCredit({ file }: { file: string }) {
  const credit = useCredits().campus.find((item) => item.file === file);
  if (!credit) return null;
  return <a href={credit.sourceUrl} target="_blank" rel="noreferrer" className="shrink-0 text-right text-[12px] leading-relaxed text-white/75 hover:text-white">{credit.subject}<br />摄影 {credit.author}，{credit.license}</a>;
}
