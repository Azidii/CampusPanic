import express from 'express';
import { Alert } from '../models/Alert.js';
import { Node } from '../models/Node.js';
import { requireAuth } from '../middleware/auth.js';
import { videoService } from '../services/videoService.js';

const router = express.Router();
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const [documents, alerts] = await Promise.all([
      Node.find().sort({ building: 1, room: 1 }),
      Alert.find().sort({ priority: 1, timestamp: -1 }).limit(100)
    ]);
    const nodes = await videoService.describe(documents);
    const counts = Object.fromEntries(['gunshot', 'medical', 'fire', 'panic'].map(type =>
      [type, alerts.filter(a => a.emergencyType === type).length]));
    counts.unresolved = alerts.filter(a => a.status !== 'resolved').length;
    counts.verifiedThreats = alerts.filter(a => a.threatStatus === 'verified_threat' && a.status !== 'resolved').length;
    res.set('Cache-Control', 'no-store').json({ success: true, nodes, alerts, counts,
      receiver: { ready: videoService.ready, message: videoService.message, addresses: videoService.addresses() } });
  } catch (error) { next(error); }
});
export default router;
