import { motion } from 'motion/react';
import { useRef, type KeyboardEvent } from 'react';
import { useSearchParams } from 'react-router';
import { cx } from '../lib/format';
import { spring } from '../lib/motion';
import { PageHeader } from '../components/ui';
import { TalkArea } from '../components/forum/TalkArea';
import { CheckinFeed } from '../components/checkin/CheckinFeed';
import { Events } from './Events';
import { Leaderboard } from '../components/buddy/Leaderboard';

type Tab = 'talk' | 'checkin' | 'board' | 'events';
const TABS: { value: Tab; label: string }[] = [
  { value: 'talk', label: '聊天区' },
  { value: 'checkin', label: '打卡' },
  { value: 'board', label: '搭子榜' },
  { value: 'events', label: '招募' },
];
const parseTab = (v: string | null): Tab => (TABS.some((t) => t.value === v) ? (v as Tab) : 'talk');

/** 校园社区：聊天区（分享生活）、打卡（实时拍照、服务器盖章）、招募（原活动大厅） */
export function Community() {
  const [params, setParams] = useSearchParams();
  const tab = parseTab(params.get('tab'));
  const refs = useRef<Record<Tab, HTMLButtonElement | null>>({ talk: null, checkin: null, board: null, events: null });

  const select = (next: Tab, focus = false) => {
    setParams((p) => {
      const out = new URLSearchParams(p);
      out.set('tab', next);
      return out;
    }, { replace: true });
    if (focus) refs.current[next]?.focus();
  };

  // 方向键在标签间移动（WAI-ARIA tabs 模式）
  const onKeyDown = (e: KeyboardEvent) => {
    const i = TABS.findIndex((t) => t.value === tab);
    const to = e.key === 'ArrowRight' ? (i + 1) % TABS.length : e.key === 'ArrowLeft' ? (i - 1 + TABS.length) % TABS.length : e.key === 'Home' ? 0 : e.key === 'End' ? TABS.length - 1 : -1;
    if (to < 0) return;
    e.preventDefault();
    select(TABS[to].value, true);
  };

  return (
    <div>
      <PageHeader title="社区" className="mb-3!" />
      <div className="glass sticky top-[var(--topbar-h)] z-30 -mx-4 mb-5 px-4 py-2 sm:-mx-6 sm:px-6 md:mx-0 md:px-0">
        <div role="tablist" aria-label="社区分区" className="grid h-9 max-w-md grid-cols-4 rounded-[10px] bg-paper-2 p-0.5" onKeyDown={onKeyDown}>
          {TABS.map((t) => {
            const on = t.value === tab;
            return (
              <button
                key={t.value}
                ref={(el) => { refs.current[t.value] = el; }}
                type="button"
                role="tab"
                id={`community-tab-${t.value}`}
                aria-selected={on}
                aria-controls="community-panel"
                tabIndex={on ? 0 : -1}
                onClick={() => select(t.value)}
                className={cx('relative rounded-[8px] text-[13.5px] transition-colors', on ? 'font-semibold text-ink' : 'text-ink-2 hover:text-ink')}
              >
                {on && <motion.span layoutId="community-tab" transition={spring} className="absolute inset-0 rounded-[8px] bg-surface shadow-[0_2px_6px_rgba(28,35,32,0.12)]" />}
                <span className="relative">{t.label}</span>
              </button>
            );
          })}
        </div>
      </div>
      <div role="tabpanel" id="community-panel" aria-labelledby={`community-tab-${tab}`}>
        {tab === 'talk' ? <TalkArea /> : tab === 'checkin' ? <CheckinFeed /> : tab === 'board' ? <Leaderboard /> : <Events embedded />}
      </div>
    </div>
  );
}
