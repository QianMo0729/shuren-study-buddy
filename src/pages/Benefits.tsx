import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router';
import { ArrowLeft, ArrowUpRight, BookOpen, Check, Clock3, Gift, Layers3, Play, Sparkles } from 'lucide-react';
import { Button, Modal } from '../components/ui';
import { useAuth } from '../lib/auth';
import { benefitsApi, type BenefitStatus } from '../lib/benefits';
import { xmindFeatures, xmindTemplates, xmindVideos } from '../lib/partnerContent';
import './benefits.css';

const errorText = (e: unknown) => e instanceof Error ? e.message : '网络连接失败，请稍后重试';

export function BenefitsLayout({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { pathname } = useLocation();
  return <div className="benefits-page">
    <header className="benefits-nav"><Link to={user ? '/today' : '/'} className="benefits-back"><ArrowLeft size={17} /> 树仁搭子</Link>
      <Link to="/benefits" className="benefits-nav-title">学习工具福利</Link><span className="benefits-eyebrow">品牌合作</span></header>
    <main key={pathname}>{children}</main>
    <footer className="benefits-footer"><span>树仁书院 · 学习搭子</span><Link to="/privacy">隐私说明</Link><Link to="/benefits">全部福利</Link></footer>
  </div>;
}

export function Benefits() {
  return <BenefitsLayout>
    <section className="benefits-intro"><p className="benefits-eyebrow">SHUREN × STUDY TOOLS</p>
      <h1>好工具，<br />陪你把学习理清楚。</h1>
      <p>从整理第一张知识导图，到读懂一本书。<br />树仁搭子和你的学习工具，一起送上一点助力。</p>
    </section>
    <div className="benefits-brand-grid">
      <Link to="/benefits/xmind" className="benefits-brand-card benefits-xmind-card">
        <div className="benefits-card-top"><span className="benefits-wordmark">Xmind</span><ArrowUpRight /></div>
        <div className="benefits-map" aria-hidden="true"><span>我的学习计划</span><div><i>梳理知识</i><i>考试复习</i><i>灵感与想法</i></div></div>
        <p className="benefits-eyebrow">把想法，连成一张图</p><h2>你的学习好搭子</h2>
        <p>功能指南、官方视频、学习模板，找到适合你的思路。</p>
        <span className="benefits-pill"><Sparkles size={15} /> 50 AI 点数 · 限 200 份</span>
        <div className="benefits-card-link">探索 Xmind 福利 <ArrowUpRight size={18} /></div>
      </Link>
      <Link to="/benefits/marginnote" className="benefits-brand-card benefits-mn-card">
        <div className="benefits-card-top"><span className="benefits-wordmark">MarginNote 5</span><ArrowUpRight /></div>
        <img className="benefits-brand-preview" src="/partners/marginnote/english.png" alt="MarginNote 阅读、摘录与知识脑图示例" />
        <p className="benefits-eyebrow">让知识，留在脑海里</p><h2>阅读之后，还有收获</h2>
        <p>在一个学习空间里，把阅读、笔记和复习连起来。</p>
        <span className="benefits-pill"><Gift size={15} /> 3 个月 Max 订阅 · 限量兑换码</span>
        <div className="benefits-card-link">探索 MarginNote 福利 <ArrowUpRight size={18} /></div>
      </Link>
    </div>
    <p className="benefits-footnote">福利规则以各活动页说明为准。请选择适合自己的工具，自愿参与领取。</p>
  </BenefitsLayout>;
}

function useBenefitsStatus() {
  const [status, setStatus] = useState<BenefitStatus | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    const load = () => benefitsApi.status().then((s) => { if (active) { setStatus(s); setError(''); } }).catch((e) => { if (active) setError(errorText(e)); });
    void load();
    const timer = window.setInterval(() => { if (!document.hidden) void load(); }, 10_000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);
  return { status, error, setStatus };
}

export function XmindBenefit() {
  const { user } = useAuth();
  const { status, error: statusError, setStatus } = useBenefitsStatus();
  const [visit, setVisit] = useState<{ token: string; userId: number } | null>(null);
  const [remaining, setRemaining] = useState(30);
  const [visitAttempt, setVisitAttempt] = useState(0);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);
  const [phone, setPhone] = useState('');
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState(false);
  const elapsed = useRef(0);
  useEffect(() => {
    let active = true;
    setVisit(null); setRemaining(30); setSuccess(false); setError(''); setPhone(''); setConsent(false); setOpen(false); elapsed.current = 0;
    if (!user) return;
    benefitsApi.visit().then((data) => { if (active) setVisit({ token: data.token, userId: user.id }); }).catch((e) => { if (active) setError(errorText(e)); });
    return () => { active = false; };
  }, [user?.id, visitAttempt]);
  useEffect(() => {
    if (!visit || visit.userId !== user?.id) return;
    let last = performance.now();
    const tick = () => {
      const now = performance.now();
      if (!document.hidden) elapsed.current += Math.min(now - last, 1000);
      last = now;
      setRemaining(Math.max(0, Math.ceil((30_000 - elapsed.current) / 1000)));
    };
    const visibility = () => { last = performance.now(); };
    const timer = window.setInterval(tick, 250);
    document.addEventListener('visibilitychange', visibility);
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', visibility); };
  }, [visit, user?.id]);
  const full = status?.xmind.remaining === 0;
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!visit || visit.userId !== user?.id || busy) return;
    setBusy(true); setError('');
    try {
      await benefitsApi.register(visit.token, phone, consent);
      setSuccess(true); setOpen(false); setPhone(''); setConsent(false);
      benefitsApi.status().then(setStatus).catch(() => {});
    } catch (e) { setError(errorText(e)); benefitsApi.status().then(setStatus).catch(() => {}); }
    finally { setBusy(false); }
  }
  return <BenefitsLayout>
    <section className="benefits-hero xmind-hero"><div>
      <p className="benefits-eyebrow">Xmind × 树仁搭子</p><h1>Xmind，<br />你的学习好搭子</h1>
      <p>用 Xmind 把想法理清楚：<br />从第一次画导图，到找到适合自己的学习模板。</p>
      <div className="benefits-actions"><External href="https://app.xmind.cn/" primary>免费开始理清思路</External><External href="https://xmind.cn/mindmaps-gallery/">先逛逛学习模板</External></div>
    </div><div className="benefits-hero-art"><span className="benefits-image-label">从一张图，开始理解</span><img src="/partners/xmind/image8.jpeg" alt="Xmind 线性代数考点知识导图" /></div></section>
    <section className="benefits-claim-strip" aria-label="Xmind 点数领取"><span className="benefits-gift"><Sparkles size={26} /></span>
      <div className="benefits-claim-copy"><p className="benefits-eyebrow">树仁搭子专属福利</p><h2>给你的灵感，50 AI 点数</h2><p>{success ? '登记成功，AI 点数将由 Xmind 后台统一发放。' : full ? '200 份领取名额已满' : '限 200 份 · 浏览本页满 30 秒后可登记'}</p></div>
      {!success && (user ? <Button variant="primary" size="lg" disabled={full || !status || remaining > 0 || !visit || visit.userId !== user.id} onClick={() => { setError(''); setOpen(true); }}>
        {full ? '领取名额已满' : remaining > 0 ? `浏览倒计时 ${remaining} 秒` : '领取 50 AI 点数'}
      </Button> : <Link className="benefits-primary" to="/login?next=%2Fbenefits%2Fxmind">登录后浏览领取</Link>)}
      {success && <span className="benefits-success"><Check size={19} /> 已登记</span>}
    </section>
    <div className="benefits-notice"><Clock3 size={16} /><p>实时登记不代表实时充值。请使用本人已注册 Xmind 账号绑定的手机号；具体到账安排及点数有效期以活动方通知为准。</p></div>
    {(statusError || (error && !open)) && <div className="benefits-error" role="alert">{statusError || error} {user && !visit && <button onClick={() => setVisitAttempt((n) => n + 1)}>重新加载领取入口</button>}</div>}
    <section className="benefits-section"><SectionHead number="01" title="8 个功能，承包你的大学作业" subtitle="把工具用在具体的问题上。点开卡片，看看官方怎么做。" />
      <div className="benefits-feature-grid">{xmindFeatures.map((item, i) => <a href={item.href} key={item.title} target="_blank" rel="noreferrer" className="benefits-feature-card"><span className="benefits-feature-number">0{i + 1}</span><ArrowUpRight size={17} /><h3>{item.title}</h3><p>{item.description}</p><span className="benefits-text-link">查看官方指南</span></a>)}</div>
    </section>
    <section className="benefits-section"><SectionHead number="02" title="官方学姐的经验，都在这了" subtitle="从新手入门到高效复习，跟着视频一步步来。" />
      <div className="benefits-video-grid">{xmindVideos.map((item) => <a className="benefits-media-card" key={item.href} href={item.href} target="_blank" rel="noreferrer"><div className="benefits-video-cover"><img src={item.image} alt={item.title} loading="lazy" /><span><Play size={20} fill="currentColor" /></span></div><div><h3>{item.title}</h3><p>{item.description}</p><span className="benefits-text-link">前往哔哩哔哩观看 ↗</span></div></a>)}</div>
    </section>
    <section className="benefits-section"><SectionHead number="03" title="抄作业级别的学习模板" subtitle="读书、考试、论文和求职，从一个现成框架开始。" />
      <div className="benefits-template-grid">{xmindTemplates.map((item) => <a className="benefits-media-card" key={item.href} href={item.href} target="_blank" rel="noreferrer"><img src={item.image} alt={item.name} loading="lazy" /><div><span className="benefits-eyebrow">{item.category}</span><h3>{item.title}</h3><p>{item.name}</p><span className="benefits-text-link">查看模板 ↗</span></div></a>)}</div>
    </section>
    <section className="benefits-bottom-cta"><h2>下一张知识地图，从你开始。</h2><External href="https://app.xmind.cn/" primary>开始使用 Xmind</External></section>
    <Modal open={open} onClose={() => { if (!busy) setOpen(false); }} title="领取 50 AI 点数" dismissible={!busy}>
      <form className="benefits-form" onSubmit={submit}>
        <p>请先确认你已注册 Xmind，并绑定了本人的手机号码。提交前请仔细核对，活动方将按该号码核对账号并统一发放。</p>
        <label htmlFor="xmind-phone">本人 Xmind 账号绑定手机号</label><input id="xmind-phone" type="tel" inputMode="numeric" autoComplete="tel" placeholder="请输入 11 位手机号" pattern="1[3-9][0-9]{9}" maxLength={11} required value={phone} onChange={(e) => setPhone(e.target.value)} />
        <label className="benefits-checkbox"><input type="checkbox" required checked={consent} onChange={(e) => setConsent(e.target.checked)} /><span>我确认已核对账号绑定号码，并同意将手机号提供给树仁活动负责人员及 Xmind 指定工作人员，仅用于本次点数发放。<Link to="/privacy" target="_blank">查看隐私说明</Link></span></label>
        {full && <p className="benefits-error" role="alert">200 份领取名额已满</p>}{error && <p className="benefits-error" role="alert">{error}</p>}
        <Button type="submit" variant="primary" loading={busy} disabled={!consent || full || !/^1[3-9]\d{9}$/.test(phone)}>提交领取登记</Button>
      </form>
    </Modal>
  </BenefitsLayout>;
}

