import { useCallback, useEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react';
import { Link } from 'react-router';
import { motion, useReducedMotion } from 'motion/react';
import { Check, ChevronRight } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { benefitsApi, useBenefitsStatus, useXmindClaim } from '../lib/benefits';
import { ease } from '../lib/motion';
import { Stamp } from './brand';
import { useIsMobile } from './ui';
import './benefit-tickets.css';

const MARGINNOTE_TOTAL = 100;

/** 「今天」页和首页上的品牌合作入口：每个福利是一张票，领过的票打勾、盖「已领」章。 */
export function BenefitBanner() {
  const { user } = useAuth();
  const { status } = useBenefitsStatus();
  const mobile = useIsMobile();
  const xmindClaimed = !!useXmindClaim(user).registration;
  const marginNoteClaimed = useMarginNoteClaimed(user?.id);

  const xmind = status?.xmind;
  const mn = status?.marginnote;
  const tickets = [
    <Ticket key="xmind" to="/benefits/xmind" amount="50" unit="AI 点数" name="Xmind" claimed={xmindClaimed}
      rule={xmindClaimed ? '已登记，等待统一充值' : xmind && !xmind.open ? '即将开放，可以先看看介绍' : '浏览活动页 30 秒即可领取'}
      meta={!xmind ? '共 200 份' : xmind.remaining === 0 ? `名额已满 · 共 ${xmind.limit} 份` : `还剩 ${xmind.remaining} 份 · 共 ${xmind.limit} 份`}
      action={!xmind || !xmind.open || xmind.remaining === 0 ? '查看' : '领取'} />,
    <Ticket key="marginnote" to="/benefits/marginnote" amount="3" unit="个月 Max 订阅" name="MarginNote" claimed={marginNoteClaimed}
      rule={marginNoteClaimed ? '兑换码已领取，到 App Store 兑换' : mn?.phase === 'open' ? '看完宣传片即可领取兑换码' : '读讲义和论文的笔记工具'}
      meta={!mn ? `共 ${MARGINNOTE_TOTAL} 个` : mn.phase === 'open' ? `还剩 ${mn.remaining} 个 · 共 ${MARGINNOTE_TOTAL} 个` : { upcoming: '暂未开放领取', exhausted: '本批兑换码已领完', ended: '活动已结束' }[mn.phase]}
      action={mn?.phase === 'open' ? '领取' : '查看'} />,
  ];

  return <section aria-labelledby="benefit-title" className="flex flex-col gap-2.5">
    <div className="flex items-baseline justify-between px-1">
      <h2 id="benefit-title" className="text-[22px] font-bold text-ink">品牌合作</h2>
      <span className="text-[13px] text-ink-3">广告</span>
    </div>
    {/* 手机上两张票叠在一起轮流出现，省出一张票的高度；宽屏并排 */}
    {mobile ? <TicketDeck labels={['Xmind', 'MarginNote']}>{tickets}</TicketDeck> : <div className="grid grid-cols-2 gap-3">{tickets}</div>}
  </section>;
}

function useMarginNoteClaimed(userId: number | undefined) {
  const [claimedBy, setClaimedBy] = useState<number | null>(null);
  useEffect(() => {
    if (userId === undefined) return;
    let active = true;
    benefitsApi.myCode().then((data) => { if (active && data.code) setClaimedBy(userId); }).catch(() => { /* 读不到就按未领取显示，活动页里会再读一次 */ });
    return () => { active = false; };
  }, [userId]);
  return userId !== undefined && claimedBy === userId;
}

function Ticket({ to, amount, unit, name, rule, meta, action, claimed }: { to: string; amount: string; unit: string; name: string; rule: string; meta: string; action: string; claimed: boolean }) {
  return <Link to={to} className="ticket" data-claimed={claimed || undefined} draggable={false} aria-label={`${name}：${amount} ${unit}，${claimed ? '已领取' : rule}`}>
    <span className="ticket-stub"><strong>{amount}</strong><small>{unit}</small></span>
    <span className="ticket-body">
      <span className="ticket-name"><span className="ticket-check" aria-hidden="true">{claimed && <Check size={14} strokeWidth={3.2} />}</span>{name}</span>
      <span className="ticket-rule">{rule}</span>
      <span className="ticket-meta">{meta}</span>
    </span>
    {claimed ? <Stamp text="已领" size={40} white={false} rotate={-9} className="ticket-stamp" /> : <span className="ticket-action">{action}<ChevronRight size={17} aria-hidden="true" /></span>}
  </Link>;
}

const ROTATE_MS = 5000;
const FRONT = { y: 0, scale: 1, opacity: 1 };
// 让出位置的那张先向上淡出，再从下方回到底层露出一条边
const TUCK = { y: [0, -14, 22, 9], scale: [1, 1, 0.94, 0.94], opacity: [1, 0, 0, 1] };
const TUCK_TIMES = [0, 0.32, 0.34, 1];
const BACK_STILL = { y: 9, scale: 0.94, opacity: 1 };

function TicketDeck({ children, labels }: { children: ReactNode[]; labels: string[] }) {
  const count = children.length;
  const [active, setActive] = useState(0);
  const [held, setHeld] = useState(false);
  const reduce = useReducedMotion();
  const go = useCallback((index: number) => setActive(((index % count) + count) % count), [count]);

  // 自动轮换：按住、聚焦或页面在后台时暂停；手动翻页后重新计时。系统设置了「减少动态效果」时不自动轮换
  useEffect(() => {
    if (held || reduce || count < 2) return;
    const timer = window.setInterval(() => { if (!document.hidden) setActive((i) => (i + 1) % count); }, ROTATE_MS);
    return () => window.clearInterval(timer);
  }, [held, reduce, count, active]);

  // 左右滑动翻页；滑动之后那一下松手不算点击，不会误进活动页
  const start = useRef<{ x: number; y: number } | null>(null);
  const swiped = useRef(false);
  function release(event: PointerEvent) {
    const from = start.current;
    start.current = null;
    setHeld(false);
    if (!from) return;
    const dx = event.clientX - from.x, dy = event.clientY - from.y;
    if (Math.abs(dx) > 36 && Math.abs(dx) > Math.abs(dy) * 1.5) { swiped.current = true; go(active + (dx < 0 ? 1 : -1)); }
  }

  return <div className="ticket-deck" role="group" aria-roledescription="轮播" aria-label="品牌合作福利"
    onPointerDown={(event) => { start.current = { x: event.clientX, y: event.clientY }; swiped.current = false; setHeld(true); }}
    onPointerUp={release} onPointerCancel={() => { start.current = null; setHeld(false); }} onPointerLeave={() => { if (!start.current) setHeld(false); }}
    onFocus={() => setHeld(true)} onBlur={() => setHeld(false)}
    onClickCapture={(event) => { if (swiped.current) { swiped.current = false; event.preventDefault(); event.stopPropagation(); } }}>
    <div className="ticket-deck-stack">
      {children.map((child, index) => {
        const front = index === active;
        return <motion.div key={index} className="ticket-deck-card" data-front={front || undefined} inert={!front} aria-hidden={!front} initial={false}
          animate={front ? FRONT : reduce ? BACK_STILL : TUCK}
          transition={reduce ? { duration: 0 } : front ? { duration: 0.32, ease } : { duration: 0.55, times: TUCK_TIMES, ease: 'easeOut' }}>{child}</motion.div>;
      })}
    </div>
    <div className="ticket-deck-dots">
      {labels.map((label, index) => <button key={label} type="button" aria-label={`第 ${index + 1} 张：${label}`} aria-current={index === active || undefined} onClick={() => go(index)} />)}
    </div>
  </div>;
}
