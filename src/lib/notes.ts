import type { PrivateNote } from '../../shared/types';
import { del, get, put } from './api';

export const notesApi = {
  get: (targetId: number) => get<{ privateNote: PrivateNote | null }>(`/notes/${targetId}`),
  save: (targetId: number, value: Pick<PrivateNote, 'remarkName' | 'note'>) => put<{ privateNote: PrivateNote | null }>(`/notes/${targetId}`, value),
  remove: (targetId: number) => del<{ ok: true }>(`/notes/${targetId}`),
};