export function MarginNoteBenefit() {
  const { user } = useAuth();
  const { status, error: statusError, setStatus } = useBenefitsStatus();
  const [code, setCode] = useState<{ userId: number; value: string } | null>(null);
  const [loadedFor, setLoadedFor] = useState<number | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    setCode(null); setLoadedFor(null); setAccepted(false); setError('');
    if (user) benefitsApi.myCode().then((data) => { if (active) { setCode(data.code ? { userId: user.id, value: data.code } : null); setLoadedFor(user.id); } }).catch((e) => { if (active) setError(errorText(e)); });
    return () => { active = false; };
  }, [user?.id]);
  const ownCode = code?.userId === user?.id ? code?.value : null;
  async function claim() {
    if (!user || busy) return;
    setBusy(true); setError('');
    try { const data = await benefitsApi.claim(); setCode({ userId: user.id, value: data.code }); benefitsApi.status().then(setStatus).catch(() => {}); }
    catch (e) { setError(errorText(e)); }
    finally { setBusy(false); }
  }
  return <BenefitsLayout>
    <section className="benefits-hero mn-hero"><div><p className="benefits-eyebrow">MarginNote 5 × 树仁搭子</p><h1>读进去，<br />也要记得住。</h1><p>让阅读、笔记与复习连贯起来。<br />适用于 iPad、iPhone 和 Mac 的学习空间。</p><a className="benefits-primary" href="#mn-claim">查看 3 个月订阅福利 <ArrowUpRight size={17} /></a></div>
      <div className="benefits-hero-art"><span className="benefits-image-label">MarginNote 5 · 英语学习示例</span><img src="/partners/marginnote/english.png" alt="MarginNote 5 英语阅读与知识整理界面" /></div>
    </section>
    <section className="benefits-section"><SectionHead number="01" title="第一次使用，只需 3 步" subtitle="不用在阅读器、笔记本和复习卡片之间来回切换。" />
      <div className="benefits-steps">{[
        { Icon: BookOpen, title: '导入资料，开始阅读', text: '创建学习集，导入 PDF 讲义或学习资料。多份文档集中管理，方便对照阅读。' },
        { Icon: Layers3, title: '摘录重点，连起知识', text: '把重点摘成笔记卡片，在脑图中整理关系。笔记始终关联原文，点击即可回看。' },
        { Icon: Sparkles, title: '主动回忆，高效复习', text: '遮挡知识点，尝试自己回答；把卡片加入复习队列，按掌握程度安排复习。' },
      ].map(({ Icon, title, text }, i) => <article key={title}><span className="benefits-step-icon"><Icon size={25} /></span><p className="benefits-eyebrow">STEP 0{i + 1}</p><h3>{title}</h3><p>{text}</p></article>)}</div>
    </section>
    <section className="benefits-section"><SectionHead number="02" title="不一样的课程，同样清晰的思路" subtitle="以下为合作方提供的笔记示例。" /><div className="benefits-video-grid">{[['english', '英语 · 把词汇放回语境'], ['anatomy', '解剖 · 看清知识之间的关系'], ['math', '高数 · 从公式到解题思路']].map(([image, title]) => <figure className="benefits-media-card" key={image}><img src={`/partners/marginnote/${image}.png`} alt={title} loading="lazy" /><figcaption><h3>{title}</h3></figcaption></figure>)}</div></section>
    <section className="benefits-resource"><div><p className="benefits-eyebrow">更多学习资源</p><h2>真题、词汇和错题，放在一起学。</h2><p>在 MarginNote 5 首页点击「更多学习集」，获取四六级、考研英语真题及高频词汇资源。也可以选择刷题卡片、外刊生词等学习场景。</p></div><img src="/partners/marginnote/resources.png" alt="在 MarginNote 首页找到更多学习集的操作示意" loading="lazy" /></section>
    <section id="mn-claim" className="benefits-mn-claim"><p className="benefits-eyebrow">给树仁同学的一份学习助力</p><h2>3 个月 Max 订阅</h2><p>每个站内账号可领取一个兑换码；每个 Apple 账户只能兑换一张，不可叠加。请在 2027 年 2 月 12 日前兑换。</p>
      <ol><li>在 App Store 点击账号头像，选择「兑换充值卡或代码」。</li><li>输入订阅码，并核对 Apple 显示的适用条件和续订条款后确认。</li><li>下载 MarginNote 5，使用同一 Apple 账户。</li></ol>
      <p className="benefits-renewal">{status?.marginnote.renewalTerms || '兑换及续订条款正在确认，确认前暂不开放领取。'} 订阅可能自动续费，请以 Apple 兑换确认页和订阅页显示的信息为准。</p>
      {ownCode ? <div className="benefits-code"><span><Check size={17} /> 你的兑换码，请妥善保管</span><strong>{ownCode}</strong><p>再次打开本页仍可查看，不会重复占用名额。</p><Button onClick={() => { navigator.clipboard.writeText(ownCode).catch(() => setError('复制失败，请手动选择并复制兑换码')); }}>复制兑换码</Button></div>
        : user ? <><label className="benefits-checkbox"><input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} /><span>我已阅读兑换条件及续订说明，了解需要在 Apple 订阅设置中管理自动续订。</span></label><Button variant="primary" size="lg" onClick={claim} loading={busy} disabled={!accepted || !status?.marginnote.enabled || status.marginnote.remaining === 0 || loadedFor !== user.id}>{!status ? '正在加载福利' : !status.marginnote.enabled ? '暂未开放领取或已结束' : status.marginnote.remaining === 0 ? '本批兑换码已领完' : '领取我的兑换码'}</Button></>
        : <Link className="benefits-primary" to="/login?next=%2Fbenefits%2Fmarginnote">登录后领取</Link>}
      {(error || statusError) && <p className="benefits-error" role="alert">{error || statusError}</p>}
      <p className="benefits-footnote">使用及兑换问题，请在 MarginNote App 内「反馈与客服」联系官方。福利不支持返现或退款。</p>
    </section>
  </BenefitsLayout>;
}

function SectionHead({ number, title, subtitle }: { number: string; title: string; subtitle: string }) {
  return <header className="benefits-section-head"><span>{number}</span><div><h2>{title}</h2><p>{subtitle}</p></div></header>;
}
function External({ href, primary, children }: { href: string; primary?: boolean; children: ReactNode }) {
  return <a href={href} target="_blank" rel="noreferrer" className={primary ? 'benefits-primary' : 'benefits-secondary'}>{children}<ArrowUpRight size={17} /></a>;
}
