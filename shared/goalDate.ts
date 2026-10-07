export const MAX_GOAL_DATE = '2100-12-31';

/** Match the questionnaire's existing Beijing-date boundary in every timezone. */
export const beijingToday = (now = Date.now()) => new Date(now + 8 * 3_600_000).toISOString().slice(0, 10);

/** An eight-digit editor value, including incomplete input while typing. */
export const goalDateInput = (value: string) => value.normalize('NFKC').replace(/\D/g, '').slice(0, 8);

/** Empty is optional; invalid or unfinished dates must not become empty answers. */
export function goalDateToIso(value: string): string | null {
  if (value === '') return '';
  const digits = /^\d{4}-\d{2}-\d{2}$/.test(value) ? value.replace(/-/g, '') : value;
  if (!/^\d{8}$/.test(digits)) return null;
  const iso = `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
  const date = new Date(`${iso}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === iso ? iso : null;
}

export function goalDateError(value: string, earliest = beijingToday()): string | null {
  const iso = goalDateToIso(value);
  if (iso === '') return null;
  if (iso === null) {
    return /^\d{1,7}$/.test(value)
      ? '请填写完整的 8 位日期（YYYYMMDD），如 20261231；也可以清除后留空。'
      : '日期不存在或格式不正确，请按 YYYYMMDD 填写真实日期，如 20261231。';
  }
  if (iso < earliest) return `目标日期不能早于北京时间今天（${goalDateInput(earliest)}）。`;
  if (iso > MAX_GOAL_DATE) return '目标日期不能晚于 21001231。';
  return null;
}

/** Drafts retain safe raw digits so autosave never erases unfinished dates. */
export function preserveDraftGoalDate(raw: unknown, sanitized: string): string {
  return typeof raw === 'string' && /^\d{0,8}$/.test(raw) ? raw : sanitized;
}
