export const STUDENT_EMAIL_DOMAIN = 'mail.sustech.edu.cn';
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_BYTES = 72;
export const PASSWORD_HINT = '至少 8 位，包含英文字母和数字，最长 72 字节';

/** Keep the browser and server aligned; bcrypt must never silently truncate a password. */
export function passwordError(value: unknown): string | null {
  if (typeof value !== 'string' || [...value].length < PASSWORD_MIN_LENGTH) {
    return '密码至少需要 8 位';
  }
  if (new TextEncoder().encode(value).length > PASSWORD_MAX_BYTES) {
    return '密码过长，请控制在 72 字节以内（中文等字符会占用多个字节）';
  }
  if (!/[a-zA-Z]/.test(value) || !/[0-9]/.test(value)) {
    return '密码需同时包含英文字母和数字';
  }
  return null;
}

export function normalizeStudentEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  return /^[0-9]{8}@mail\.sustech\.edu\.cn$/.test(email) ? email : null;
}
