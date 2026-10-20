import { Router } from 'express';
import { rateLimit, requireUser } from '../auth.ts';
import { getTimetable, saveTimetable } from '../timetables.ts';

export const timetableRouter = Router();
timetableRouter.use(requireUser);
timetableRouter.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
timetableRouter.get('/me', (req, res) => { res.json({ timetable: getTimetable(req.user!.id) }); });
timetableRouter.put('/me', (req, res) => {
  rateLimit(`timetable:${req.user!.id}`, 60, 60_000);
  res.json({ timetable: saveTimetable(req.user!.id, req.body) });
});
export default timetableRouter;
