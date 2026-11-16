import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router';
import { ArrowLeft, ArrowUpRight, BookOpen, Check, Clock3, Gift, Layers3, Play, Sparkles } from 'lucide-react';
import { Button, Modal } from '../components/ui';
import { PartnerLogo, type PartnerBrand } from '../components/PartnerLogo';
import { useAuth } from '../lib/auth';
import { benefitsApi, marginNoteStatusLabel, useBenefitsStatus } from '../lib/benefits';
import { xmindFeatures, xmindTemplates, xmindVideos } from '../lib/partnerContent';
import './benefits.css';

const errorText = (e: unknown) => e instanceof Error ? e.message : '网络连接失败，请稍后重试';

export function BenefitsLayout({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { pathname } = useLocation();
  const brand: PartnerBrand | null = pathname === '/benefits/xmind' ? 'xmind' : pathname === '/benefits/marginnote' ? 'marginnote' : null;
  return <div className="benefits-page">
    <header className="benefits-nav"><Link to={user ? '/today' : '/'} className="benefits-back"><ArrowLeft size={17} /> 树仁搭子</Link>
      <Link to="/benefits" className="benefits-nav-title">学习工具福利</Link><span className="benefits-eyebrow">品牌合作</span></header>
    <main key={pathname}>{children}</main>
    <footer className="benefits-footer">{brand && <div className="benefits-footer-logo"><PartnerLogo brand={brand} size="compact" /></div>}<span>树仁书院 · 学习搭子</span><Link to="/privacy">隐私说明</Link><Link to="/benefits">全部福利</Link></footer>
  </div>;
}

export function Benefits() {
  const { status, error } = useBenefitsStatus();
  return <BenefitsLayout>
    <section className="benefits-intro"><p className="benefits-eyebrow">SHUREN × STUDY TOOLS</p>
      <h1>学习工具<br />合作福利</h1>
      <p>整理课程知识、准备小组汇报，或阅读讲义、论文：看看哪款工具适合你，再了解对应的福利和参与方式。</p>
      <p className="benefits-intro-note">内容可直接浏览，参与领取需登录树仁搭子账号。</p>
    </section>
    <div className="benefits-brand-grid">
      <Link to="/benefits/xmind" className="benefits-brand-card benefits-xmind-card">
        <div className="benefits-card-top"><PartnerLogo brand="xmind" /><ArrowUpRight /></div>
        <div className="benefits-map" aria-hidden="true"><span>我的学习计划</span><div><i>梳理知识</i><i>考试复习</i><i>灵感与想法</i></div></div>
        <p className="benefits-eyebrow">梳理考点 · 汇报提纲 · 复习计划</p><h2>50 AI 点数</h2>
        <p>用导图梳理课程考点、列汇报提纲，也可以参考现成的复习和论文阅读模板。</p>
        <span className="benefits-pill"><Sparkles size={15} /> 共 200 份 · {!error && status?.xmind.remaining === 0 ? '登记名额已满' : '登记后统一发放'}</span>
        <p className="benefits-card-condition">登录后浏览活动页满 30 秒，登记本人 Xmind 账号绑定手机号。</p>
        <div className="benefits-card-link">查看福利与登记方式 <ArrowUpRight size={18} /></div>
      </Link>
      <Link to="/benefits/marginnote" className="benefits-brand-card benefits-mn-card">
        <div className="benefits-card-top"><PartnerLogo brand="marginnote" /><ArrowUpRight /></div>
        <img className="benefits-brand-preview" src="/partners/marginnote/english.png" alt="MarginNote 阅读、摘录与知识脑图示例" />
        <p className="benefits-eyebrow">讲义阅读 · 论文笔记 · 知识整理</p><h2>3 个月 Max 订阅</h2>
        <p>阅读讲义和论文时，把摘录、笔记和知识关系整理在一起。适用于 iPad、iPhone 和 Mac。</p>
        <span className="benefits-pill"><Gift size={15} /> 共 100 个兑换码 · {marginNoteStatusLabel(status, error)}</span>
        <p className="benefits-card-condition">开放后领取兑换码，再前往 App Store 完成兑换。</p>
        <div className="benefits-card-link">查看介绍与兑换说明 <ArrowUpRight size={18} /></div>
      </Link>
    </div>
    <p className="benefits-footnote">福利规则以各活动页说明为准。请选择适合自己的工具，自愿参与领取。</p>
  </BenefitsLayout>;
}

export function XmindBenefit() {
  const { user } = useAuth();
  const { status, error: statusError, setStatus, reload: reloadStatus } = useBenefitsStatus();
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
      <div className="benefits-hero-logo"><PartnerLogo brand="xmind" size="hero" /></div>
      <p className="benefits-eyebrow">Xmind × 树仁搭子</p><h1>Xmind，<br />你的学习好搭子</h1>
      <p>把课程考点连起来，为小组汇报列提纲，<br />或参考模板安排复习。</p>
      <a className="benefits-secondary benefits-hero-link" href="#xmind-register">查看点数福利与登记方式 ↓</a>
    </div><figure className="xmind-hero-preview">
      <figcaption><span>Xmind 导图示例 · 考前复习</span><a href="https://xmind.cn/mindmaps-gallery/map/cMBtgn/" target="_blank" rel="noreferrer">查看完整模板 <ArrowUpRight size={16} /></a></figcaption>
      <a className="xmind-hero-image" href="https://xmind.cn/mindmaps-gallery/map/cMBtgn/" target="_blank" rel="noreferrer"><img src="/partners/xmind/image10.jpeg" alt="Xmind 考前复习导图：从回归课本、题型分析，到二次复习和模拟考试" width={640} height={303} fetchPriority="high" /></a>
    </figure></section>
    <section id="xmind-register" className="benefits-registration">
      <div className="benefits-claim-brand"><PartnerLogo brand="xmind" size="compact" /><span>活动点数登记</span></div>
      <ol className="benefits-flow" aria-label="Xmind 点数参与流程"><li><span>1</span>登录并浏览本页 30 秒</li><li><span>2</span>登记账号绑定手机号</li><li><span>3</span>Xmind 核对后统一充值</li></ol>
      <div className="benefits-claim-strip" aria-label="Xmind 点数登记"><span className="benefits-gift"><Sparkles size={26} /></span>
        <div className="benefits-claim-copy"><p className="benefits-eyebrow">活动福利 · 共 200 份</p><h2>{success ? '登记已提交' : '50 AI 点数'}</h2>
          <p>{success ? '本次提交已记录，后续由 Xmind 核对账号并统一充值。当前不表示点数已到账。' : full ? '200 份登记名额已满，下方的功能指南、视频和模板仍可查看。' : '登录后浏览本页满 30 秒，即可登记本人已注册 Xmind 账号绑定的手机号。'}</p>
        </div>
        {success ? <a className="benefits-secondary" href="#xmind-templates">继续查看学习模板 ↓</a> : full ? <span className="benefits-success">登记名额已满</span> : user ?
          <Button variant="primary" size="lg" disabled={!status || !!statusError || remaining > 0 || !visit || visit.userId !== user.id} onClick={() => { setError(''); setOpen(true); }}>
            {statusError ? '登记状态暂时无法加载' : !status ? '正在加载登记状态…' : !visit || visit.userId !== user.id ? '正在加载浏览计时…' : remaining > 0 ? `再浏览 ${remaining} 秒可登记` : '填写点数登记'}
          </Button> : <Link className="benefits-primary" to="/login?next=%2Fbenefits%2Fxmind">登录后开始浏览计时</Link>}
      </div>
      {!success && !full && <p className="benefits-footnote">{user ? '可继续向下查看学习示例。请保持本页打开，切换到其他标签页时计时暂停。' : '介绍、视频和模板可直接查看，登录后开始累计浏览时间。'}</p>}
      {!success && <p className="benefits-account-link">还没有 Xmind 账号？<a href="https://app.xmind.cn/" target="_blank" rel="noreferrer">前往 Xmind 注册 ↗</a></p>}
    </section>
    <div className="benefits-notice"><Clock3 size={16} /><p>到账安排与点数有效期尚未确认，以后续活动通知为准。</p></div>
    {(statusError || (error && !open)) && <div className="benefits-error" role="alert">{statusError ? '登记入口暂时未能加载，请重试。' : error} <button onClick={() => { reloadStatus(); if (user && !visit) setVisitAttempt((n) => n + 1); }}>重新加载</button></div>}
    <section id="xmind-templates" className="benefits-section benefits-featured-templates"><SectionHead number="01" title="先找一个用得上的学习模板" subtitle="梳理课程考点、阅读论文、安排考前复习，从现成框架开始。" />
      <TemplateCards items={xmindTemplates.slice(1, 4)} />
    </section>
    <section className="benefits-section"><SectionHead number="02" title="8 个功能，看看哪些适合你的学习任务" subtitle="整理提纲、标记考点、安排复习，也可以了解 AI 生成导图的用法。" />
      <div className="benefits-feature-grid">{xmindFeatures.map((item, i) => <a href={item.href} key={item.title} target="_blank" rel="noreferrer" className="benefits-feature-card"><span className="benefits-feature-number">0{i + 1}</span><ArrowUpRight size={17} /><h3>{item.title}</h3><p>{item.description}</p><span className="benefits-text-link">查看官方指南</span></a>)}</div>
    </section>
    <section className="benefits-section"><SectionHead number="03" title="官方视频，按需要选择观看" subtitle="从基础操作到读书笔记，选择与你当前任务相关的视频。" />
      <div className="benefits-video-grid">{xmindVideos.map((item) => <a className="benefits-media-card" key={item.href} href={item.href} target="_blank" rel="noreferrer"><div className="benefits-video-cover"><img src={item.image} alt={item.title} loading="lazy" /><span><Play size={20} fill="currentColor" /></span></div><div><h3>{item.title}</h3><p>{item.description}</p><span className="benefits-text-link">前往哔哩哔哩观看 ↗</span></div></a>)}</div>
    </section>
    <section className="benefits-section"><SectionHead number="04" title="更多学习模板" subtitle="读书、英语备考、考研和求职，可以从现成框架开始整理。" />
      <TemplateCards items={xmindTemplates.filter((_, i) => i < 1 || i > 3)} />
    </section>
    <section className="benefits-bottom-cta"><h2>选好学习任务，开始画你的导图。</h2><External href="https://app.xmind.cn/">前往 Xmind 使用</External></section>
    <Modal open={open} onClose={() => { if (!busy) setOpen(false); }} title="登记 50 AI 点数" dismissible={!busy}>
      <form className="benefits-form" onSubmit={submit}>
        <p>请填写本人已注册 Xmind 账号绑定的手机号。Xmind 将按此号码核对账号并统一充值，请提交前仔细核对。</p>
        <label htmlFor="xmind-phone">本人 Xmind 账号绑定手机号</label><input id="xmind-phone" type="tel" inputMode="numeric" autoComplete="tel" aria-describedby="xmind-phone-hint" placeholder="请输入 11 位手机号" pattern="1[3-9][0-9]{9}" maxLength={11} required value={phone} onChange={(e) => setPhone(e.target.value)} />
        <p id="xmind-phone-hint" className="benefits-field-hint">本页不发送短信验证码，也不核验 Xmind 账号是否存在，请自行确认账号已注册且已绑定该号码。</p>
        <label className="benefits-checkbox"><input type="checkbox" required checked={consent} onChange={(e) => setConsent(e.target.checked)} /><span>我确认已核对账号绑定号码，并同意将手机号提供给树仁活动负责人员及 Xmind 指定工作人员，仅用于本次点数发放。<Link to="/privacy" target="_blank">查看隐私说明</Link></span></label>
        {full && <p className="benefits-error" role="alert">200 份登记名额已满</p>}{error && <p className="benefits-error" role="alert">{error}</p>}
        <Button type="submit" variant="primary" loading={busy} disabled={!consent || full || !/^1[3-9]\d{9}$/.test(phone)}>{busy ? '正在提交登记…' : '提交登记'}</Button>
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
  const claimOpen = !statusError && status?.marginnote.phase === 'open';
  const availability = marginNoteStatusLabel(status, statusError);
  async function claim() {
    if (!user || busy) return;
    setBusy(true); setError('');
    try { const data = await benefitsApi.claim(); setCode({ userId: user.id, value: data.code }); benefitsApi.status().then(setStatus).catch(() => {}); }
    catch (e) { setError(errorText(e)); }
    finally { setBusy(false); }
  }
  return <BenefitsLayout>
    <section className="benefits-hero mn-hero"><div><div className="benefits-hero-logo"><PartnerLogo brand="marginnote" size="hero" /></div><p className="benefits-eyebrow">MarginNote 5 × 树仁搭子</p><h1>读讲义、看论文，<br />把重点和笔记放在一起</h1><p>在阅读中摘录重点，再整理成知识结构，方便回看与复习。<br />适用于 iPad、iPhone 和 Mac。</p>
      <div className="benefits-availability"><strong>活动福利：3 个月 Max 订阅</strong><p>共 100 个兑换码 · <span role="status">{availability}</span></p>{!statusError && status?.marginnote.phase === 'upcoming' && <p>兑换说明确认后，将在本页开放领取。</p>}</div>
      <div className="benefits-actions"><a className="benefits-primary" href="#mn-examples">查看学习示例 ↓</a><a className="benefits-secondary" href="#mn-claim">{ownCode ? '查看我的兑换码' : '查看兑换条件'} ↓</a></div></div>
      <div className="benefits-hero-art"><span className="benefits-image-label">MarginNote 5 · 英语学习示例</span><img src="/partners/marginnote/english.png" alt="MarginNote 5 英语阅读与知识整理界面" /></div>
    </section>
    <section className="benefits-section"><SectionHead number="01" title="从阅读到复习，可以这样用" subtitle="导入讲义或论文 → 摘录重点、整理笔记 → 回看原文、复习知识点" />
      <div className="benefits-steps">{[
        { Icon: BookOpen, title: '导入资料，开始阅读', text: '创建学习集，导入 PDF 讲义或学习资料。多份文档集中管理，方便对照阅读。' },
        { Icon: Layers3, title: '摘录重点，连起知识', text: '把重点摘成笔记卡片，在脑图中整理关系。笔记始终关联原文，点击即可回看。' },
        { Icon: Sparkles, title: '主动回忆，高效复习', text: '遮挡知识点，尝试自己回答；把卡片加入复习队列，按掌握程度安排复习。' },
      ].map(({ Icon, title, text }, i) => <article key={title}><span className="benefits-step-icon"><Icon size={25} /></span><p className="benefits-eyebrow">STEP 0{i + 1}</p><h3>{title}</h3><p>{text}</p></article>)}</div>
    </section>
    <section id="mn-examples" className="benefits-section"><SectionHead number="02" title="看看你正在学的课程，能怎么整理" subtitle="以下为合作方提供的笔记示例。" /><div className="benefits-video-grid">{[['english', '英语 · 把词汇放回语境'], ['anatomy', '解剖 · 看清知识之间的关系'], ['math', '高数 · 从公式到解题思路']].map(([image, title]) => <figure className="benefits-media-card" key={image}><img src={`/partners/marginnote/${image}.png`} alt={title} loading="lazy" /><figcaption><h3>{title}</h3></figcaption></figure>)}</div></section>
    <section className="benefits-resource"><div><p className="benefits-eyebrow">更多学习资源</p><h2>真题、词汇和错题，放在一起学。</h2><p>在 MarginNote 5 首页点击「更多学习集」，获取四六级、考研英语真题及高频词汇资源。也可以选择刷题卡片、外刊生词等学习场景。</p></div><img src="/partners/marginnote/resources.png" alt="在 MarginNote 首页找到更多学习集的操作示意" loading="lazy" /></section>
    <section id="mn-claim" className="benefits-mn-claim"><div className="benefits-claim-brand"><PartnerLogo brand="marginnote" /><span>订阅兑换福利</span></div><p className="benefits-eyebrow">3 个月 Max 订阅 · 共 100 个兑换码</p><h2>领取前，先确认这些条件</h2>
      <ul className="benefits-rules"><li>每个树仁搭子账号可领取 1 个兑换码。</li><li>每个 Apple 账户只能兑换 1 张，不可叠加。</li><li>兑换码需在 App Store 使用，请在 <strong>2027 年 2 月 12 日前</strong>完成兑换。</li></ul>
      <h3 className="benefits-subheading">开放后的参与流程</h3><p>登录树仁搭子 → 领取兑换码 → 在 App Store 完成兑换</p>
      <ol><li>打开 App Store，点击账号头像，选择「兑换充值卡或代码」。</li><li>输入兑换码，阅读兑换确认页显示的条件后完成兑换。</li><li>使用同一 Apple 账户打开 MarginNote 5。</li></ol>
      {status?.marginnote.renewalTerms && <p className="benefits-renewal">{status.marginnote.renewalTerms}</p>}
      {ownCode ? <div className="benefits-code"><span><Check size={17} /> 你的兑换码</span><strong>{ownCode}</strong><p>取得兑换码后，还需在 App Store 完成兑换。再次打开本页可查看同一个码。</p><Button onClick={() => { navigator.clipboard.writeText(ownCode).catch(() => setError('复制失败，请手动选择并复制兑换码')); }}>复制兑换码</Button></div>
        : !claimOpen ? <div className="benefits-availability"><strong role="status">{availability}</strong>{!statusError && status?.marginnote.phase === 'upcoming' && <p>完整兑换说明确认后，将与领取入口一同公布。</p>}</div>
        : user ? <><label className="benefits-checkbox"><input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} /><span>我已阅读兑换条件及续订说明，了解需要在 Apple 订阅设置中管理自动续订。</span></label><Button variant="primary" size="lg" onClick={claim} loading={busy} disabled={!accepted || loadedFor !== user.id}>{busy ? '正在领取兑换码…' : loadedFor !== user.id ? '正在查看领取记录…' : '领取我的兑换码'}</Button></>
        : <Link className="benefits-primary" to="/login?next=%2Fbenefits%2Fmarginnote">登录后领取兑换码</Link>}
      {(error || statusError) && <p className="benefits-error" role="alert">{error || statusError}</p>}
      <p className="benefits-footnote">使用及兑换问题，请在 MarginNote App 内「反馈与客服」联系官方。福利不支持返现或退款。</p>
    </section>
  </BenefitsLayout>;
}

function SectionHead({ number, title, subtitle }: { number: string; title: string; subtitle: string }) {
  return <header className="benefits-section-head"><span>{number}</span><div><h2>{title}</h2><p>{subtitle}</p></div></header>;
}
function TemplateCards({ items }: { items: typeof xmindTemplates }) {
  return <div className="benefits-template-grid">{items.map((item) => <a className="benefits-media-card" key={item.href} href={item.href} target="_blank" rel="noreferrer"><img src={item.image} alt={item.name} loading="lazy" /><div><span className="benefits-eyebrow">{item.category}</span><h3>{item.title}</h3><p>{item.name}</p><span className="benefits-text-link">查看模板 ↗</span></div></a>)}</div>;
}
function External({ href, primary, children }: { href: string; primary?: boolean; children: ReactNode }) {
  return <a href={href} target="_blank" rel="noreferrer" className={primary ? 'benefits-primary' : 'benefits-secondary'}>{children}<ArrowUpRight size={17} /></a>;
}
