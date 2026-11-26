import { useEffect, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import { DAYS } from '../../shared/options';
import { beijingDay, mondayOf, shortDate, weekdayLabel } from '../../shared/activity';
import type { BuddyStatus } from '../../shared/types';
import { api, ApiError } from '../lib/api';
import { useToast } from '../lib/toast';
import { useBuddyStatus } from '../lib/useBuddyStatus';
import { useActivityConfig } from '../lib/activity';
import { Plate } from '../components/brand';
import { MeAvatar, NavBar } from '../components/Shell';
import { splitNickname } from '../components/ProfileCard';
import { Button, ConfirmDialog, GroupList, Skeleton, Toggle } from '../components/ui';
import { Chevron } from '../components/icons';
import { buddyDayStatus } from '../components/checkin/buddyCheckinHint';
import { useBuddyActions } from '../components/buddy/BuddyActions';

const DAY = 86_400_000;
const bjDate = (t: number) => new Date(t + 8 * 3_600_000).toISOString().slice(0, 10);
const errorText = (e: unknown) => (e instanceof ApiError ? e.message : '网络连接失败，请稍后重试');

/** 我的搭子：两人的本周进度、本周同时打卡记录、约时间、规则、解除绑定；没有搭子时处理邀请 */
export function Buddy() {
  const toast = useToast();
  const nav = useNavigate();
  const { data: status, readAt, error, reload: load, setData: setStatus } = useBuddyStatus();
  const [unbinding, setUnbinding] = useState(false);
  const [busy, setBusy] = useState(false);
  const actions = useBuddyActions((s) => { setStatus(s); if (s.matchId) nav(`/messages/${s.matchId}`); });

  const unbind = async () => {
    setBusy(true);
    try {
      setStatus(await api.activity.unbind());
      setUnbinding(false);
      toast.success('已解除绑定', '你们的搭子积分已清零');
    } catch (cause) {
      toast.error('操作失败', errorText(cause));
    } finally {
      setBusy(false);
    }
  };

  const pair = status?.pair;
  return (
    <div className="mx-auto max-w-[560px] pt-[env(safe-area-inset-top)] md:pt-8">
      <NavBar label="今天" to="/today" right={pair?.matchId ? <Link to={`/messages/${pair.matchId}`} className="flex h-11 items-center px-1 text-[17px] text-brand-text">私聊</Link> : null} />

      {!!error && !status ? (
        <p className="mt-6 text-[15px] text-ink-2">加载失败：{errorText(error)}<Button size="sm" className="ml-2" onClick={() => void load()}>重试</Button></p>
      ) : !status ? (
        <Skeleton className="mt-6 h-80 rounded-[22px]" />
      ) : pair ? (
        <Paired status={status} readAt={readAt} refreshFailed={!!error} onUnbind={() => setUnbinding(true)} onStatus={setStatus} />
      ) : (
        <Unpaired status={status} actions={actions} />
      )}

      {status && (
        <div className="mt-6 px-4 pb-4 text-[13px] text-ink-3">
          按学号判断：{status.shurenMember === 'yes' ? '树仁书院学生' : '非树仁书院学生（组合里至少一人是树仁学生才能参与排名）'}
        </div>
      )}

      {actions.dialog}
      <ConfirmDialog
        open={unbinding}
        title="解除搭子绑定？"
        desc={`解除后立即生效，你们两人的搭子积分都会清零，组合退出排名，对方会收到通知。私聊不受影响。${status && beijingDay() < status.season.start
          ? `之后和任何人重新绑定，都从 0 分算起：赛季开始前绑定的从 ${shortDate(status.season.start)}（${weekdayLabel(status.season.start)}）开始计分，之后绑定的从下一个周一开始。`
          : '之后和任何人重新绑定，都从下一个周一开始重新计分。'}`}
        confirmText="解除绑定"
        tone="danger"
        loading={busy}
        onCancel={() => !busy && setUnbinding(false)}
        onConfirm={() => void unbind()}
      />
    </div>
  );
}

function Paired({ status, readAt, refreshFailed, onUnbind, onStatus }: {
  status: BuddyStatus; readAt: number | null; refreshFailed: boolean; onUnbind: () => void; onStatus: (s: BuddyStatus) => void;
}) {
  const pair = status.pair!;
  const { week, rank, score } = status;
  const { config } = useActivityConfig();
  const today = bjDate(Date.now());
  const weekNo = pair.started ? Math.floor((Date.parse(today) - Date.parse(mondayOf(pair.startsOn))) / (7 * DAY)) + 1 : 0;
  const hint = readAt && status.today?.date === today ? buddyDayStatus(status, config, readAt) : null;
  const todayEvent = week?.events.some((event) => event.date === today);
  const days = Math.max(1, Math.floor((Date.now() - Date.parse(pair.createdAt)) / DAY));
  const created = new Date(Date.parse(pair.createdAt) + 8 * 3_600_000);
  const weekday = (date: string) => (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7;

  return (
    <div className="mt-1.5 flex flex-col gap-[22px]">
      <div className="flex flex-col items-center gap-2.5">
        <div className="flex">
          <MeAvatar className="size-[76px] border-[3px] border-paper" />
          <Plate nickname={pair.partner.nickname} photo={pair.partner.cover} className="-ml-[18px] size-[76px] overflow-hidden rounded-full border-[3px] border-paper bg-mat" pad="0" fit="cover" />
        </div>
        <div className="flex flex-col items-center gap-0.5">
          <MyWord partner={pair.partner.nickname} />
          <p className="text-[14px] text-ink-3">
            {created.getUTCMonth() + 1}月{created.getUTCDate()}日绑定 · 已 {days} 天{weekNo > 0 && ` · 第 ${weekNo} 个计分周`}
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <div className="grid grid-cols-3 gap-2.5">
          <Tile label="累计积分" value={score ? <>{score.total}<Unit> 分</Unit></> : '—'} />
          <Tile label="本周同时打卡" value={week ? <><span className="text-brand-text">{week.count}</span><Unit>/{week.cap}</Unit></> : '—'} />
          <Tile label="我们的名次" value={rank ? <>{rank.rank}<Unit> 名{rank.tied ? '·并列' : ''}</Unit></> : '—'} />
        </div>
        <p className="px-4 text-[13px] leading-relaxed text-ink-3">
          {scoreNote(status)}
        </p>
        {pair.ineligible && <p className="px-4 text-[13px] text-danger">{pair.ineligible}</p>}
      </div>

      <section className="flex flex-col gap-2">
        <h2 className="px-4 text-[13px] font-medium text-ink-3">本周同时打卡</h2>
        <GroupList>
          {refreshFailed && <p role="status" className="px-4 py-3 text-[14px] text-ink-3">暂时无法更新今天的打卡结果。</p>}
          {hint && !todayEvent && (
            <p role="status" className={`px-4 py-3 text-[14px] leading-relaxed ${hint.tone === 'warn' ? 'text-accent-text' : 'text-ink-2'}`}>{hint.text}</p>
          )}
          {week?.events.map((e) => (
            <div key={e.date} className="flex min-h-11 items-center gap-3 px-4 py-3">
              <span className="w-10 text-[15px] font-semibold text-ink">{e.date === today ? '今天' : DAYS[weekday(e.date)]}</span>
              <span className="flex min-w-0 flex-1 flex-col gap-px">
                <span className="truncate text-[15px] text-ink">{e.place}</span>
                <span className="text-[13px] text-ink-3 tabular">我 {e.mine}{e.mineReplacement && '（补拍）'} / 搭子 {e.theirs}{e.theirsReplacement && '（补拍）'}{e.distance !== null && ` · 相距约 ${e.distance} 米`} · 算一次</span>
              </span>
            </div>
          ))}
          {!refreshFailed && readAt !== null && !hint && !week?.events.length && <p className="px-4 py-3 text-[15px] text-ink-3">本周还没有同时打卡记录。</p>}
        </GroupList>
      </section>

      <ShowOnProfile status={status} onStatus={onStatus} />

      <section className="flex flex-col gap-2">
        <GroupList>
          {pair.matchId && <Row to={`/messages/${pair.matchId}`}>约时间打卡</Row>}
          <Row to="/rules">活动规则</Row>
        </GroupList>
        <GroupList>
          <button type="button" onClick={onUnbind} className="h-[46px] w-full px-4 text-left text-[17px] text-danger">解除搭子绑定</button>
        </GroupList>
      </section>
    </div>
  );
}

/** 在主页上公开「我们是搭子」：两人都打开后，双方主页上显示对方；只有一人打开时谁的主页都不显示 */
function ShowOnProfile({ status, onStatus }: { status: BuddyStatus; onStatus: (s: BuddyStatus) => void }) {
  const toast = useToast();
  const pair = status.pair!;
  const { mine, partner } = pair.showOnProfile;
  const [busy, setBusy] = useState(false);
  const name = splitNickname(pair.partner.nickname).word;
  const change = async (show: boolean) => {
    if (busy) return;
    setBusy(true);
    try {
      onStatus(await api.activity.showOnProfile(show));
    } catch (e) {
      toast.error('保存失败', errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const note = mine && partner
    ? '已公开：别人打开你们的主页时，会看到你们是搭子。'
    : mine
      ? `${name} 还没打开。两人都打开后才会显示，现在谁的主页上都不显示。`
      : partner
        ? `${name} 已经打开了。你也打开后，你们的主页上会互相显示。`
        : '两人都打开后，你们的主页上会显示对方是自己的搭子。关闭时只显示「已有搭子」。';
  return (
    <section className="flex flex-col gap-2">
      <GroupList>
        <div className="flex min-h-11 items-center justify-between gap-3 px-4 py-2.5">
          <span className="text-[17px] text-ink">在主页上显示我们是搭子</span>
          <Toggle checked={mine} onChange={(v) => void change(v)} label={<span className="sr-only">在主页上显示我们是搭子</span>} />
        </div>
      </GroupList>
      <p className="px-4 text-[13px] leading-relaxed text-ink-3">{note}</p>
    </section>
  );
}

/** 积分与名次的说明：只统计已结束的周，本周的分数周一结算；名次只有自己看得到 */
function scoreNote(status: BuddyStatus): string {
  const { week, rank, score, season } = status;
  const parts: string[] = [];
  if (score?.through) parts.push(`积分统计到 ${shortDate(score.through)}（周日），每周一结算`);
  else if (season.status !== 'ended') parts.push('第一周结束后（周一）开始显示积分和名次');
  if (week) parts.push(`本周 ${week.count} 次，结算后 +${week.points} 分${week.bonus ? `，另有 Bonus +${week.bonus}` : ''}`);
  if (rank) parts.push(`共 ${rank.total} 组上榜，名次只有你们自己看得到`);
  return `${parts.join('；')}。`;
}

/** 「白鹭 & 木棉」：两人昵称里的物种名 */
function MyWord({ partner }: { partner: string }) {
  return <MeWord>{(me) => <h1 className="text-[22px] font-bold text-ink">{me} & {splitNickname(partner).word}</h1>}</MeWord>;
}
function MeWord({ children }: { children: (word: string) => ReactNode }) {
  const [word, setWord] = useState('我');
  useEffect(() => { api.myProfile().then((r) => setWord(splitNickname(r.profile.nickname).word)).catch(() => {}); }, []);
  return <>{children(word)}</>;
}

function Unpaired({ status, actions }: { status: BuddyStatus; actions: ReturnType<typeof useBuddyActions> }) {
  const incoming = status.invites.filter((i) => i.direction === 'incoming');
  const outgoing = status.invites.filter((i) => i.direction === 'outgoing');
  return (
    <div className="mt-1.5 flex flex-col gap-[22px]">
      <div className="flex flex-col items-center gap-2.5 pt-2">
        <MeAvatar className="size-[76px]" />
        <h1 className="text-[22px] font-bold text-ink">还没有学习搭子</h1>
        <p className="px-6 text-center text-[14px] leading-relaxed text-ink-3">在私聊或对方主页上点「邀请成为搭子」；已经认识的同学，可以按 ID 找到对方。</p>
      </div>
      {incoming.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="px-4 text-[13px] font-medium text-ink-3">收到的邀请</h2>
          <GroupList>
            {incoming.map((invite) => (
              <div key={invite.id} className="flex items-center gap-3 px-4 py-3">
                <Plate nickname={invite.other.nickname} photo={invite.other.cover} className="size-10 shrink-0 overflow-hidden rounded-full bg-mat" pad="0" fit="cover" />
                <span className="min-w-0 flex-1 truncate text-[15px] text-ink">{invite.other.nickname}</span>
                <Button size="sm" disabled={actions.busy} onClick={() => void actions.decline(invite.id)}>婉拒</Button>
                <Button size="sm" variant="primary" onClick={() => actions.accept(invite.id, invite.other.nickname)}>接受</Button>
              </div>
            ))}
          </GroupList>
        </section>
      )}
      {outgoing.length > 0 && (
        <GroupList>
          {outgoing.map((invite) => (
            <div key={invite.id} className="flex items-center gap-3 px-4 py-3 text-[15px] text-ink-3">
              <span className="min-w-0 flex-1 truncate">已邀请 {invite.other.nickname}，等待回应</span>
              <button type="button" disabled={actions.busy} className="text-brand-text" onClick={() => void actions.cancel(invite.id)}>撤回</button>
            </div>
          ))}
        </GroupList>
      )}
      <GroupList>
        <Row to="/match">去找搭子</Row>
        <Row to="/match/search">按 ID 找同学</Row>
        <Row to="/rules">活动规则</Row>
      </GroupList>
    </div>
  );
}

function Tile({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex flex-col gap-1 rounded-2xl bg-surface px-3 py-3.5">
      <span className="text-[12px] text-ink-3">{label}</span>
      <span className="text-[26px] leading-none font-bold text-ink tabular">{value}</span>
    </div>
  );
}
const Unit = ({ children }: { children: ReactNode }) => <span className="text-[14px] font-medium text-ink-3">{children}</span>;

function Row({ to, children, value }: { to: string; children: ReactNode; value?: ReactNode }) {
  return (
    <Link to={to} className="flex h-[46px] items-center gap-3 px-4 text-[17px] text-ink active:bg-paper">
      <span className="flex-1">{children}</span>
      {value && <span className="text-[15px] text-ink-3">{value}</span>}
      <Chevron />
    </Link>
  );
}
