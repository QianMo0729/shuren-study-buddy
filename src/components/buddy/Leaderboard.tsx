import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { shortDate, addDays } from '../../../shared/activity';
import type { LeaderboardResponse } from '../../../shared/types';
import { api, ApiError } from '../../lib/api';
import { cx } from '../../lib/format';
import { Nickname } from '../ProfileCard';
import { Button, Empty, Skeleton } from '../ui';

/** 社区 · 搭子榜：只显示名次和两人的昵称，不显示分数；每周一更新上一周的结果 */
export function Leaderboard() {
  const [data, setData] = useState<LeaderboardResponse | null>(null);
  const [error, setError] = useState('');
  const load = () => api.activity.leaderboard().then((r) => { setData(r); setError(''); }).catch((e) => setError(e instanceof ApiError ? e.message : '加载失败'));
  useEffect(() => { void load(); }, []);

  if (error && !data) return <Empty title="搭子榜加载失败" desc={error} action={<Button onClick={() => void load()}>重试</Button>} />;
  if (!data) return <div className="space-y-2">{Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-14 rounded-md" />)}</div>;

  const { season, through, items } = data;
  const note = through
    ? `统计到 ${shortDate(through)}（周日），每周一更新。名次相同表示并列。`
    : `赛季从 ${shortDate(season.start)} 开始，第一周结束后（${shortDate(addDays(season.start, 7))}）显示名次。`;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-[13.5px] text-ink-3">{note}</p>
        <Link to="/rules" className="text-[13px] text-brand-text underline-offset-2 hover:underline">计分与评奖规则</Link>
      </div>
      {!items.length ? (
        <Empty
          title={through ? '还没有组合上榜' : '赛季还没开始'}
          desc="绑定搭子后，两人在约定时间内各自拍照打卡，完成的周会计入排名。"
          action={<Link to="/me" className="inline-flex h-10 items-center rounded-md border border-line-strong bg-surface px-4 text-[14px] font-semibold text-ink hover:bg-surface-2">去绑定搭子</Link>}
        />
      ) : (
        <ol className="divide-y divide-line rounded-md border border-line bg-surface">
          {items.map((item, index) => (
            <li key={index} className={cx('flex items-center gap-4 px-4 py-3', item.mine && 'bg-brand-softer')}>
              <span className={cx('w-12 shrink-0 font-display tabular', item.rank <= 3 ? 'text-[24px] text-seal' : 'text-[19px] text-ink-3')}>
                {item.rank}
                {item.tied && <span className="ml-0.5 align-top font-sans text-[11px] text-ink-4">并列</span>}
              </span>
              <span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
                <Nickname name={item.members[0].nickname} size={16} />
                <span className="text-[12px] text-ink-4">&</span>
                <Nickname name={item.members[1].nickname} size={16} />
              </span>
              {item.mine && <span className="shrink-0 text-[12px] font-semibold text-brand-text">我们</span>}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
