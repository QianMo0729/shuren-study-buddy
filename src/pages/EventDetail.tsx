import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { ChevronLeft, ChevronRight, Flag, Lock, Pencil, ShieldX, Trash2 } from 'lucide-react';
import { STUDY_TYPES } from '../../shared/options';
import type { Post } from '../../shared/types';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { fullDateTime, timeAgo } from '../lib/format';
import { useToast } from '../lib/toast';
import { Button, ConfirmDialog, Skeleton } from '../components/ui';
import { CategoryTag, InterestButton } from '../components/PostCard';
import { Cover, Nickname } from '../components/ProfileCard';
import { ReportDialog, TakedownDialog } from '../components/moderation';
import { Seal } from '../components/brand';

export function EventDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const toast = useToast();
  const nav = useNavigate();
  const [post, setPost] = useState<Post | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [del, setDel] = useState(false);
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState(false);
  const [takedown, setTakedown] = useState(false);

  const load = () => api.post(Number(id)).then((r) => setPost(r.post)).catch((e) => setError(e.message));
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (error)
    return (
      <div className="py-24 text-center">
        <p className="text-[16px] text-ink-2">{error}</p>
        <Button className="mt-5" onClick={() => nav('/events')}>
          返回活动大厅
        </Button>
      </div>
    );
  if (!post)
    return (
      <div className="mx-auto max-w-4xl space-y-4 pt-10">
        <Skeleton className="h-6 w-32" />
        <Skeleton className="h-72 rounded-xl" />
      </div>
    );

  const type = STUDY_TYPES.find((t) => t.value === post.author.studyType);
  const full = post.capacity > 0 && post.interestCount >= post.capacity;

  return (
    <div className="mx-auto max-w-4xl pt-5 sm:pt-8">
      <button onClick={() => nav('/events')} className="-ml-1 mb-4 inline-flex items-center gap-0.5 text-[14px] text-ink-2 hover:text-ink">
        <ChevronLeft size={17} /> 活动大厅
      </button>

      {post.takenDown && (
        <p className="mb-4 rounded-lg bg-danger-soft px-4 py-3 text-[14px] text-danger">
          这条招募已被管理员撤下{post.takedownReason ? `，原因：${post.takedownReason}` : ''}。只有你和管理员能看到。
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
        <article className="rounded-xl bg-surface p-5 sm:p-8">
          <div className="flex flex-wrap items-center gap-3">
            <CategoryTag value={post.category} />
            {post.status === 'closed' && <span className="rounded-md bg-paper-2 px-2 py-0.5 text-[13px] text-ink-2">招募已结束</span>}
            <span className="ml-auto text-[13px] text-ink-3">{timeAgo(post.createdAt)}发布</span>
          </div>
          <h1 className="mt-4 font-display text-[28px] leading-snug text-ink sm:text-[36px]">{post.title}</h1>

          <dl className="mt-6 grid gap-x-8 gap-y-3 border-y border-line py-4 text-[15px] sm:grid-cols-3">
            <div>
              <dt className="text-[13px] text-ink-3">时间</dt>
              <dd className="mt-0.5 text-ink">{post.timeText}</dd>
            </div>
            <div>
              <dt className="text-[13px] text-ink-3">地点</dt>
              <dd className="mt-0.5 text-ink">{post.location}</dd>
            </div>
            <div>
              <dt className="text-[13px] text-ink-3">人数</dt>
              <dd className="mt-0.5 text-ink tabular">
                {post.capacity ? `${post.interestCount}/${post.capacity} 人感兴趣${full ? '，已满' : ''}` : `不限，${post.interestCount} 人感兴趣`}
              </dd>
            </div>
          </dl>

          <p className="mt-5 text-[15px] leading-[1.8] whitespace-pre-wrap text-ink">{post.description}</p>
          {post.tags.length > 0 && <p className="mt-4 text-[14px] text-ink-3">{post.tags.map((t) => `#${t}`).join('  ')}</p>}

          <div className="mt-8 flex flex-wrap items-center gap-2">
            {post.isMine ? (
              <>
                <Button icon={<Pencil size={15} />} onClick={() => nav(`/events/${post.id}/edit`)}>
                  编辑
                </Button>
                <Button
                  icon={<Lock size={15} />}
                  onClick={async () => {
                    const next = post.status === 'open' ? 'closed' : 'open';
                    await api.setPostStatus(post.id, next);
                    setPost({ ...post, status: next });
                    toast.success(next === 'closed' ? '已结束招募' : '已重新开放招募');
                  }}
                >
                  {post.status === 'open' ? '结束招募' : '重新开放'}
                </Button>
                <Button variant="ghost" icon={<Trash2 size={15} />} className="text-danger hover:bg-danger-soft hover:text-danger" onClick={() => setDel(true)}>
                  删除
                </Button>
              </>
            ) : (
              <>
                {post.status === 'open' && <InterestButton post={post} size="lg" onChange={(p) => setPost({ ...post, ...p })} />}
                <button onClick={() => setReport(true)} className="ml-auto inline-flex items-center gap-1.5 text-[13px] text-ink-3 hover:text-danger">
                  <Flag size={14} /> 举报
                </button>
              </>
            )}
            {user?.role === 'admin' && !post.takenDown && (
              <Button variant="dangerOutline" size="sm" icon={<ShieldX size={14} />} onClick={() => setTakedown(true)}>
                撤下帖子
              </Button>
            )}
          </div>
        </article>

        <aside className="space-y-4">
          <div className="overflow-hidden rounded-xl bg-surface">
            <div className="h-24 border-b border-line">
              <Cover id={post.author.id} nickname={post.author.nickname} cover={post.author.cover} studyType={post.author.studyType} className="h-full w-full" />
            </div>
            <div className="p-4">
              <p className="text-[13px] text-ink-3">发起人</p>
              <p className="mt-1">
                <Nickname name={post.author.nickname} size={17} />
              </p>
              <p className="text-[14px] text-ink-2">{post.author.major || '专业未填'}</p>
              {type && (
                <p className="mt-2.5 flex items-center gap-2 text-[14px] text-ink-2">
                  <Seal char={type.glyph} tone={type.tone} size={22} />
                  {type.label}
                </p>
              )}
              {post.author.published ? (
                <Link to={`/u/${post.author.id}`} className="mt-4 flex h-10 items-center justify-center rounded-lg bg-brand text-[14px] font-semibold text-white transition-colors hover:bg-brand-2">
                  查看发起人主页
                </Link>
              ) : (
                <p className="mt-4 rounded-lg bg-paper-2 px-3 py-2 text-[13px] text-ink-3">发起人的主页暂时不在广场上</p>
              )}
            </div>
          </div>

          {post.interestedUsers && post.interestedUsers.length > 0 && (
            <div className="rounded-xl bg-surface p-4">
              <p className="mb-2 text-[14px] font-semibold text-ink">感兴趣的同学（{post.interestedUsers.length}）</p>
              <ul>
                {post.interestedUsers.map((u) => (
                  <li key={u.id}>
                    <Link to={`/u/${u.id}`} className="-mx-2 flex items-center gap-2.5 rounded-lg px-2 py-1.5 transition-colors hover:bg-paper-2">
                      <span className="size-7 overflow-hidden rounded-md">
                        <Cover id={u.id} nickname={u.nickname} cover={u.cover} studyType="" className="h-full w-full" />
                      </span>
                      <Nickname name={u.nickname} size={14} className="flex-1" />
                      <ChevronRight size={15} className="text-ink-4" />
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <p className="px-1 text-[12.5px] text-ink-3">发布于 {fullDateTime(post.createdAt)}</p>
        </aside>
      </div>

      <ConfirmDialog
        open={del}
        tone="danger"
        title="删除这条招募？"
        desc="删除后无法恢复，感兴趣的同学也将看不到它。"
        confirmText="删除"
        loading={busy}
        onCancel={() => setDel(false)}
        onConfirm={async () => {
          setBusy(true);
          try {
            await api.deletePost(post.id);
            toast.success('已删除');
            nav('/events');
          } catch (e) {
            toast.error('删除失败', e instanceof ApiError ? e.message : undefined);
          } finally {
            setBusy(false);
          }
        }}
      />
      <ReportDialog open={report} onClose={() => setReport(false)} targetType="post" targetId={post.id} />
      <TakedownDialog open={takedown} onClose={() => setTakedown(false)} type="post" id={post.id} label={post.title} onDone={() => nav('/events')} />
    </div>
  );
}
