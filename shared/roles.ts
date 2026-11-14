import type { Role } from './types.ts';

/** 管理员与审核员都能处理内容（撤下、举报、抽检、Bonus）；只有管理员能改设置和授权 */
export const isStaff = (role: Role | string | null | undefined): boolean => role === 'admin' || role === 'moderator';

export const ROLE_LABELS: Record<Role, string> = { user: '同学', moderator: '审核员', admin: '管理员' };

export function normalizeRole(value: unknown): Role {
  return value === 'admin' || value === 'moderator' ? value : 'user';
}
