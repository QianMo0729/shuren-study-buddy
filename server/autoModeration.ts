import { assessContentRisk } from './contentRisk.ts';
import { db, q, tx } from './db.ts';

export type ModeratedTable = 'profiles' | 'posts' | 'forum_posts' | 'forum_comments' | 'checkins';
interface ReviewRow {
  auto_held?: number;
  risk_reasons?: string | null;
}

export function reviewState(row: ReviewRow, visible = true) {
  const reviewPending = visible && !!row.auto_held;
  let reviewReasons: string[] = [];
  if (reviewPending) {
    try {
      const parsed: unknown = JSON.parse(row.risk_reasons ?? '[]');
      if (Array.isArray(parsed)) reviewReasons = parsed.filter((reason): reason is string => typeof reason === 'string');
    } catch { /* Old or malformed metadata must not break reading content. */ }
  }
  return { reviewPending, reviewReasons };
}

/** Only fields displayed on the public profile; never identity or contact details. */
export function publicProfileText(input: unknown): string {
  if (!input || typeof input !== 'object') return '';
  const data = input as Record<string, unknown>;
  return [
    'major', 'studyPlan', 'mbti', 'bio', 'expectations', 'dislikes', 'goalResearch', 'goalSkills', 'goalOther',
    'futurePlanOther', 'placesOther', 'expectedPlacesOther', 'traitsOther', 'sportsOther', 'arts',
    'studyMethodsOther', 'interestsOther',
  ].map((key) => typeof data[key] === 'string' ? data[key] : '').filter(Boolean).join('\n');
}

/** Re-screen publication/edit. A previous human takedown can only be restored by an admin. */
export function applyAutoModeration(table: ModeratedTable, id: number, text: string) {
  const key = table === 'profiles' ? 'user_id' : 'id';
  const row = q.get<ReviewRow & { taken_down: number; published?: number; deleted?: number }>(`SELECT * FROM ${table} WHERE ${key} = ?`, id);
  if (!row) return { reviewPending: false, reviewReasons: [] as string[] };
  if (row.deleted || (table === 'profiles' && !row.published) || (row.taken_down && !row.auto_held)) return reviewState(row);
  const risk = assessContentRisk(text);
  q.run(
    `UPDATE ${table} SET auto_held = ?, risk_reasons = ?, taken_down = ?, taken_down_at = NULL, takedown_reason = NULL,
       reviewed_at = CASE WHEN ? = 1 THEN NULL ELSE datetime('now') END WHERE ${key} = ?`,
    risk.hold ? 1 : 0, JSON.stringify(risk.hold ? risk.reasons : []), risk.hold ? 1 : 0, risk.hold ? 1 : 0, id,
  );
  return { reviewPending: risk.hold, reviewReasons: risk.hold ? risk.reasons : [] };
}

/** Called after every content table exists. Existing drafts and human decisions are untouched. */
export function initializeAutoModeration() {
  const tables: ModeratedTable[] = ['profiles', 'posts', 'forum_posts', 'forum_comments', 'checkins'];
  tx(() => {
    for (const table of tables) {
      const columns = new Set(q.all<{ name: string }>(`PRAGMA table_info(${table})`).map((column) => column.name));
      if (!columns.has('auto_held')) db.exec(`ALTER TABLE ${table} ADD COLUMN auto_held INTEGER NOT NULL DEFAULT 0`);
      if (!columns.has('risk_reasons')) db.exec(`ALTER TABLE ${table} ADD COLUMN risk_reasons TEXT NOT NULL DEFAULT '[]'`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_${table}_auto_held ON ${table}(auto_held) WHERE auto_held = 1`);
      const condition = table === 'profiles' ? 'published = 1' : 'deleted = 0';
      const rows = q.all<Record<string, any>>(`SELECT * FROM ${table} WHERE ${condition} AND taken_down = 0 AND reviewed_at IS NULL AND auto_held = 0`);
      for (const row of rows) {
        let text = '';
        if (table === 'profiles') {
          try { text = publicProfileText(JSON.parse(row.data)); } catch { /* An invalid profile has no public text. */ }
        } else if (table === 'posts') text = [row.title, row.description, row.time_text, row.location, row.tags].join('\n');
        else if (table === 'forum_posts') text = `${row.title}\n${row.body}`;
        else if (table === 'forum_comments') text = row.body;
        else text = row.caption;
        applyAutoModeration(table, table === 'profiles' ? row.user_id : row.id, text);
      }
    }
  });
}
