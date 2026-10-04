// 各功能模块在此登记自己的数据处理方式，避免公共路由（文件访问、举报、评论、注销）依赖具体模块。
// 模块在被 server/index.ts 引入时完成登记，此后才开始处理请求。
import type { ForumTargetType, ReportTargetType } from '../shared/types.ts';

// ---------- 注销账号时的清理 ----------

type Cleanup = (userId: number) => void;
const cleanups: Cleanup[] = [];

/** 注销时在同一事务中调用；只能做数据库操作，不能有异步副作用 */
export function registerAccountCleanup(fn: Cleanup) {
  cleanups.push(fn);
}

export function runAccountCleanup(userId: number) {
  for (const fn of cleanups) fn(userId);
}

// ---------- 上传文件的访问权限 ----------

export interface FileViewer {
  id: number;
  role: 'user' | 'admin';
}
/** 返回 true 才允许非本人、非管理员读取该文件 */
type FileAccess = (viewer: FileViewer, ownerId: number, name: string) => boolean;
const fileAccess = new Map<string, FileAccess>();

export function registerFileAccess(kind: string, fn: FileAccess) {
  fileAccess.set(kind, fn);
}

export function fileAccessFor(kind: string): FileAccess | undefined {
  return fileAccess.get(kind);
}

// ---------- 举报对象 ----------

export interface ReportTarget {
  /** 举报对象存在且举报人有权看到它 */
  canReport(reporterId: number, id: number): boolean;
  /** 管理后台展示的简短标签 */
  label(id: number): string;
  /** 被举报内容的所有者（可能已注销） */
  ownerOf(id: number): number | null;
  /** 需要在举报时留存的内容快照（例如私聊消息原文），会附在举报详情后 */
  snapshot?(id: number): string;
}
const reportTargets = new Map<ReportTargetType, ReportTarget>();

export function registerReportTarget(type: ReportTargetType, target: ReportTarget) {
  reportTargets.set(type, target);
}

export function reportTargetFor(type: ReportTargetType): ReportTarget | undefined {
  return reportTargets.get(type);
}

// ---------- 可评论、可点赞的社区内容 ----------

export interface ContentTarget {
  /** 当前用户能否看到该内容（已删除、被撤下、不可见的都返回 false；作者本人与管理员另行判断） */
  canView(viewerId: number, id: number): boolean;
  ownerOf(id: number): number | null;
  label(id: number): string;
  /** 详情页链接，用于站内通知 */
  link(id: number): string;
}
const contentTargets = new Map<ForumTargetType, ContentTarget>();

export function registerContentTarget(type: ForumTargetType, target: ContentTarget) {
  contentTargets.set(type, target);
}

export function contentTargetFor(type: ForumTargetType): ContentTarget | undefined {
  return contentTargets.get(type);
}
