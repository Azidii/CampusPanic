import express from 'express';
import rateLimit from 'express-rate-limit';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { Node } from '../models/Node.js';
import { videoService } from '../services/videoService.js';
import { audioService } from '../services/audioService.js';
import { hashCode } from '../services/nodePairing.js';
import audioRoutes from './audioRoutes.js';

const router = express.Router();
const failure = (res, code, error) => res.status(code).json({ error });

router.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

const pairLimiter = rateLimit({
  windowMs: 60_000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many pairing attempts. Wait one minute.' }
});

const frameLimiter = rateLimit({
  windowMs: 60_000,
  max: 12000,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Camera transmission limit reached. Reduce the upload rate.' }
});

// Mount audio chunk endpoint under /api/camera/audio
router.use('/audio', audioRoutes);

router.post('/connect', pairLimiter, async (req, res, next) => {
  try {
    const code = req.get('X-Camera-Token') || '';
    if (!/^\d{8}$/.test(code)) return failure(res, 401, 'Pairing code rejected');
    const node = await Node.findOne({
      pairingHash: hashCode(code),
      videoEnabled: true,
      pairingExpiresAt: { $gt: new Date() }
    }).select('+pairingHash');

    if (!node) return failure(res, 401, 'Pairing code expired or incorrect. Generate a new code in Security Nodes.');
    if (!videoService.ready) return failure(res, 503, videoService.message);

    const id = node.nodeId;
    if (videoService.pending.has(id)) return failure(res, 409, 'Connection is being updated; retry');
    videoService.pending.add(id);

    try {
      const existing = videoService.sessions.get(id);
      if (existing && Date.now() - existing.activity < 3000) {
        return failure(res, 409, 'This node already has a connected camera');
      }

      await videoService.revoke(id);
      await audioService.closeSession(id, existing?.id);

      const sessionId = randomBytes(24).toString('hex');
      const response = await videoService.request(`/nodes/${encodeURIComponent(id)}/session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId })
      });

      if (!response.ok) {
        return failure(res, response.status, 'Cannot connect another node. The model service may be at capacity.');
      }

      // Initialize audio worker session as well
      await audioService.openSession(id, sessionId);

      videoService.sessions.set(id, {
        id: sessionId,
        tokenHash: node.pairingHash,
        activity: Date.now(),
        savedAt: 0,
        clientDetections: []
      });

      return res.status(201).json({ sessionId, nodeId: id });
    } finally {
      videoService.pending.delete(id);
    }
  } catch (error) {
    next(error);
  }
});

function authenticateSession(req, res, next) {
  const sessionId = req.get('X-Camera-Session') || '';
  const code = req.get('X-Camera-Token') || '';
  if (!/^\d{8}$/.test(code)) return failure(res, 401, 'Pairing code rejected');

  const tokenHash = hashCode(code);
  const entry = [...videoService.sessions.entries()].find(([, session]) => session.id === sessionId);
  if (!entry) return failure(res, 409, 'Camera session expired; reconnect');

  const [nodeId, session] = entry;
  if (!timingSafeEqual(Buffer.from(tokenHash), Buffer.from(session.tokenHash))) {
    return failure(res, 401, 'Pairing code rejected');
  }

  if (Date.now() - session.activity >= 5000) {
    videoService.revoke(nodeId);
    audioService.closeSession(nodeId, session.id);
    return failure(res, 409, 'Camera session expired; reconnect');
  }

  req.camera = { nodeId, session };
  next();
}

/**
 * Endpoint for phone to report on-device TFLite gun detections
 */
router.post('/detection', authenticateSession, express.json({ limit: '64kb' }), async (req, res) => {
  const { nodeId, session } = req.camera;
  const { detections, inferenceMs } = req.body || {};
  session.activity = Date.now();
  session.clientDetections = {
    detections: Array.isArray(detections) ? detections : [],
    inferenceMs: Number(inferenceMs) || 0,
    timestamp: Date.now()
  };
  return res.json({ success: true, count: session.clientDetections.detections.length });
});

router.post(
  '/frame',
  frameLimiter,
  authenticateSession,
  (req, res, next) => (req.is('image/jpeg') ? next() : failure(res, 415, 'Expected image/jpeg')),
  express.raw({ type: 'image/jpeg', limit: '2mb' }),
  async (req, res, next) => {
    try {
      const { nodeId, session } = req.camera;
      if (session.uploading) return failure(res, 429, 'Wait for the previous frame');
      session.uploading = true;
      try {
        const response = await videoService.request(`/nodes/${encodeURIComponent(nodeId)}/frame`, {
          method: 'POST',
          headers: { 'Content-Type': 'image/jpeg', 'X-Camera-Session': session.id },
          body: req.body
        });
        const data = await response.json();
        if (videoService.sessions.get(nodeId) !== session) return failure(res, 409, 'Camera session revoked; pair again');

        if (response.ok) {
          session.activity = Date.now();
          if (Date.now() - session.savedAt > 10_000) {
            session.savedAt = Date.now();
            await Node.updateOne({ nodeId }, { lastSeen: new Date() });
          }
        }
        return res.status(response.status).json(data);
      } finally {
        session.uploading = false;
      }
    } catch (error) {
      next(error);
    }
  }
);

router.post('/disconnect', authenticateSession, async (req, res) => {
  const { nodeId, session } = req.camera;
  await videoService.revoke(nodeId);
  await audioService.closeSession(nodeId, session.id);
  res.sendStatus(204);
});

router.use((error, req, res, next) => {
  const status = error.type === 'entity.too.large' ? 413 : 503;
  failure(res, status, status === 413 ? 'Payload exceeds size limit' : 'Model service unavailable. Check the laptop receiver.');
});

export default router;
