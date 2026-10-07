import { parseTisTimetable, type PrivateTimetable, type TimetableInput } from '../../shared/timetable';
import { get, put } from './api';

export const timetableApi = {
  get: () => get<{ timetable: PrivateTimetable | null }>('/timetables/me'),
  save: (data: TimetableInput) => put<{ timetable: PrivateTimetable }>('/timetables/me', data),
};

/** Parse locally. The original workbook never leaves the browser. */
export async function importTimetableFile(file: File) {
  if (!/\.xlsx$/i.test(file.name)) throw new Error('请上传 TIS 导出的 .xlsx 课表文件');
  if (file.size > 2 * 1024 * 1024) throw new Error('课表文件不能超过 2 MB');
  const { readSheet } = await import('read-excel-file/browser');
  try {
    return parseTisTimetable(await readSheet(file, 1));
  } catch (error) {
    if (error instanceof Error && /课表|周次|节次|文件中/.test(error.message)) throw error;
    throw new Error('无法读取这份 Excel，请重新从 TIS 导出未加密的 .xlsx 文件');
  }
}
