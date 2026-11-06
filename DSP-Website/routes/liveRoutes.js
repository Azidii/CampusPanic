import express from 'express';
import { alertCounts, dashboardFeed } from '../services/alertFeed.js';
import { Alert } from '../models/Alert.js';
import { Node } from '../models/Node.js';
import { requireAuth } from '../middleware/auth.js';
import { videoService } from '../services/videoService.js';
import { audioService } from '../services/audioService.js';

const router = express.Router();
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const [documents, alerts, activeAlerts, counts] = await Promise.all([
      Node.find().sort({ building: 1, room: 1 }),
      Alert.find({ status: 'resolved' }).sort({ timestamp: -1 }).limit(20),
      Alert.find({ status: { $ne: 'resolved' } }).sort({ priority: 1, timestamp: -1 }),
      alertCounts()
    ]);
    const nodes = await videoService.describe(documents);
    const dashboard = req.query.dashboard === 'true' ? await dashboardFeed(req.user._id, req.query) : undefined;
    res.set('Cache-Control', 'no-store').json({
      success: true,
      nodes,
      alerts,
      activeAlerts,
      counts,
      dashboard,
      receiver: {
        ready: videoService.ready,
        message: videoService.message,
        addresses: videoService.addresses()
      },
      audioReceiver: {
        ready: audioService.ready,
        message: audioService.message
      }
    });
  } catch (error) { next(error); }
});
export default router;
