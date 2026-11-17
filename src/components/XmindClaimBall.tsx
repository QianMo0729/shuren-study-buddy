import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { AnimatePresence, motion } from 'motion/react';
import { Button, Modal } from './ui';
import { useAuth } from '../lib/auth';
import { useToast } from '../lib/toast';
import { closeXmindForm, openXmindForm, submitXmindRegistration, useBenefitsStatus, useXmindClaim } from '../lib/benefits';

const RADIUS = 27;
const LENGTH = 2 * Math.PI * RADIUS;
const VALID_PHONE = /^1[3-9]\d{9}$/;
/** 粘贴「+86 138 0013 8000」「138-0013-8000」这类写法时，只留下 11 位号码 */
function digitsOnly(raw: string) {
  let digits = raw.replace(/\D/g, '');
  if (digits.length > 11 && digits.startsWith('86')) digits = digits.slice(2);
  return digits.slice(0, 11);
}

/**
 * 跟着福利页面走的倒计时小球：计时中显示剩余秒数，时间到了变成「领取」，点开就是登记表单。
 * 表单也在这里，活动页上的按钮打开的是同一个。
 */
export function XmindClaimBall() {
  const { user } = useAuth();
  const { status } = useBenefitsStatus();
  // 这个小球所在的福利页面在屏幕上时，浏览时间才累计
  const claim = useXmindClaim(user, { track: true });
  const toast = useToast();
  const full = status?.xmind.remaining === 0;
  const visible = !!user && claim.registration === null && claim.timing && !full && status?.xmind.open !== false;

  // 时间到的那一刻提示一次；进入页面时已经到时间的不再提示
  const [hint, setHint] = useState(false);
  const wasCounting = useRef(false);
  useEffect(() => {
    if (!visible) { wasCounting.current = false; return; }
    if (!claim.ready) { wasCounting.current = true; return; }
    if (!wasCounting.current) return;
    wasCounting.current = false;
    setHint(true);
    const timer = window.setTimeout(() => setHint(false), 6000);
    return () => window.clearTimeout(timer);
  }, [visible, claim.ready]);

  function press() {
    if (claim.ready) { setHint(false); openXmindForm(); return; }
    toast.info(`再浏览 ${claim.remaining} 秒就可以登记 50 AI 点数`, '看福利页面、模板或视频时计时，离开后暂停');
  }

  return <>
    <AnimatePresence>
      {visible && <motion.div className="xmind-ball-dock" initial={{ opacity: 0, scale: 0.6 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.6 }} transition={{ duration: 0.2 }}>
        <AnimatePresence>
          {hint && <motion.button type="button" className="xmind-ball-hint" onClick={press} initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 8 }} transition={{ duration: 0.2 }}>可以登记 50 AI 点数了</motion.button>}
        </AnimatePresence>
        <motion.button type="button" className="xmind-ball" data-ready={claim.ready || undefined} onClick={press} whileTap={{ scale: 0.94 }}
          animate={hint ? { scale: [1, 1.12, 1] } : { scale: 1 }} transition={{ duration: 0.45 }}
          aria-label={claim.ready ? '登记 50 AI 点数' : `Xmind 点数登记倒计时，还需 ${claim.remaining} 秒`}>
          {claim.ready ? <span className="xmind-ball-go">领取</span> : <>
            <svg viewBox="0 0 60 60" aria-hidden="true"><circle cx="30" cy="30" r={RADIUS} /><circle cx="30" cy="30" r={RADIUS} strokeDasharray={LENGTH} strokeDashoffset={LENGTH * (1 - claim.progress)} /></svg>
            <span className="xmind-ball-count">{claim.remaining}<small>秒</small></span>
          </>}
        </motion.button>
        <span className="sr-only" role="status">{claim.ready ? '浏览时间已满，可以登记 50 AI 点数了' : ''}</span>
      </motion.div>}
    </AnimatePresence>
    <XmindForm open={claim.formOpen && !!user && claim.registration === null} full={full} />
  </>;
}

function XmindForm({ open, full }: { open: boolean; full: boolean }) {
  const toast = useToast();
  const [phone, setPhone] = useState('');
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { if (open) setError(''); }, [open]);
  const valid = VALID_PHONE.test(phone);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || !valid || !consent) return;
    setBusy(true); setError('');
    try {
      await submitXmindRegistration(phone);
      setPhone(''); setConsent(false);
      toast.success('登记已提交', 'Xmind 核对账号后统一充值');
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : '网络连接失败，请稍后重试');
    } finally { setBusy(false); }
  }
  // 表单被关掉之后（比如凭证过期、重新计时）才出现的错误，改用提示条告诉同学
  useEffect(() => { if (!open && error) { toast.error(error); setError(''); } }, [open, error, toast]);

  return <Modal open={open} onClose={() => { if (!busy) closeXmindForm(); }} title="登记 50 AI 点数" dismissible={!busy}>
    <form className="benefits-form" onSubmit={submit}>
      <p>请填写本人已注册 Xmind 账号绑定的手机号。Xmind 将按此号码核对账号并统一充值。每个树仁搭子账号登记一次，提交后不能自行修改，请仔细核对。</p>
      <label htmlFor="xmind-phone">本人 Xmind 账号绑定手机号</label>
      <input id="xmind-phone" type="tel" inputMode="numeric" autoComplete="tel" aria-describedby="xmind-phone-hint" aria-invalid={phone.length === 11 && !valid} placeholder="请输入 11 位手机号" required value={phone} onChange={(e) => setPhone(digitsOnly(e.target.value))} />
      <p id="xmind-phone-hint" className="benefits-field-hint">{phone.length === 11 && !valid ? <strong>这不是有效的大陆手机号，请检查。</strong> : '本页不发送短信验证码，也不核验 Xmind 账号是否存在，请自行确认账号已注册且已绑定该号码。'}</p>
      <label className="benefits-checkbox"><input type="checkbox" required checked={consent} onChange={(e) => setConsent(e.target.checked)} /><span>我确认已核对账号绑定号码，并同意将手机号提供给树仁活动负责人员及 Xmind 指定工作人员，仅用于本次点数发放。<Link to="/privacy" target="_blank">查看隐私说明</Link></span></label>
      {full && <p className="benefits-error" role="alert">200 份登记名额已满</p>}{error && <p className="benefits-error" role="alert">{error}</p>}
      <Button type="submit" variant="primary" loading={busy} disabled={!consent || full || !valid}>{busy ? '正在提交登记…' : '提交登记'}</Button>
    </form>
  </Modal>;
}
