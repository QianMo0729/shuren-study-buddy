import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { ExternalLink } from 'lucide-react';
import {
  BONUS_REJECT_REASONS, SENSITIVE_CATEGORIES, SENSITIVE_LABELS, BLOCKED_CATEGORIES, shortDate, validateActivityConfig,
  type ActivityConfig, type SensitiveCategory,
} from '../../shared/activity';
import { ROLE_LABELS } from '../../shared/roles';
import type { Role } from '../../shared/types';
import {
  api, ApiError, fileUrl, type AdminAppeal, type AdminAudit, type AdminBoardItem, type AdminBonus, type AdminCheckinView, type AdminStaff,
} from '../lib/api';
import { forgetActivityConfig } from '../lib/activity';
import { cx, dateTime, timeAgo } from '../lib/format';
import { useToast } from '../lib/toast';
import { Button, ConfirmDialog, Empty, Field, Input, Modal, Segmented, Skeleton, Tag, Textarea } from '../components/ui';
import { InvalidateDialog } from '../components/checkin/Invalidation';

const errorText = (e: unknown) => (e instanceof ApiError ? e.message : '请稍后重试');

function useLoad<T>(fn: () => Promise<T>, deps: unknown[]) {
  const toast = useToast();
  const [data, setData] = useState<T | null>(null);
  const load = useCallback(() => fn().then(setData).catch((e) => toast.error('加载失败', errorText(e))), deps); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setData(null); void load(); }, [load]);
  return { data, load };
}

function Photo({ checkin, className }: { checkin: AdminCheckinView; className?: string }) {
  return (
    <a href={fileUrl(checkin.image)} target="_blank" rel="noreferrer" className={cx('block overflow-hidden rounded-md bg-mat', className)} title="查看原图">
      <img src={fileUrl(checkin.image)} alt={`打卡照片：${checkin.stampText}`} loading="lazy" className="h-full w-full object-contain" />
    </a>
  );
}

/** 一条打卡和搭子当天最近的一条，放在一起对照 */
const accuracyText = (c: AdminCheckinView) => (c.accuracy === null ? '没有定位' : `定位误差 ±${c.accuracy} 米`);

function CheckinPair({ checkin, author, partner, partnerCheckin, distance }: {
  checkin: AdminCheckinView; author: { id: number; nickname: string };
  partner: { id: number; nickname: string } | null; partnerCheckin: AdminCheckinView | null; distance: number | null;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {partnerCheckin && (
        <p className="text-[13px] text-ink-2 sm:col-span-2">
          两次打卡{distance === null ? '无法比较距离（有一方没有定位）' : `相距约 ${distance} 米`}
        </p>
      )}
      <div>
        <Photo checkin={checkin} className="aspect-[4/3]" />
        <p className="mt-1.5 text-[13px] text-ink-2"><Link to={`/u/${author.id}`} className="font-semibold text-ink hover:underline">{author.nickname}</Link> · {checkin.stampText}</p>
        <p className="text-[13px] text-ink-3">{checkin.placeLabel} · {accuracyText(checkin)}</p>
        <p className="mt-1 text-[14px] whitespace-pre-wrap break-words text-ink">{checkin.caption || <span className="text-ink-4">（没有说明）</span>}</p>
      </div>
      <div>
        {partnerCheckin ? (
          <>
            <Photo checkin={partnerCheckin} className="aspect-[4/3] opacity-90" />
            <p className="mt-1.5 text-[13px] text-ink-3">搭子 {partner?.nickname} 当天最近的一次 · {partnerCheckin.stampText}</p>
            <p className="text-[13px] text-ink-3">{partnerCheckin.placeLabel} · {accuracyText(partnerCheckin)}</p>
            <p className="mt-1 text-[13.5px] whitespace-pre-wrap break-words text-ink-2">{partnerCheckin.caption}</p>
          </>
        ) : (
          <p className="grid aspect-[4/3] place-items-center rounded-md bg-paper-2 px-4 text-center text-[13px] text-ink-3">
            {partner ? `搭子 ${partner.nickname} 当天没有打卡` : '打卡时没有绑定搭子'}
          </p>
        )}
      </div>
    </div>
  );
}

// ---------------- 抽检与申诉 ----------------

