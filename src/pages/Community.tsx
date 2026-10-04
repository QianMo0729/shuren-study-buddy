import { motion } from 'motion/react';
import { useRef, type KeyboardEvent } from 'react';
import { useSearchParams } from 'react-router';
import { cx } from '../lib/format';
import { spring } from '../lib/motion';
import { PageHeader } from '../components/ui';
import { TalkArea } from '../components/forum/TalkArea';
import { CheckinFeed } from '../components/checkin/CheckinFeed';
import { Events } from './Events';

type Tab = 'talk' | 'checkin' | 'events';
const TABS: { value: Tab; label: string }[] = [
  { value: 'talk', label: '聊天区' },
  { value: 'checkin', label: '打卡' },
  { value: 'events', label: '招募' },
];
const parseTab = (v: string | null): Tab => (TABS.some((t) => t.value === v) ? (v as Tab) : 'talk');

/** 校园社区：聊天区（分享生活）、打卡（实时拍照、服务器盖章）、招募（原活动大厅） */
export function Community() {
  const [params, setParams] = useSearchParams();
  const tab = parseTab(params.get('tab'));
  const refs = useRef<Record<Tab, HTMLButtonElement | null>>({ talk: null, checkin: null, events: null });

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
      <PageHeader title="校园社区" desc="在聊天区分享校园生活，用实时拍照打卡记录学习，或者发起一场学习招募。" className="mb-0! border-b-0! pb-3!" />
      <div className="sticky top-14 z-30 mb-5 border-b border-ink bg-paper">
        <div role="tablist" aria-label="社区分区" className="flex gap-7" onKeyDown={onKeyDown}>
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
                className={cx('relative py-3 text-[15px] transition-colors', on ? 'font-semibold text-ink' : 'text-ink-3 hover:text-ink')}
              >
                {t.label}
                {on && <motion.span layoutId="community-tab" transition={spring} className="absolute inset-x-0 -bottom-px h-[3px] bg-ink" />}
              </button>
            );
          })}
        </div>
      </div>
      <div role="tabpanel" id="community-panel" aria-labelledby={`community-tab-${tab}`}>
        {tab === 'talk' ? <TalkArea /> : tab === 'checkin' ? <CheckinFeed /> : <Events embedded />}
      </div>
    </div>
  );
}
