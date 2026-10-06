import assert from 'node:assert/strict';
import test from 'node:test';
import { emptyProfile } from '../shared/profileRules.ts';
import { LOCAL_DRAFT_TTL_MS, localDraftExpired, purgeAccountDrafts, restoreQuestionnaireDraft, type QuestionnaireSnapshot } from '../src/lib/questionnaireDraft.ts';

const at = (seconds: number) => Date.parse('2026-10-04T10:00:00.000Z') + seconds * 1000;
const draft = (bio: string, seconds: number, pending?: boolean): QuestionnaireSnapshot => ({
  form: { ...emptyProfile(), bio }, section: 'expectations', at: at(seconds), pending,
});
const base = draft('已提交内容', 0);

test('unacknowledged typing survives an older request that finishes after the edit', () => {
  const local = draft('较新的本地输入', 2, true);
  const remote = draft('先前发出的快照', 3);
  const recovered = restoreQuestionnaireDraft({ base, remote, local, savedAt: new Date(at(0)).toISOString() });
  assert.equal(recovered.snapshot, local);
  assert.equal(recovered.server, remote);
  assert.equal(recovered.restored, true);
});

test('partial submit success does not displace a pending local answer with an older server draft', () => {
  const local = draft('提交后待重试的完整答案', 2, true);
  const submitted = draft(local.form.bio, 3);
  const remote = draft('提交前的旧草稿', 1);
  // PUT profile succeeded at an exact second, then publish and draft sync failed.
  const recovered = restoreQuestionnaireDraft({ base: submitted, remote, local, savedAt: new Date(at(3)).toISOString() });
  assert.equal(recovered.snapshot, local);
  assert.equal(recovered.server, submitted);
});

test('legacy local and remote drafts older than the saved profile cannot resurrect old answers', () => {
  const recovered = restoreQuestionnaireDraft({
    base, local: draft('旧格式本地草稿', 1), remote: draft('旧远端草稿', 2),
    savedAt: new Date(at(3)).toISOString(),
  });
  assert.equal(recovered.snapshot, base);
  assert.equal(recovered.server, base);
  assert.equal(recovered.restored, false);
});

test('acknowledged local copies never replace a newer remote draft, even with a fast device clock', () => {
  const local = draft('已确认的旧内容', 100, false);
  const remote = draft('另一台设备的新内容', 3);
  const recovered = restoreQuestionnaireDraft({ base, local, remote, savedAt: new Date(at(0)).toISOString() });
  assert.equal(recovered.snapshot, remote);
  assert.equal(recovered.server, remote);
});

test('legacy unsynced edits are recoverable only when newer than both server copies', () => {
  const local = draft('旧格式未同步输入', 4);
  const remote = draft('远端内容', 3);
  assert.equal(restoreQuestionnaireDraft({ base, local, remote, savedAt: new Date(at(2)).toISOString() }).snapshot, local);
  assert.equal(restoreQuestionnaireDraft({ base, local: draft('更旧本地内容', 2), remote, savedAt: new Date(at(0)).toISOString() }).snapshot, remote);
});

test('second-precision timestamps preserve a remote draft saved in the same second as the profile', () => {
  const remote = draft('同一秒内继续填写的内容', 3);
  const recovered = restoreQuestionnaireDraft({ base, local: null, remote, savedAt: new Date(at(3)).toISOString() });
  assert.equal(recovered.snapshot, remote);
  assert.equal(recovered.server, remote);
});

test('without a submitted timestamp, first-time local drafts restore and an empty account uses its base', () => {
  const local = draft('新同学未同步的填写内容', 1);
  assert.equal(restoreQuestionnaireDraft({ base, local, remote: null, savedAt: null }).snapshot, local);
  const recovered = restoreQuestionnaireDraft({ base, local: null, remote: null, savedAt: null });
  assert.equal(recovered.snapshot, base);
  assert.equal(recovered.restored, false);
});

/** A minimal in-memory stand-in for the browser's localStorage. */
function fakeStorage(entries: Record<string, string>) {
  const map = new Map(Object.entries(entries));
  return {
    get length() { return map.size; },
    key: (index: number) => [...map.keys()][index] ?? null,
    removeItem: (key: string) => { map.delete(key); },
    keys: () => [...map.keys()].sort(),
  };
}
const leftovers = () => fakeStorage({
  'dz-draft-7': '{"form":{"realName":"张三"}}', 'dz:forum-draft:7': '{"body":"没发出的帖子"}',
  'dz-draft-8': '{"form":{"realName":"李四"}}', 'dz:forum-draft:8': '{"body":"另一位同学的草稿"}',
  'dz-draft-undefined': '{}', 'dz:forum-draft:anon': '{}',
  'dz-skip-anim': '1', 'dz:checkin-visibility': 'all',
});

test('logging out, an expired session and account deletion leave no draft of any account on the device', () => {
  const storage = leftovers();
  assert.equal(purgeAccountDrafts(storage, null), 6);
  assert.deepEqual(storage.keys(), ['dz-skip-anim', 'dz:checkin-visibility'], 'only non-account preferences remain');
});

test('signing in keeps only the current account’s drafts; another account’s leftovers are removed', () => {
  const storage = leftovers();
  assert.equal(purgeAccountDrafts(storage, 7), 4);
  assert.deepEqual(storage.keys(), ['dz-draft-7', 'dz-skip-anim', 'dz:checkin-visibility', 'dz:forum-draft:7']);
  // Account 70 must not be mistaken for account 7.
  const similar = fakeStorage({ 'dz-draft-7': '{}', 'dz-draft-70': '{}' });
  purgeAccountDrafts(similar, 70);
  assert.deepEqual(similar.keys(), ['dz-draft-70']);
});

test('an unsynced local draft is only recoverable for a limited time', () => {
  const now = at(0);
  assert.equal(localDraftExpired(now - LOCAL_DRAFT_TTL_MS + 1000, now), false);
  assert.equal(localDraftExpired(now - LOCAL_DRAFT_TTL_MS - 1000, now), true);
});
