import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { ChevronLeft, ExternalLink, Flag, Lock, MapPin, ShieldX, Trash2 } from 'lucide-react';
import type { Checkin } from '../../shared/types';
import { api, ApiError, fileUrl } from '../lib/api';
import { useAuth } from '../lib/auth';
import { fullDateTime } from '../lib/format';
import { useToast } from '../lib/toast';
import { Button, ConfirmDialog, Skeleton } from '../components/ui';
import { ReportDialog, TakedownDialog } from '../components/moderation';
import { AuthorLine } from '../components/forum/AuthorLine';
import { Comments } from '../components/forum/Comments';
import { LikeButton } from '../components/forum/LikeButton';
import { CheckinPhoto } from '../components/checkin/CheckinCard';

/** 打卡详情：大图、说明、地点与服务器时间、点赞、评论、举报、本人删除、管理员撤下 */
export function CheckinDetail() {
  const { id } = useParams();
  const checkinId = Number(id);
  const { user } = useAuth();
  const toast = useToast();
  const nav = useNavigate();
  const [checkin, setCheckin] = useState<Checkin | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [takingDown, setTakingDown] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const r = await api.checkins.get(checkinId);
      setCheckin(r.checkin);
    } catch (e) {
      setError(e instanceof ApiError && e.status === 404 ? '这条打卡不存在、已被删除，或你没有权限查看。' : e instanceof ApiError ? e.message : '加载失败，请稍后重试');
    }
  }, [checkinId]);

  useEffect(() => {
    setCheckin(null);
    if (!Number.isSafeInteger(checkinId) || checkinId <= 0) {
      setError('这条打卡不存在、已被删除，或你没有权限查看。');
      return;
    }
    void load();
  }, [checkinId, load]);

  const back = () => nav('/community?tab=checkin');

  if (error) {
    return (
      <div className="py-24 text-center">
        <p className="text-[16px] text-ink-2">{error}</p>
        <Button className="mt-5" onClick={back}>返回打卡</Button>
      </div>
    );
  }
  if (!checkin) {
    return (
      <div className="mx-auto max-w-5xl space-y-4 pt-10" aria-busy="true">
        <Skeleton className="h-6 w-32" />
        <Skeleton className="aspect-[4/3] w-full max-w-[720px] rounded-md" />
      </div>
    );
  }

  const c = checkin;
  const isAdmin = user?.role === 'admin';

  return (
    <div className="mx-auto max-w-5xl pt-5 sm:pt-8">
      <button type="button" onClick={back} className="-ml-1 mb-4 inline-flex items-center gap-0.5 text-[14px] text-ink-2 hover:text-ink">
        <ChevronLeft size={17} /> 打卡
      </button>

      {c.takenDown && (
        <p className="mb-4 rounded-md bg-danger-soft px-4 py-3 text-[14px] text-danger" role="status">
          这条打卡已被管理员撤下{c.takedownReason ? `，原因：${c.takedownReason}` : ''}。只有{c.isMine ? '你' : '作者'}和管理员能看到。
        </p>
      )}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start lg:gap-8">
        <figure className="min-w-0">
          <CheckinPhoto checkin={c} eager />
          <figcaption className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[12.5px] text-ink-3">
            <span>水印由服务器在收到照片时盖上</span>
            <a href={fileUrl(c.image)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline decoration-line underline-offset-2 hover:text-ink">
              查看原图 <ExternalLink size={12} aria-hidden />
            </a>
          </figcaption>
        </figure>

        <article className="rounded-md border border-line bg-surface p-4 sm:p-5" aria-label="打卡信息">
          <AuthorLine author={c.author} time={c.stampedAt} />
          <h1 className="sr-only">{`${c.author.nickname} 的打卡`}</h1>
          {c.caption && <p className="mt-4 text-[15px] leading-[1.8] whitespace-pre-wrap break-words text-ink">{c.caption}</p>}

          <dl className="mt-4 space-y-2 border-y border-line py-3 text-[14px]">
            <div className="flex gap-3">
              <dt className="w-16 shrink-0 text-ink-3">地点</dt>
              <dd className="inline-flex min-w-0 items-center gap-1 text-ink"><MapPin size={14} className="shrink-0 text-ink-3" aria-hidden />{c.placeLabel}</dd>
            </div>
            <div className="flex gap-3">
              <dt className="w-16 shrink-0 text-ink-3">盖章时间</dt>
              <dd className="text-ink tabular"><time dateTime={c.stampedAt} title={fullDateTime(c.stampedAt)}>{c.stampText}</time></dd>
            </div>
            <div className="flex gap-3">
              <dt className="w-16 shrink-0 text-ink-3">可见范围</dt>
              <dd className="inline-flex items-center gap-1 text-ink">
                {c.visibility === 'buddies' ? <><Lock size={13} className="text-ink-3" aria-hidden />仅搭子</> : '所有同学'}
              </dd>
            </div>
          </dl>

          <div className="mt-3 flex flex-wrap items-center gap-1">
            {!c.takenDown && (
              <LikeButton type="checkin" id={c.id} liked={c.liked} count={c.likeCount} onChange={(r) => setCheckin({ ...c, liked: r.liked, likeCount: r.likeCount })} />
            )}
            <div className="ml-auto flex flex-wrap items-center gap-1">
              {c.isMine ? (
                <Button variant="ghost" size="sm" icon={<Trash2 size={14} />} className="text-danger hover:bg-danger-soft hover:text-danger" onClick={() => setConfirmDelete(true)}>
                  删除
                </Button>
              ) : (
                !c.takenDown && (
                  <Button variant="ghost" size="sm" icon={<Flag size={14} />} className="text-ink-3 hover:text-danger" onClick={() => setReporting(true)}>
                    举报
                  </Button>
                )
              )}
              {isAdmin && !c.takenDown && (
                <Button variant="dangerOutline" size="sm" icon={<ShieldX size={14} />} onClick={() => setTakingDown(true)}>
                  撤下
                </Button>
              )}
            </div>
          </div>
        </article>
      </div>

      <section className="mt-8 max-w-[720px]" aria-label="评论">
        {c.takenDown ? (
          <p className="rounded-md bg-paper-2 px-4 py-3 text-[14px] text-ink-3">打卡被撤下后不能再评论。</p>
        ) : (
          <Comments type="checkin" id={c.id} />
        )}
      </section>

      <ConfirmDialog
        open={confirmDelete}
        tone="danger"
        title="删除这次打卡？"
        desc="删除后其他同学将看不到这张照片，也不再计入连续打卡天数；当天的打卡次数不会因此恢复。"
        confirmText="删除"
        loading={deleting}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={async () => {
          setDeleting(true);
          try {
            await api.checkins.remove(c.id);
            toast.success('已删除');
            back();
          } catch (e) {
            toast.error('删除失败', e instanceof ApiError ? e.message : undefined);
          } finally {
            setDeleting(false);
            setConfirmDelete(false);
          }
        }}
      />
      <ReportDialog open={reporting} onClose={() => setReporting(false)} targetType="checkin" targetId={c.id} />
      {isAdmin && (
        <TakedownDialog
          open={takingDown}
          onClose={() => setTakingDown(false)}
          type="checkin"
          id={c.id}
          label={`${c.author.nickname} 的打卡 · ${c.placeLabel}`}
          onDone={() => {
            setTakingDown(false);
            void load();
          }}
        />
      )}
    </div>
  );
}
