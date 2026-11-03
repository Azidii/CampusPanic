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
  if (!session || Date.now() - session.activity >= 3000) return res.status(503).end();
  if (videoService.ready && session.workerConnected) {
    try {
      const response = await videoService.request(`/nodes/${encodeURIComponent(id)}/frame.jpg`, { signal: AbortSignal.timeout(1200) });
      if (response.ok) {
        const frame = Buffer.from(await response.arrayBuffer());
        if (videoService.sessions.get(id) !== session) return res.status(503).end();
        return res.type('image/jpeg').send(frame);
      }
    } catch { /* Fall back to the authenticated Android frame. */ }
  }
  if (videoService.sessions.get(id) !== session || !session.lastFrame || Date.now() - session.frameAt >= 3000) return res.status(503).end();
  return res.type('image/jpeg').send(session.lastFrame);
});
export default router;
