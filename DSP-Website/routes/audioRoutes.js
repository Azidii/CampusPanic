import express from 'express';
import rateLimit from 'express-rate-limit';
import { timingSafeEqual } from 'node:crypto';
import { videoService } from '../services/videoService.js';
import { audioService } from '../services/audioService.js';
import { hashCode } from '../services/nodePairing.js';

const router = express.Router();
const failure = (res, code, error) => res.status(code).json({ success: false, error });

router.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

// Up to 120 audio chunks per minute per client (1 chunk/sec typical, with headroom)
const audioLimiter = rateLimit({
  windowMs: 60_000,
  max: 180,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Audio transmission rate limit reached.' }
});

function authenticateAudioSession(req, res, next) {
  const sessionId = req.get('X-Camera-Session') || '';
  const code = req.get('X-Camera-Token') || '';

  if (!/^\d{8}$/.test(code)) return failure(res, 401, 'Pairing code rejected');
  const tokenHash = hashCode(code);

  const entry = [...videoService.sessions.entries()].find(([, session]) => session.id === sessionId);
  if (!entry) return failure(res, 409, 'Camera session expired or not found; reconnect');

  const [nodeId, session] = entry;
  if (!timingSafeEqual(Buffer.from(tokenHash), Buffer.from(session.tokenHash))) {
    return failure(res, 401, 'Pairing code rejected');
  }

  // Check activity timeout (allow 5 seconds for audio)
  if (Date.now() - session.activity >= 5000) {
    videoService.revoke(nodeId);
    audioService.closeSession(nodeId, session.id);
    return failure(res, 409, 'Session expired due to inactivity; reconnect');
  }

  req.nodeSession = { nodeId, session };
  next();
}

/**
 * Upload 1-second raw PCM audio chunk (16kHz 16-bit mono = ~32000 bytes)
 */
router.post(
  '/',
  audioLimiter,
  authenticateAudioSession,
  express.raw({ type: ['application/octet-stream', 'audio/pcm', 'audio/raw'], limit: '200kb' }),
  async (req, res, next) => {
    try {
      const { nodeId, session } = req.nodeSession;
      if (!audioService.ready) {
        return failure(res, 503, 'Audio CNN model service is initializing or unavailable');
      }

      const pcmBytes = req.body;
      if (!Buffer.isBuffer(pcmBytes) || pcmBytes.length < 1000) {
        return failure(res, 400, 'Invalid PCM audio payload. Expected ~32000 bytes.');
      }

      // Ensure audio worker has session opened
      await audioService.openSession(nodeId, session.id);

      // Forward chunk to audio worker
      const response = await audioService.request(`/nodes/${encodeURIComponent(nodeId)}/audio`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream',
          'X-Camera-Session': session.id
        },
        body: pcmBytes
      });

      const data = await response.json();
      if (!response.ok) {
        return failure(res, response.status, data.error || 'Audio analysis failed');
      }

      // Record result for live dashboard and handle alert triggering
      await audioService.recordResult(nodeId, data);

      // Return downstream classification to phone immediately
      return res.status(200).json({
        success: true,
        nodeId,
        class: data.class,
        confidence: data.confidence,
        alert: data.alert,
        threatType: data.threatType,
        probabilities: data.probabilities,
        inferenceMs: data.inferenceMs,
        timestamp: data.timestamp
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * Status route for querying current audio classification of a node
 */
router.get('/status/:nodeId', async (req, res) => {
  const state = audioService.getNodeAudio(req.params.nodeId);
  return res.json({ success: true, audio: state });
});

export default router;

