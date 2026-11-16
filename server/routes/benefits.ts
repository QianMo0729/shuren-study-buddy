import { Router } from 'express';
import { HttpError, rateLimit, requireAdmin, requireUser, sha256, clientKey } from '../auth.ts';
import { benefitStatus, claimMarginNote, myMarginNoteCode, registerXmind, startBenefitVisit, xmindRegistrations } from '../benefits.ts';

export const benefitsRouter = Router();

benefitsRouter.get('/status', (_req, res) => res.json(benefitStatus()));
benefitsRouter.post('/xmind/visit', requireUser, (req, res) => {
  rateLimit(`benefit:visit:${req.user!.id}`, 30, 3_600_000);
  res.json(startBenefitVisit(req.user!.id));
});
benefitsRouter.post('/xmind/register', requireUser, (req, res) => {
  rateLimit(`benefit:register:${req.user!.id}`, 10, 60_000);
  res.json(registerXmind(req.user!.id, req.body ?? {}));
});

// A partner credential grants only access to this list, never to other admin APIs.
benefitsRouter.get('/xmind/registrations', (req, res, next) => {
  if (req.user?.role === 'admin') return next();
  rateLimit(`benefit:list:${clientKey(req)}`, 60, 60_000);
  const expected = process.env.XMIND_LIST_TOKEN?.trim();
  const supplied = req.headers.authorization?.replace(/^Bearer /, '');
  if (expected && supplied && expected.length >= 32 && supplied.length <= 256 && sha256(expected) === sha256(supplied)) return next();
  return requireAdmin(req, res, next);
}, (req, res) => {
  const items = xmindRegistrations();
  if (req.query.format === 'csv') {
    res.setHeader('Content-Disposition', 'attachment; filename="xmind-registrations.csv"');
    return res.type('text/csv').send('\uFEFF序号,手机号,提交时间（北京时间）\r\n' + items.map((r) =>
      `${r.id},${r.phone},${new Date(r.createdAt).toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' })}`).join('\r\n'));
  }
  res.json({ items, limit: 200 });
});

benefitsRouter.get('/marginnote/mine', requireUser, (req, res) => res.json({ code: myMarginNoteCode(req.user!.id) }));
benefitsRouter.post('/marginnote/claim', requireUser, (req, res) => {
  rateLimit(`benefit:mn:${req.user!.id}`, 10, 60_000);
  if (req.body?.acceptTerms !== true) throw new HttpError(400, '请先阅读并同意兑换及续订说明');
  res.json(claimMarginNote(req.user!.id));
});
