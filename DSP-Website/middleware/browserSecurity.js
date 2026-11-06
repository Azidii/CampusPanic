import { config } from '../config/config.js';

export function sameOrigin(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.get('Sec-Fetch-Site') === 'cross-site') return res.status(403).json({ success: false, message: 'Same-origin request required.' });
  const origin = req.get('Origin');
  if (origin) {
    try {
      const allowed = new Set([`${req.protocol}://${req.get('host')}`, new URL(config.clientUrl).origin]);
      if (!allowed.has(new URL(origin).origin)) throw new Error();
    } catch { return res.status(403).json({ success: false, message: 'Same-origin request required.' }); }
  }
  next();
}
