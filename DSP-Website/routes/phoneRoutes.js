import express from 'express';
import rateLimit from 'express-rate-limit';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { Node } from '../models/Node.js';
import { videoService } from '../services/videoService.js';
import { audioService } from '../services/audioService.js';
import { hashCode } from '../services/nodePairing.js';
import audioRoutes from './audioRoutes.js';
import { cameraTelemetry, nodeHud, recordVisionThreat, validGunDetections } from '../services/threatState.js';

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

    const id = node.nodeId;
    if (videoService.pending.has(id)) return failure(res, 409, 'Connection is being updated; retry');
    videoService.pending.add(id);

    try {
      const existing = videoService.sessions.get(id);
      if (existing && Date.now() - existing.activity < 3000) {
        return failure(res, 409, 'This node already has a connected camera');
      }

      const capacity = Math.min(64, Math.max(1, Number(process.env.VIDEO_MAX_NODES) || 8));
      const active = [...videoService.sessions].filter(([nodeId, session]) =>
        nodeId !== id && Date.now() - session.activity < 5000).length;
      if (active + videoService.pending.size > capacity) return failure(res, 503, 'Camera capacity reached');
      await videoService.revoke(id);
      await audioService.closeSession(id, existing?.id);

      const sessionId = randomBytes(24).toString('hex');
      let workerConnected = false;
      if (videoService.ready) {
        try {
          const response = await videoService.request(`/nodes/${encodeURIComponent(id)}/session`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId })
          });
          workerConnected = response.ok;
        } catch { /* Direct CCTV remains available while inference is unavailable. */ }
      }

      // Initialize audio worker session as well
      await audioService.openSession(id, sessionId);

      videoService.sessions.set(id, {
        id: sessionId,
        tokenHash: node.pairingHash,
        activity: Date.now(),
        savedAt: 0,
        clientDetections: [], workerConnected, workerRetryAt: 0,
        telemetry: cameraTelemetry(req.headers), lastFrame: null, frameAt: 0
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
router.post('/detection', authenticateSession, express.json({ limit: '64kb' }), async (req, res, next) => {
  try {
    const { nodeId, session } = req.camera;
    const detections = validGunDetections(req.body?.detections);
    session.activity = Date.now();
    session.clientDetections = { detections, inferenceMs: Math.max(0, Number(req.body?.inferenceMs) || 0), timestamp: Date.now() };
    const alert = await recordVisionThreat(nodeId, detections);
    res.json({ success: true, count: detections.length, alertId: alert?._id || null });
  } catch (error) { next(error); }
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
        if (!Buffer.isBuffer(req.body) || req.body.length < 4 || req.body[0] !== 0xFF || req.body[1] !== 0xD8) {
          return failure(res, 400, 'Invalid JPEG frame');
        }
        session.lastFrame = req.body;
        session.frameAt = Date.now();
        session.activity = Date.now();
        session.telemetry = cameraTelemetry(req.headers);
        let responseStatus = 200;
        let data = { success: true, status: 'live', inferenceAvailable: false };
        if (videoService.ready) {
          try {
            if (!session.workerConnected && Date.now() - session.workerRetryAt >= 3000) {
              session.workerRetryAt = Date.now();
              const opened = await videoService.request(`/nodes/${encodeURIComponent(nodeId)}/session`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: session.id }),
                signal: AbortSignal.timeout(1200)
              });
              session.workerConnected = opened.ok;
            }
            if (session.workerConnected) {
              const response = await videoService.request(`/nodes/${encodeURIComponent(nodeId)}/frame`, {
                method: 'POST', headers: { 'Content-Type': 'image/jpeg', 'X-Camera-Session': session.id },
                body: req.body, signal: AbortSignal.timeout(1200)
              });
              if (response.ok) { responseStatus = response.status; data = { ...(await response.json()), inferenceAvailable: true }; }
              else session.workerConnected = false;
            }
          } catch { session.workerConnected = false; }
        }
        if (videoService.sessions.get(nodeId) !== session) return failure(res, 409, 'Camera session revoked; pair again');
        if (Date.now() - session.savedAt > 10000) {
          session.savedAt = Date.now();
          await Node.updateOne({ nodeId }, { lastSeen: new Date() });
        }
        if (!session.hudAt || Date.now() - session.hudAt >= 1000) {
          session.hud = await nodeHud(nodeId, session);
          session.hudAt = Date.now();
        }
        return res.status(responseStatus).json({ ...data, hud: session.hud });
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
