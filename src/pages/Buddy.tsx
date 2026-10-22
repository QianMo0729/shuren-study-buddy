import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import { DAYS } from '../../shared/options';
import { shortDate } from '../../shared/activity';
import type { BuddyStatus, Checkin } from '../../shared/types';
import { api, ApiError } from '../lib/api';
import { useActivityConfig } from '../lib/activity';
import { useToast } from '../lib/toast';
import { Plate } from '../components/brand';
import { MeAvatar, NavBar } from '../components/Shell';
import { splitNickname } from '../components/ProfileCard';
import { Button, ConfirmDialog, GroupList, Skeleton } from '../components/ui';
import { Chevron } from '../components/icons';
import { ShurenChoice, useBuddyActions } from '../components/buddy/BuddyActions';

const DAY = 86_400_000;
const bjDate = (t: number) => new Date(t + 8 * 3_600_000).toISOString().slice(0, 10);
const hm = (iso: string) => new Date(Date.parse(iso) + 8 * 3_600_000).toISOString().slice(11, 16);
const errorText = (e: unknown) => (e instanceof ApiError ? e.message : '网络连接失败，请稍后重试');

type Together = { day: number; place: string; mine: string; theirs: string };

/** 我的搭子：两人的本周进度、本周同时打卡记录、约时间、规则、解除绑定；没有搭子时处理邀请 */
export function Buddy() {
  const toast = useToast();
  const nav = useNavigate();
  const [status, setStatus] = useState<BuddyStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [unbinding, setUnbinding] = useState(false);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => api.activity.me().then((s) => { setStatus(s); setError(null); }).catch((e) => setError(errorText(e))), []);
  useEffect(() => { void load(); }, [load]);
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

      {error && !status ? (
        <p className="mt-6 text-[15px] text-ink-2">加载失败：{error}<Button size="sm" className="ml-2" onClick={() => void load()}>重试</Button></p>
      ) : !status ? (
        <Skeleton className="mt-6 h-80 rounded-[22px]" />
      ) : pair ? (
        <Paired status={status} onUnbind={() => setUnbinding(true)} />
      ) : (
        <Unpaired status={status} actions={actions} />
      )}

      {status && (
        <div className="mt-6 px-4 pb-4 text-[13px] text-ink-3">
          {status.shurenMember ? (
            <>已登记为{status.shurenMember === 'yes' ? '树仁书院学生' : '非树仁书院学生'}</>
          ) : (
            <ShurenChoice value={null} onChange={(v) => void api.activity.setCollege(v).then(setStatus).catch((e) => toast.error('保存失败', errorText(e)))} />
          )}
        </div>
      )}

      {actions.dialog}
      <ConfirmDialog
        open={unbinding}
        title="解除搭子绑定？"
        desc="解除后立即生效，你们两人的搭子积分都会清零，组合从搭子榜移除，对方会收到通知。私聊不受影响。之后和任何人重新绑定，都从下一个周一开始重新计分。"
        confirmText="解除绑定"
        tone="danger"
        loading={busy}
        onCancel={() => !busy && setUnbinding(false)}
        onConfirm={() => void unbind()}
      />
    </div>
  );
}

function Paired({ status, onUnbind }: { status: BuddyStatus; onUnbind: () => void }) {
  const pair = status.pair!;
  const { week, rank } = status;
  const { config } = useActivityConfig();
  const [rows, setRows] = useState<Together[] | null>(null);
  const today = bjDate(Date.now());
  const weekNo = pair.started ? Math.floor((Date.parse(today) - Date.parse(pair.startsOn)) / (7 * DAY)) + 1 : 0;
  const days = Math.max(1, Math.floor((Date.now() - Date.parse(pair.createdAt)) / DAY));
  const created = new Date(Date.parse(pair.createdAt) + 8 * 3_600_000);

  // 本周同时打卡：同一天两人在规定分钟内各自打卡（与计分规则同一口径，判无效的除外）
  useEffect(() => {
    if (!week) { setRows([]); return; }
    let live = true;
    const inWeek = (c: Checkin) => !c.invalid && bjDate(Date.parse(c.stampedAt)) >= week.start && bjDate(Date.parse(c.stampedAt)) <= week.end;
    Promise.all([api.checkins.list({ scope: 'mine' }), api.checkins.list({ scope: 'buddies' })]).then(([mine, buddies]) => {
      if (!live) return;
      const theirs = buddies.items.filter((c) => c.author.id === pair.partner.id && inWeek(c));
      const out: Together[] = [];
      const used = new Set<number>();
      for (const c of mine.items.filter(inWeek)) {
        const t = Date.parse(c.stampedAt);
        const hit = theirs.find((o) => !used.has(o.id) && bjDate(Date.parse(o.stampedAt)) === bjDate(t) && Math.abs(Date.parse(o.stampedAt) - t) <= config.windowMinutes * 60_000);
        if (!hit) continue;
        used.add(hit.id);
        out.push({ day: (new Date(t + 8 * 3_600_000).getUTCDay() + 6) % 7, place: c.placeLabel, mine: hm(c.stampedAt), theirs: hm(hit.stampedAt) });
      }
      setRows(out);
    }).catch(() => { if (live) setRows([]); });
    return () => { live = false; };
  }, [week, pair.partner.id, config.windowMinutes]);

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
            {created.getUTCMonth() + 1}月{created.getUTCDate()}日绑定 · {weekNo > 0 ? `第 ${weekNo} 个计分周` : `${shortDate(pair.startsOn)}（周一）开始计分`}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2.5">
        <Tile label="本周同时打卡" value={week ? <><span className="text-brand-text">{week.count}</span><Unit>/{week.cap}</Unit></> : '—'} />
        <Tile label="已绑定" value={<>{days}<Unit> 天</Unit></>} />
        <Link to="/community?tab=board" className="block">
          <Tile label="搭子榜" value={rank ? <>{rank.rank}<Unit> 名</Unit></> : '—'} />
        </Link>
      </div>
      {pair.ineligible && <p className="-mt-3 px-4 text-[13px] text-danger">{pair.ineligible}</p>}

      <section className="flex flex-col gap-2">
        <h2 className="px-4 text-[13px] font-medium text-ink-3">本周同时打卡</h2>
        <GroupList>
          {rows === null ? (
            <div className="p-4"><Skeleton className="h-10 rounded-lg" /></div>
          ) : rows.length ? (
            rows.map((r, i) => (
              <div key={i} className="flex min-h-11 items-center gap-3 px-4 py-3">
                <span className="w-10 text-[15px] font-semibold text-ink">{DAYS[r.day]}</span>
                <span className="flex min-w-0 flex-1 flex-col gap-px">
                  <span className="truncate text-[15px] text-ink">{r.place}</span>
                  <span className="text-[13px] text-ink-3 tabular">{r.mine} / {r.theirs} · 相同事件</span>
                </span>
              </div>
            ))
          ) : (
            <p className="px-4 py-3 text-[15px] text-ink-3">{week ? '本周还没有同时打卡。' : '计分开始后，这里会列出你们同时打卡的记录。'}</p>
          )}
        </GroupList>
      </section>

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