export function AuditTab({ onChange }: { onChange: () => void }) {
  const [view, setView] = useState('pending');
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Segmented options={[{ value: 'pending', label: '待抽检' }, { value: 'appeals', label: '申诉' }, { value: 'done', label: '已处理' }]} value={view} onChange={setView} />
        <Link to="/rules#audit" className="text-[13px] text-ink-3 underline-offset-2 hover:underline">判定标准</Link>
      </div>
      {view === 'appeals' ? <Appeals onChange={onChange} /> : <Audits done={view === 'done'} onChange={onChange} />}
    </div>
  );
}

function Audits({ done, onChange }: { done: boolean; onChange: () => void }) {
  const toast = useToast();
  const { data, load } = useLoad(() => api.admin.audits(done ? 'done' : 'pending'), [done]);
  const [invalidating, setInvalidating] = useState<AdminAudit | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  if (!data) return <Skeleton className="h-64 rounded-xl" />;
  if (!data.items.length) return <Empty title={done ? '还没有处理过的抽检' : '没有待抽检的打卡'} desc={done ? undefined : '每周一会自动抽取上一周的打卡，并加入系统标记的可疑打卡。'} />;
  const pass = async (item: AdminAudit) => {
    setBusy(item.checkinId);
    try {
      await api.admin.passAudit(item.checkinId);
      toast.success('已标记为有效');
      await load();
      onChange();
    } catch (e) { toast.error('操作失败', errorText(e)); } finally { setBusy(null); }
  };
  return (
    <div className="space-y-4">
      <p className="text-[13px] text-ink-3">先看系统标记的，再看获奖复核和随机抽检。标记只是提示，请看照片判断；内容违规（不只是不计分）请打开打卡用「撤下」。</p>
      {data.items.map((item) => (
        <article key={item.checkinId} className="rounded-xl bg-surface p-4 sm:p-5">
          <div className="mb-3 flex flex-wrap items-center gap-2 text-[12.5px]">
            <Tag tone={item.source === 'flag' ? 'accent' : item.source === 'prize' ? 'gold' : 'neutral'}>{item.sourceLabel}</Tag>
            <span className="text-ink-3">{shortDate(item.week)} 那一周</span>
            {item.flags.map((f) => <span key={f} className="text-accent-text">· {f}</span>)}
            <Link to={`/community/checkins/${item.checkinId}`} className="ml-auto inline-flex items-center gap-1 text-ink-3 hover:text-ink">打开打卡 <ExternalLink size={12} /></Link>
          </div>
          <CheckinPair checkin={item.checkin} author={item.author} partner={item.partner} partnerCheckin={item.partnerCheckin} distance={item.distance} />
          {done ? (
            <p className="mt-3 text-[13px] text-ink-3">
              {item.status === 'valid' ? '有效' : `无效：${item.checkin.invalidReason ?? ''}`} · {item.reviewer} · {dateTime(item.reviewedAt)}
            </p>
          ) : (
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <Button size="sm" loading={busy === item.checkinId} onClick={() => void pass(item)}>有效</Button>
              <Button size="sm" variant="dangerOutline" onClick={() => setInvalidating(item)}>判无效</Button>
            </div>
          )}
        </article>
      ))}
      {invalidating && (
        <InvalidateDialog
          checkinId={invalidating.checkinId}
          label={`${invalidating.author.nickname} 的打卡 · ${invalidating.checkin.stampText}`}
          onClose={() => setInvalidating(null)}
          onDone={() => { setInvalidating(null); void load(); onChange(); }}
        />
      )}
    </div>
  );
}

