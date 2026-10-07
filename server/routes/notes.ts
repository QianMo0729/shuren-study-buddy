import { Router, type Request } from 'express';
import { HttpError, rateLimit, requireUser } from '../auth.ts';
import { canNoteTarget, deletePrivateNote, noteForOwner, savePrivateNote } from '../notes.ts';

export const notesRouter = Router();
notesRouter.use(requireUser);

function targetFor(req: Request): number {
  const raw = String(req.params.targetId);
  const targetId = Number(raw);
  if (!/^\d{1,15}$/.test(raw) || !Number.isSafeInteger(targetId) || targetId < 1 || !canNoteTarget(req.user!.id, targetId)) {
    throw new HttpError(404, '这位同学暂不可备注');
  }
  return targetId;
}

notesRouter.get('/:targetId', (req, res) => {
  const targetId = targetFor(req);
  res.json({ privateNote: noteForOwner(req.user!.id, targetId) });
});

notesRouter.put('/:targetId', (req, res) => {
  const targetId = targetFor(req);
  rateLimit(`notes:${req.user!.id}`, 60, 60_000);
  res.json({ privateNote: savePrivateNote(req.user!.id, targetId, req.body) });
});

notesRouter.delete('/:targetId', (req, res) => {
  const targetId = targetFor(req);
  deletePrivateNote(req.user!.id, targetId);
  res.json({ ok: true });
});
