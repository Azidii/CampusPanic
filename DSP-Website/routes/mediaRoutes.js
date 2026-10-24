import express from 'express';
import rateLimit from 'express-rate-limit';
import { requireAuth } from '../middleware/auth.js';
import { videoService } from '../services/videoService.js';

const router = express.Router();
router.use(rateLimit({ windowMs: 60_000, max: 12000, standardHeaders: true, legacyHeaders: false }));
router.get('/:nodeId/frame.jpg', requireAuth, async (req, res) => {
  const id = req.params.nodeId.toUpperCase();
  const session = videoService.sessions.get(id);
  res.set('Cache-Control', 'no-store');
  if (!session || Date.now() - session.activity >= 3000 || !videoService.ready) return res.status(503).end();
  try {
    const response = await videoService.request(`/nodes/${encodeURIComponent(id)}/frame.jpg`);
    if (!response.ok) return res.status(response.status).end();
    const frame = Buffer.from(await response.arrayBuffer());
    if (videoService.sessions.get(id) !== session) return res.status(503).end();
    return res.type('image/jpeg').send(frame);
  } catch { return res.status(503).end(); }
});
export default router;