function Appeals({ onChange }: { onChange: () => void }) {
  const toast = useToast();
  const [all, setAll] = useState(false);
  const { data, load } = useLoad(() => api.admin.appeals(all ? 'all' : 'open'), [all]);
  const [notes, setNotes] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState<number | null>(null);
  const decide = async (item: AdminAppeal, decision: 'upheld' | 'overturned') => {
    setBusy(item.id);
    try {
      await api.admin.decideAppeal(item.id, decision, notes[item.id] ?? '');
      toast.success(decision === 'overturned' ? '已撤销判定，恢复计分' : '已维持无效');
      await load();
      onChange();
    } catch (e) { toast.error('操作失败', errorText(e)); } finally { setBusy(null); }
  };
  return (
    <div className="space-y-4">
      <label className="flex items-center gap-2 text-[13px] text-ink-3"><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} />包括已处理的申诉</label>
      {!data ? <Skeleton className="h-64 rounded-xl" /> : !data.items.length ? <Empty title="没有待处理的申诉" /> : data.items.map((item) => (
        <article key={item.id} className="rounded-xl bg-surface p-4 sm:p-5">
          <p className="mb-3 text-[13.5px] text-ink-2">
            判无效：<b className="text-ink">{item.checkin.invalidReason ?? '（已恢复）'}</b>
            <span className="text-ink-3"> · {item.checkin.invalidBy} · {dateTime(item.checkin.invalidAt)}</span>
          </p>
          <CheckinPair checkin={item.checkin} author={item.author} partner={item.partner} partnerCheckin={item.partnerCheckin} distance={item.distance} />
          <blockquote className="mt-3 rounded-md bg-paper-2 px-3 py-2 text-[14px] text-ink-2">申诉理由：{item.body}</blockquote>
          {item.status === 'open' ? (
            item.canDecide ? (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Input aria-label="复核说明" placeholder="复核说明（会告诉本人，选填）" value={notes[item.id] ?? ''} maxLength={200} onChange={(e) => setNotes((n) => ({ ...n, [item.id]: e.target.value }))} className="min-w-0 flex-1" />
                <Button size="sm" loading={busy === item.id} onClick={() => void decide(item, 'upheld')}>维持无效</Button>
                <Button size="sm" variant="primary" loading={busy === item.id} onClick={() => void decide(item, 'overturned')}>撤销，恢复计分</Button>
              </div>
            ) : <p className="mt-3 text-[13px] text-accent-text">这条是你判的无效，需要由另一位审核员复核。</p>
          ) : (
            <p className="mt-3 text-[13px] text-ink-3">{item.status === 'overturned' ? '已撤销' : '已维持'} · {item.decidedBy} · {dateTime(item.decidedAt)}{item.decisionNote ? ` · ${item.decisionNote}` : ''}</p>
          )}
        </article>
      ))}
    </div>
  );
}

// ---------------- Bonus ----------------

export function BonusTab({ onChange }: { onChange: () => void }) {
  const toast = useToast();
  const [all, setAll] = useState(false);
  const { data, load } = useLoad(() => api.admin.bonus(all ? 'all' : 'pending'), [all]);
  const [rejecting, setRejecting] = useState<AdminBonus | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const decide = async (item: AdminBonus, decision: 'approve' | 'reject', why = '') => {
    setBusy(true);
    try {
      const r = await api.admin.decideBonus(item.id, decision, why);
      toast.success(r.status === 'approved' ? `已通过，加 ${r.points} 分` : '已标记为不通过');
      setRejecting(null);
      setReason('');
      await load();
      onChange();
    } catch (e) { toast.error('操作失败', errorText(e)); } finally { setBusy(false); }
  };
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="flex items-center gap-2 text-[13px] text-ink-3"><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} />包括已处理的申请</label>
        <Link to="/rules#bonus" className="text-[13px] text-ink-3 underline-offset-2 hover:underline">Bonus 标准</Link>
      </div>
      {!data ? <Skeleton className="h-64 rounded-xl" /> : !data.items.length ? <Empty title="没有待审核的学习分享" /> : data.items.map((item) => (
        <article key={item.id} className="rounded-xl bg-surface p-4 sm:p-5">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-[13px] text-ink-3">
            <span><b className="text-ink">{item.author.nickname}</b> 与搭子 {item.partner.nickname}</span>
            <span>{shortDate(item.week)} 那一周 · 本赛季已获 {item.approvedPoints}/{item.seasonMax} 分</span>
            {item.post && <Link to={`/community/posts/${item.post.id}`} className="ml-auto inline-flex items-center gap-1 hover:text-ink">打开帖子 <ExternalLink size={12} /></Link>}
          </div>
          {item.post ? (
            <div className="mt-3">
              {item.post.title && <h3 className="font-display text-[18px] text-ink">{item.post.title}</h3>}
              <p className="mt-1 max-h-60 overflow-y-auto text-[14px] leading-relaxed whitespace-pre-wrap break-words text-ink-2">{item.post.body}</p>
              <p className="mt-1 text-[12px] text-ink-4">{Array.from(item.post.body.replace(/\s+/g, '')).length} 字 · {item.post.images.length} 张图{item.post.deleted ? ' · 作者已删除' : ''}{item.post.takenDown ? ' · 已被撤下' : ''}</p>
              {item.post.images.length > 0 && (
                <div className="mt-2 flex gap-2">{item.post.images.map((name) => <a key={name} href={fileUrl(name)} target="_blank" rel="noreferrer"><img src={fileUrl(name)} alt="帖子图片" className="size-20 rounded-md object-cover" /></a>)}</div>
              )}
            </div>
          ) : <p className="mt-3 text-[13px] text-ink-3">帖子已不存在</p>}
          {item.status === 'pending' ? (
            <div className="mt-4 flex justify-end gap-2">
              <Button size="sm" variant="dangerOutline" onClick={() => setRejecting(item)}>不通过</Button>
              <Button size="sm" variant="primary" loading={busy} onClick={() => void decide(item, 'approve')}>通过</Button>
            </div>
          ) : (
            <p className="mt-3 text-[13px] text-ink-3">{{ approved: `已通过 +${item.points}`, rejected: `未通过：${item.reason ?? ''}`, withdrawn: '作者已撤回', pending: '' }[item.status]} · {item.reviewer} · {dateTime(item.reviewedAt)}</p>
          )}
        </article>
      ))}
      <Modal open={!!rejecting} onClose={() => !busy && setRejecting(null)} title="不通过的原因" size="md">
        <div className="space-y-4 p-5">
          <div className="flex flex-wrap gap-2">
            {BONUS_REJECT_REASONS.map((r) => (
              <button key={r} type="button" onClick={() => setReason(r)} className={cx('rounded-md border px-2.5 py-1.5 text-[13px]', reason === r ? 'border-danger bg-danger text-white' : 'border-line-strong text-ink-2 hover:border-ink-4')}>{r}</button>
            ))}
          </div>
          <Input aria-label="原因" value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} placeholder="也可以自己写" />
          <div className="flex justify-end gap-2">
            <Button disabled={busy} onClick={() => setRejecting(null)}>取消</Button>
            <Button variant="danger" loading={busy} disabled={!reason.trim()} onClick={() => rejecting && void decide(rejecting, 'reject', reason.trim())}>确认不通过</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

