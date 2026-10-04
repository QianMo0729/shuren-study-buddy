import { useCallback, useEffect, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router';
import { ChevronLeft, Flag, Pencil, ShieldX, Trash2 } from 'lucide-react';
import type { ForumPost } from '../../shared/types';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { fullDateTime } from '../lib/format';
import { useToast } from '../lib/toast';
import { Button, ConfirmDialog, Skeleton } from '../components/ui';
import { ReportDialog, TakedownDialog } from '../components/moderation';
import { AuthorLine } from '../components/forum/AuthorLine';
import { Comments } from '../components/forum/Comments';
import { LikeButton } from '../components/forum/LikeButton';
import { ImageGrid, ImageLightbox } from '../components/forum/PostImages';
import { PostComposer } from '../components/forum/PostComposer';
import { excerpt } from '../components/forum/text';

/** 社区帖子详情：全文、图片大图、点赞、评论；作者可编辑 / 删除；他人可举报；管理员可撤下 */
export function ForumPostDetail() {
  const { id } = useParams();
  const postId = Number(id);
  const { user } = useAuth();
  const toast = useToast();
  const nav = useNavigate();
  const location = useLocation();
  const [post, setPost] = useState<ForumPost | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [report, setReport] = useState(false);
  const [takedown, setTakedown] = useState(false);
  const [viewing, setViewing] = useState<number | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const r = await api.forum.post(postId);
      setPost(r.post);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '帖子暂时无法加载');
    }
  }, [postId]);

  useEffect(() => {
    setPost(null);
    if (!Number.isSafeInteger(postId) || postId <= 0) setError('帖子不存在或已删除');
    else void load();
  }, [postId, load]);

  // 从社区进入时返回上一页（保留所在分区），直接打开链接时回到聊天区
  const back = () => (location.key !== 'default' ? nav(-1) : nav('/community?tab=talk'));
  const closeViewer = useCallback(() => setViewing(null), []);

  if (error)
    return (
      <div className="py-24 text-center">
        <p className="text-[16px] text-ink-2">{error}</p>
        <Button className="mt-5" onClick={() => nav('/community?tab=talk')}>
          返回校园社区
        </Button>
      </div>
    );
  if (!post)
    return (
      <div className="mx-auto max-w-3xl space-y-4 pt-10" aria-busy="true">
        <Skeleton className="h-6 w-32" />
        <Skeleton className="h-64 rounded-md" />
      </div>
    );

  const isAdmin = user?.role === 'admin';
  const edited = new Date(post.updatedAt).getTime() - new Date(post.createdAt).getTime() > 60_000;

  return (
    <div className="mx-auto max-w-3xl pt-5 sm:pt-8">
      <button type="button" onClick={back} className="-ml-1 mb-4 inline-flex items-center gap-0.5 text-[14px] text-ink-2 hover:text-ink">
        <ChevronLeft size={17} aria-hidden /> 校园社区
      </button>

      {post.takenDown && (
        <p className="mb-4 rounded-md bg-danger-soft px-4 py-3 text-[14px] text-danger" role="status">
          这条帖子已被管理员撤下{post.takedownReason ? `，原因：${post.takedownReason}` : ''}。{post.isMine ? '只有你和管理员能看到。' : '其他同学已看不到它。'}
        </p>
      )}

      {editing ? (
        <PostComposer
          post={post}
          onCancel={() => setEditing(false)}
          onDone={(next) => {
            setPost(next);
            setEditing(false);
          }}
        />
      ) : (
        <article className="rounded-md border border-line bg-surface p-4 sm:p-7" aria-labelledby="post-body">
          <AuthorLine author={post.author} time={post.createdAt} />
          {post.title && <h1 className="mt-4 font-display text-[24px] leading-snug text-ink sm:text-[30px]">{post.title}</h1>}
          <p id="post-body" className={post.title ? 'mt-3 text-[16px] leading-[1.8] whitespace-pre-wrap break-words text-ink' : 'mt-4 text-[17px] leading-[1.8] whitespace-pre-wrap break-words text-ink'}>
            {post.body}
          </p>
          <ImageGrid images={post.images} onOpen={setViewing} className="mt-4" />
          <p className="mt-4 text-[12.5px] text-ink-3">
            发布于 {fullDateTime(post.createdAt)}
            {edited && ` · 编辑于 ${fullDateTime(post.updatedAt)}`}
          </p>

          <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-3">
            {!post.takenDown && (
              <LikeButton type="post" id={post.id} liked={post.liked} count={post.likeCount} onChange={(r) => setPost({ ...post, liked: r.liked, likeCount: r.likeCount })} />
            )}
            <div className="ml-auto flex flex-wrap items-center gap-1.5">
              {post.isMine ? (
                <>
                  <Button size="sm" variant="ghost" icon={<Pencil size={14} />} onClick={() => setEditing(true)}>编辑</Button>
                  <Button size="sm" variant="ghost" icon={<Trash2 size={14} />} className="text-danger hover:bg-danger-soft hover:text-danger" onClick={() => setConfirmDelete(true)}>删除</Button>
                </>
              ) : (
                !post.takenDown && (
                  <button type="button" onClick={() => setReport(true)} className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-[13px] text-ink-3 hover:bg-danger-soft hover:text-danger">
                    <Flag size={14} aria-hidden /> 举报
                  </button>
                )
              )}
              {isAdmin && !post.takenDown && (
                <Button variant="dangerOutline" size="sm" icon={<ShieldX size={14} />} onClick={() => setTakedown(true)}>
                  撤下
                </Button>
              )}
            </div>
          </div>
        </article>
      )}

      <div className="mt-4">
        <Comments type="post" id={post.id} readOnly={post.takenDown} onCountChange={(n) => setPost((p) => (p ? { ...p, commentCount: n } : p))} />
      </div>

      <ImageLightbox images={post.images} index={viewing} onIndex={setViewing} onClose={closeViewer} />
      <ConfirmDialog
        open={confirmDelete}
        tone="danger"
        title="删除这条帖子？"
        desc="删除后无法恢复，其他同学将看不到它和下面的评论。"
        confirmText="删除"
        loading={deleting}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={async () => {
          setDeleting(true);
          try {
            await api.forum.remove(post.id);
            toast.success('已删除');
            nav('/community?tab=talk', { replace: true });
          } catch (e) {
            toast.error('删除失败', e instanceof ApiError ? e.message : undefined);
          } finally {
            setDeleting(false);
          }
        }}
      />
      {report && <ReportDialog open onClose={() => setReport(false)} targetType="forum_post" targetId={post.id} />}
      {takedown && (
        <TakedownDialog open onClose={() => setTakedown(false)} type="forum_post" id={post.id} label={post.title || excerpt(post.body)} onDone={() => void load()} />
      )}
    </div>
  );
}
