import type { ProfileInput, QuestionnaireSection } from '../../shared/types';

export type QuestionnaireSnapshot = {
  form: ProfileInput;
  section: QuestionnaireSection;
  at: number;
  /** Undefined identifies drafts created before explicit acknowledgement tracking. */
  pending?: boolean;
};

/** Select recovery data without confusing edit time with the server's write time. */
export function restoreQuestionnaireDraft({
  base, remote, local, savedAt,
}: {
  base: QuestionnaireSnapshot;
  remote: QuestionnaireSnapshot | null;
  local: QuestionnaireSnapshot | null;
  savedAt: string | null;
}) {
  const saved = Date.parse(savedAt ?? '') || 0;
  // Server timestamps have second precision. Equal timestamps may still describe
  // a draft written after the profile, so only discard a strictly older draft.
  const server = remote && remote.at >= saved ? remote : base;
  // Explicitly unacknowledged edits survive a partial submit and server clock skew.
  // Legacy drafts have no such signal; only recover them when demonstrably newer.
  const useLocal = local?.pending === true || (
    local?.pending === undefined && !!local && local.at > Math.max(saved, server.at)
  );
  const snapshot = useLocal ? local! : server;
  return { snapshot, server, restored: snapshot !== base };
}

// ---------- 本机草稿的生命周期 ----------
// 问卷草稿含真实姓名、联系方式等私密内容，发帖草稿是尚未公开的文字：它们只在“还没同步到服务器”期间留在本机，
// 并且只属于当前登录的账号。退出登录、会话失效、换号、注销之后都要清掉，不留给这台设备的下一位使用者。

/** 问卷草稿 dz-draft-<账号>、发帖草稿 dz:forum-draft:<账号> */
const ACCOUNT_DRAFT_KEY = /^(?:dz-draft-|dz:forum-draft:)(.*)$/;

/** 未同步的本机问卷草稿最多保留这么久，过期后不再恢复 */
export const LOCAL_DRAFT_TTL_MS = 7 * 86_400_000;

export const localDraftExpired = (at: number, now = Date.now()) => now - at > LOCAL_DRAFT_TTL_MS;

/** 清除本机上不属于 keepUserId 的草稿（null：没有登录账号，全部清除）；返回清除的条数 */
export function purgeAccountDrafts(storage: Pick<Storage, 'length' | 'key' | 'removeItem'>, keepUserId: number | null): number {
  const doomed: string[] = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    const owner = key === null ? undefined : ACCOUNT_DRAFT_KEY.exec(key)?.[1];
    if (key !== null && owner !== undefined && (keepUserId === null || owner !== String(keepUserId))) doomed.push(key);
  }
  for (const key of doomed) storage.removeItem(key);
  return doomed.length;
}