// ---------------- 搭子榜（含分数） ----------------

export function BoardTab({ isAdmin }: { isAdmin: boolean }) {
  const toast = useToast();
  const { data, load } = useLoad(() => api.admin.board(), []);
  const [busy, setBusy] = useState(false);
  const [disqualify, setDisqualify] = useState<AdminBoardItem | null>(null);
  const [requalify, setRequalify] = useState<AdminBoardItem | null>(null);
  const [reason, setReason] = useState('');
  if (!data) return <Skeleton className="h-64 rounded-xl" />;
  const act = async (fn: () => Promise<unknown>, success: string) => {
    setBusy(true);
    try { await fn(); toast.success(success); setDisqualify(null); setRequalify(null); setReason(''); await load(); } catch (e) { toast.error('操作失败', errorText(e)); } finally { setBusy(false); }
  };
  const prizeReview = async () => {
    setBusy(true);
    try {
      const r = await api.admin.prizeReview();
      toast.success(`已加入复核：${r.pairs} 组、${r.added} 条打卡`, '在「抽检与申诉」里逐条确认');
    } catch (e) { toast.error('操作失败', errorText(e)); } finally { setBusy(false); }
  };
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <p className="flex-1 text-[13px] text-ink-3">
          {data.through ? `统计到 ${shortDate(data.through)}（周日）` : '赛季还没有完整的一周'} · 共 {data.items.length} 组在绑 · 前 {data.prizePairs} 组获奖。分数只在后台显示。
        </p>
        <Button size="sm" loading={busy} onClick={() => void prizeReview()}>复核获奖组合</Button>
      </div>
      {!data.items.length ? <Empty title="还没有绑定的组合" /> : (
        <div className="overflow-x-auto rounded-xl bg-surface">
          <table className="w-full min-w-[880px] text-left text-[13px]">
            <thead className="border-b border-line text-[12px] text-ink-3">
              <tr>{['名次', '组合', '总分', '打卡分', 'Bonus', '满勤周', '计入次数', '无效', '状态', ''].map((h) => <th key={h} className="px-3 py-3 font-medium">{h}</th>)}</tr>
            </thead>
            <tbody>
              {data.items.map((item) => (
                <tr key={item.pairId} className={cx('border-b border-line align-top last:border-0', item.rank !== null && item.rank <= data.prizePairs && 'bg-brand-softer')}>
                  <td className="px-3 py-3 tabular">{item.rank === null ? '—' : `${item.rank}${item.tied ? '（并列）' : ''}`}</td>
                  <td className="px-3 py-3">
                    {item.members.map((m) => (
                      <div key={m.id} className="whitespace-nowrap">
                        <Link to={`/u/${m.id}`} className="text-ink hover:underline">{m.nickname}</Link>
                        {isAdmin && <span className="ml-1.5 text-ink-3">{m.realName || '—'} {m.studentId}</span>}
                        <span className={cx('ml-1.5', m.shuren === 'yes' ? 'text-brand-text' : 'text-ink-4')}>{m.shuren === 'yes' ? '树仁' : m.shuren === 'no' ? '非树仁' : '未填'}</span>
                      </div>
                    ))}
                    <details className="mt-1 text-[12px] text-ink-3">
                      <summary className="cursor-pointer">每周明细 · 从 {shortDate(item.startsOn)} 计分</summary>
                      {item.weeks.length ? item.weeks.map((w) => <div key={w.week} className="tabular">{shortDate(w.week)} 那周：{w.count} 次（计 {w.counted}）→ {w.points} 分</div>) : '还没有完整的计分周'}
                    </details>
                  </td>
                  <td className="px-3 py-3 font-semibold text-ink tabular">{item.total}</td>
                  <td className="px-3 py-3 tabular">{item.checkinPoints}</td>
                  <td className="px-3 py-3 tabular">{item.bonusPoints}</td>
                  <td className="px-3 py-3 tabular">{item.fullWeeks}</td>
                  <td className="px-3 py-3 tabular">{item.events}</td>
                  <td className="px-3 py-3 tabular">{item.strikes}</td>
                  <td className="px-3 py-3 text-[12.5px]">{item.ineligible ? <span className="text-danger">{item.ineligible}</span> : <span className="text-ink-3">可评奖</span>}</td>
                  <td className="px-3 py-3">
                    {item.disqualified
                      ? <Button size="sm" variant="ghost" onClick={() => setRequalify(item)}>恢复资格</Button>
                      : <Button size="sm" variant="ghost" className="text-danger" onClick={() => setDisqualify(item)}>取消资格</Button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Modal open={!!disqualify} onClose={() => !busy && setDisqualify(null)} title="取消本赛季评奖资格" size="md">
        <div className="space-y-4 p-5">
          <p className="text-[13.5px] leading-relaxed text-ink-3">用于确认的作弊行为（代打卡、一人操作两个账号等）。两人都会被取消资格并收到通知，换搭子也不能恢复。只是照片不合格请用「判无效」。</p>
          <Field label="原因（会告诉本人）"><Textarea aria-label="原因" value={reason} maxLength={200} rows={3} onChange={(e) => setReason(e.target.value)} /></Field>
          <div className="flex justify-end gap-2">
            <Button disabled={busy} onClick={() => setDisqualify(null)}>取消</Button>
            <Button variant="danger" loading={busy} disabled={!reason.trim()} onClick={() => disqualify && void act(() => api.admin.disqualify(disqualify.pairId, reason.trim()), '已取消评奖资格')}>确认</Button>
          </div>
        </div>
      </Modal>
      <ConfirmDialog
        open={!!requalify}
        title="恢复评奖资格？"
        desc="两人都会恢复资格。无效打卡累计次数仍然照常计算。"
        loading={busy}
        onCancel={() => setRequalify(null)}
        onConfirm={() => requalify && void act(() => api.admin.requalify(requalify.pairId), '已恢复资格')}
      />
    </div>
  );
}

// ---------------- 私聊敏感词 ----------------

export function WordsTab() {
  const toast = useToast();
  const { data, load } = useLoad(() => api.admin.chatWords(), []);
  const [draft, setDraft] = useState<Record<SensitiveCategory, string> | null>(null);
  const [busy, setBusy] = useState(false);
  const [sample, setSample] = useState('');
  const [result, setResult] = useState<string | null>(null);
  useEffect(() => {
    if (data) setDraft(Object.fromEntries(SENSITIVE_CATEGORIES.map((c) => [c, data.words[c].join('\n')])) as Record<SensitiveCategory, string>);
  }, [data]);
  if (!draft) return <Skeleton className="h-64 rounded-xl" />;
  const save = async () => {
    setBusy(true);
    try {
      await api.admin.saveChatWords(Object.fromEntries(SENSITIVE_CATEGORIES.map((c) => [c, draft[c].split('\n').map((w) => w.trim()).filter(Boolean)])) as Record<SensitiveCategory, string[]>);
      toast.success('词库已保存', '立即对新消息生效');
      await load();
    } catch (e) { toast.error('保存失败', errorText(e)); } finally { setBusy(false); }
  };
  const test = async () => {
    try {
      const r = await api.admin.testChatWords(sample);
      setResult(r.blocked.length ? `会被拦截：${r.blocked.map((c) => SENSITIVE_LABELS[c]).join('、')}` : r.warned.length ? `发送前提醒，对方看到提示：${r.warned.map((c) => SENSITIVE_LABELS[c]).join('、')}` : '可以正常发送');
    } catch (e) { setResult(errorText(e)); }
  };
  return (
    <div className="space-y-5">
      <p className="text-[13.5px] leading-relaxed text-ink-3">每行一个词。匹配时忽略空格、标点和大小写。「{BLOCKED_CATEGORIES.map((c) => SENSITIVE_LABELS[c]).join('、')}」类直接拦截，其他类别发送前提醒。避免收「政治」「血」这类太宽的词，会误伤正常学习内容（如「考研政治」）。</p>
      <div className="grid gap-4 md:grid-cols-2">
        {SENSITIVE_CATEGORIES.map((c) => (
          <Field key={c} label={`${SENSITIVE_LABELS[c]}${BLOCKED_CATEGORIES.includes(c) ? '（拦截）' : '（提醒）'}`}>
            <Textarea aria-label={SENSITIVE_LABELS[c]} rows={8} value={draft[c]} onChange={(e) => setDraft({ ...draft, [c]: e.target.value })} />
          </Field>
        ))}
      </div>
      <div className="flex justify-end"><Button variant="primary" loading={busy} onClick={() => void save()}>保存词库</Button></div>
      <div className="rounded-xl bg-surface p-4">
        <p className="text-[14px] font-semibold text-ink">试一试</p>
        <div className="mt-2 flex gap-2">
          <Input aria-label="测试文字" value={sample} onChange={(e) => setSample(e.target.value)} placeholder="输入一句话，看看会被怎样处理（按已保存的词库）" className="flex-1" />
          <Button onClick={() => void test()} disabled={!sample.trim()}>检查</Button>
        </div>
        {result && <p className="mt-2 text-[13.5px] text-ink-2">{result}</p>}
      </div>
    </div>
  );
}

// ---------------- 活动设置（仅管理员） ----------------

function NumberField({ label, value, onChange, hint }: { label: string; value: number; onChange: (v: number) => void; hint?: ReactNode }) {
  return (
    <Field label={label} hint={hint}>
      <Input type="number" inputMode="numeric" value={Number.isFinite(value) ? value : ''} onChange={(e) => onChange(Number(e.target.value))} />
    </Field>
  );
}

export function ActivitySettingsTab() {
  const toast = useToast();
  const { data } = useLoad(() => api.admin.activityConfig(), []);
  const [form, setForm] = useState<ActivityConfig | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (data) setForm(data.config); }, [data]);
  if (!form || !data) return <Skeleton className="h-64 rounded-xl" />;
  const set = <K extends keyof ActivityConfig>(key: K, value: ActivityConfig[K]) => setForm((f) => (f ? { ...f, [key]: value } : f));
  const setCap = (cap: number) => setForm((f) => {
    if (!f || !Number.isInteger(cap) || cap < 1 || cap > 7) return f ? { ...f, weeklyCap: cap } : f;
    const ladder = Array.from({ length: cap + 1 }, (_, i) => f.ladder[i] ?? (f.ladder.at(-1) ?? 0));
    return { ...f, weeklyCap: cap, ladder };
  });
  const checked = validateActivityConfig(form);
  const save = async () => {
    setBusy(true);
    try {
      await api.admin.saveActivityConfig(form);
      forgetActivityConfig();
      toast.success('活动设置已保存', '搭子榜与规则页会按新的设置计算');
    } catch (e) { toast.error('保存失败', errorText(e)); } finally { setBusy(false); }
  };
  return (
    <div className="max-w-3xl space-y-6">
      <p className="text-[13.5px] leading-relaxed text-ink-3">积分每次都从打卡记录重新计算，修改后已结束的周也会按新设置重算。赛季中途请尽量不要改计分规则，确需修改时先在群里公告。</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="赛季开始（当天起计分）"><Input type="date" value={form.seasonStart} onChange={(e) => set('seasonStart', e.target.value)} /></Field>
        <Field label="赛季结束（周日）"><Input type="date" value={form.seasonEnd} onChange={(e) => set('seasonEnd', e.target.value)} /></Field>
        <NumberField label="相同事件时间窗（分钟）" value={form.windowMinutes} onChange={(v) => set('windowMinutes', v)} />
        <NumberField label="两人相距不超过（米）" value={form.distanceMeters} onChange={(v) => set('distanceMeters', v)} hint="填 0 表示不检查距离" />
        <NumberField label="定位误差上限（米）" value={form.accuracyMeters} onChange={(v) => set('accuracyMeters', v)} hint="误差更大的打卡不计分" />
        <NumberField label="每周最多计几次" value={form.weeklyCap} onChange={setCap} />
        <NumberField label="计分打卡的说明至少几个字" value={form.captionMin} onChange={(v) => set('captionMin', v)} />
        <NumberField label="随机抽检比例（%）" value={form.auditRate} onChange={(v) => set('auditRate', v)} />
        <NumberField label="获奖组合数" value={form.prizePairs} onChange={(v) => set('prizePairs', v)} hint="发奖前这些组合全部复核" />
        <NumberField label="申诉期限（小时）" value={form.appealHours} onChange={(v) => set('appealHours', v)} />
        <NumberField label="无效打卡几次取消资格" value={form.strikeLimit} onChange={(v) => set('strikeLimit', v)} />
        <NumberField label="每次 Bonus 加几分" value={form.bonusPoints} onChange={(v) => set('bonusPoints', v)} />
        <NumberField label="每周最多申请几次 Bonus" value={form.bonusWeeklyMax} onChange={(v) => set('bonusWeeklyMax', v)} />
        <NumberField label="赛季 Bonus 上限（分）" value={form.bonusSeasonMax} onChange={(v) => set('bonusSeasonMax', v)} />
      </div>
      <div>
        <p className="text-[14px] font-semibold text-ink">阶梯分</p>
        <div className="mt-2 flex flex-wrap gap-3">
          {form.ladder.map((points, count) => (
            <label key={count} className="flex items-center gap-1.5 text-[13.5px] text-ink-2">
              {count} 次
              <Input type="number" inputMode="numeric" aria-label={`${count} 次的得分`} className="w-20" value={Number.isFinite(points) ? points : ''} disabled={count === 0}
                onChange={(e) => set('ladder', form.ladder.map((p, i) => (i === count ? Number(e.target.value) : p)))} />
              分
            </label>
          ))}
        </div>
      </div>
      {'error' in checked && <p className="text-[13.5px] text-danger" role="alert">{checked.error}</p>}
      <div className="flex justify-end"><Button variant="primary" loading={busy} disabled={'error' in checked} onClick={() => void save()}>保存设置</Button></div>
      <CollegeRoster />
    </div>
  );
}

/** 树仁书院名单：粘贴学号（每行一个或任意分隔），导入后按学号自动判断书院身份，不再由本人填写 */
function CollegeRoster() {
  const toast = useToast();
  const [info, setInfo] = useState<{ count: number; updatedAt: string | null } | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { api.admin.collegeRoster().then(setInfo).catch(() => {}); }, []);
  const found = new Set(text.match(/(?<!\d)\d{8}(?!\d)/g) ?? []).size;
  const save = async (value: string) => {
    setBusy(true);
    try {
      const next = await api.admin.saveCollegeRoster(value);
      setInfo(next);
      setText('');
      toast.success(next.count ? `名单已更新：${next.count} 个学号` : '名单已清空', next.count ? '书院身份按学号自动判断' : '恢复为本人绑定时填写');
    } catch (e) { toast.error('保存失败', errorText(e)); } finally { setBusy(false); }
  };
  return (
    <section className="space-y-3 border-t border-line pt-6" aria-labelledby="roster-title">
      <h3 id="roster-title" className="text-[16px] font-semibold text-ink">树仁书院名单</h3>
      <p className="text-[13.5px] leading-relaxed text-ink-3">
        {info?.count
          ? `现有 ${info.count} 个学号。同学的书院身份按登录邮箱里的学号自动判断，不在名单里的算非树仁学生；本人不再需要填写。`
          : '还没有导入名单：现在由同学在绑定搭子时自己填写是否为树仁学生。导入名单后改为按学号自动判断，并在「我的」页显示「树仁书院」。'}
        组合里至少一人是树仁学生才能参与排名。名单只有管理员能看到和修改。
      </p>
      <Textarea aria-label="树仁书院学号名单" value={text} onChange={(e) => setText(e.target.value)} placeholder="粘贴学号，每行一个，或从表格里整列复制（8 位数字以外的内容会被忽略）" className="min-h-28 font-mono" />
      <div className="flex flex-wrap items-center justify-end gap-2">
        <span className="mr-auto text-[13px] text-ink-3">{text ? `识别到 ${found} 个学号` : ''}</span>
        {!!info?.count && <Button disabled={busy} onClick={() => void save('')}>清空名单</Button>}
        <Button variant="primary" loading={busy} disabled={!found} onClick={() => void save(text)}>用这份名单替换</Button>
      </div>
    </section>
  );
}

// ---------------- 审核小组（仅管理员） ----------------

export function StaffTab() {
  const toast = useToast();
  const { data, load } = useLoad(() => api.admin.staff(), []);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('moderator');
  const [busy, setBusy] = useState(false);
  const setRoleFor = async (target: string, next: Role) => {
    setBusy(true);
    try {
      await api.admin.setRole(target, next);
      toast.success(next === 'user' ? '已撤销权限' : `已设为${ROLE_LABELS[next]}`);
      setEmail('');
      await load();
    } catch (e) { toast.error('操作失败', errorText(e)); } finally { setBusy(false); }
  };
  return (
    <div className="space-y-5">
      <p className="text-[13.5px] leading-relaxed text-ink-3">审核员可以处理主页、帖子、打卡、举报、抽检、申诉和 Bonus，修改敏感词；不能修改活动设置、不能查看用户名单和学号、不能授权。对方需要先用校园邮箱激活账号。排班请在群里约定，这里只记录每个人最近 7 天的处理量。</p>
      <form className="flex flex-wrap gap-2 rounded-xl bg-surface p-4" onSubmit={(e) => { e.preventDefault(); void setRoleFor(email.trim(), role); }}>
        <Input aria-label="校园邮箱" placeholder="12345678@mail.sustech.edu.cn" value={email} onChange={(e) => setEmail(e.target.value)} className="min-w-0 flex-1" />
        <select aria-label="角色" value={role} onChange={(e) => setRole(e.target.value as Role)} className="h-10 rounded-md border border-line-strong bg-surface px-3 text-[14px]">
          <option value="moderator">审核员</option>
          <option value="admin">管理员</option>
        </select>
        <Button type="submit" variant="primary" loading={busy} disabled={!email.trim()}>授权</Button>
      </form>
      {!data ? <Skeleton className="h-40 rounded-xl" /> : (
        <div className="overflow-x-auto rounded-xl bg-surface">
          <table className="w-full min-w-[640px] text-left text-[13px]">
            <thead className="border-b border-line text-[12px] text-ink-3"><tr>{['邮箱', '昵称', '角色', '最近登录', '近 7 天处理', ''].map((h) => <th key={h} className="px-4 py-3 font-medium">{h}</th>)}</tr></thead>
            <tbody>
              {data.items.map((s: AdminStaff) => (
                <tr key={s.id} className="border-b border-line last:border-0">
                  <td className="px-4 py-3 text-ink">{s.email}</td>
                  <td className="px-4 py-3 text-ink-2">{s.nickname || '—'}</td>
                  <td className="px-4 py-3">{ROLE_LABELS[s.role]}</td>
                  <td className="px-4 py-3 text-ink-3">{timeAgo(s.lastLoginAt) || '—'}</td>
                  <td className="px-4 py-3 tabular">{s.actions7d}</td>
                  <td className="px-4 py-3 text-right"><Button size="sm" variant="ghost" disabled={busy} onClick={() => void setRoleFor(s.email, 'user')}>撤销</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
