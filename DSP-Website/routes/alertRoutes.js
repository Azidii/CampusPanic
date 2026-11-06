import express from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config/config.js';
import { buildingFilter, incidentFilter, pageNumber, alertCounts } from '../services/alertFeed.js';
import { resetPreview, deleteAllAlerts, reconcileNodeIncidents } from '../services/alertReset.js';
import { incidentWrite } from '../services/incidentGuard.js';
import { Alert } from '../models/Alert.js';
import { Node } from '../models/Node.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { requireDeviceApiKey } from '../middleware/deviceAuth.js';
import { uploadAlertImage, saveBase64Image, saveAlertImage } from '../middleware/upload.js';
import { verifyChecksum } from '../utils/checksum.js';

const router = express.Router();
router.param('id', (req, res, next, id) => /^[a-f0-9]{24}$/i.test(id) ? next() : res.status(400).json({success:false,message:'Invalid incident ID.'}));

const calculatePriority = (threatStatus, emergencyType) => {
  if (threatStatus === 'verified_threat' || (emergencyType === 'gunshot' && threatStatus === 'verified_threat')) {
    return 1;
  }
  if (threatStatus === 'manual_alert' || ['fire', 'panic', 'medical'].includes(emergencyType)) {
    return 2;
  }
  return 3;
};

router.get('/', requireAuth, async (req, res, next) => {
  try {
    const query = incidentFilter(req.query), limit = pageNumber(req.query.limit, 50, 100), page = pageNumber(req.query.page);
    const [alerts, total, counts] = await Promise.all([
      Alert.find(query).sort({ priority: 1, timestamp: -1, _id: -1 }).skip((page - 1) * limit).limit(limit),
      Alert.countDocuments(query), alertCounts(buildingFilter(req.query.building))
    ]);
    res.set('Cache-Control', 'no-store').json({ success: true, count: alerts.length, total, page,
      totalPages: Math.max(1, Math.ceil(total / limit)), counts, alerts });
  } catch (error) { next(error); }
});

router.post('/clear-resolved', requireAuth, incidentWrite(async (req, res) => {
  const scope = buildingFilter(req.body.building);
  const result = await Alert.updateMany({ ...scope, status: 'resolved', clearedBy: { $ne: req.user._id } },
    { $addToSet: { clearedBy: req.user._id } });
  res.json({ success: true, cleared: result.modifiedCount });
}));

router.get('/reset-preview', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const preview = await resetPreview();
    const confirmationToken = jwt.sign({ ...preview, purpose: 'alert-reset', sub: String(req.user._id) }, config.jwtSecret, { expiresIn: '5m' });
    res.set('Cache-Control', 'no-store').json({ success: true, count: preview.count, confirmationToken });
  } catch (error) { next(error); }
});

router.delete('/', requireAuth, requireAdmin, async (req, res, next) => {
  if (req.get('X-CampusPanic-Action') !== 'reset-alerts' || req.body.confirmation !== 'DELETE ALL ALERTS') {
    return res.status(400).json({ success: false, message: 'Explicit alert deletion confirmation required.' });
  }
  let expected;
  try {
    expected = jwt.verify(req.body.confirmationToken, config.jwtSecret);
    if (expected.purpose !== 'alert-reset' || expected.sub !== String(req.user._id)) throw new Error();
  } catch { return res.status(400).json({ success: false, message: 'Confirmation expired or invalid. Review the alert count again.' }); }
  try {
    const result = await deleteAllAlerts(expected);
    const success = result.remaining === 0 && result.reconciled && !result.failures.length;
    res.status(success ? 200 : 207).json({ success, ...result,
      message: success ? 'Alerts deleted. Continuing detections may generate new alerts.' : 'Reset partially completed. Review retained incidents and retry; continuing detections may generate new alerts.' });
  } catch (error) { next(error); }
});

router.get('/:id', requireAuth, async (req, res, next) => {
  try {
    const alert = await Alert.findById(req.params.id);
    if (!alert) {
      return res.status(404).json({ success: false, message: 'Alert not found.' });
    }
    return res.status(200).json({ success: true, alert });
  } catch (err) {
    next(err);
  }
});

router.patch('/:id', requireAuth, incidentWrite(async (req, res, next) => {
  try {
    const { id } = req.params;
    const { action, status } = req.body;

    const alert = await Alert.findById(id);
    if (!alert) {
      return res.status(404).json({ success: false, message: 'Alert not found.' });
    }

    if ((status && !['new', 'acknowledged', 'resolved'].includes(status)) ||
        (!status && !['acknowledge', 'resolve'].includes(action))) return res.status(400).json({ success: false, message: 'Choose acknowledge or resolve.' });
    const newStatus = status || (action === 'resolve' ? 'resolved' : 'acknowledged');

    alert.status = newStatus;
    if (newStatus === 'acknowledged') {
      alert.acknowledgedBy = req.user.name;
      alert.acknowledgedAt = new Date();
    } else if (newStatus === 'resolved') {
      alert.resolvedAt = new Date();
      if (!alert.acknowledgedBy) {
        alert.acknowledgedBy = req.user.name;
      }
    }

    // Free the unique active camera-event key when an incident is resolved.
    if (newStatus === 'resolved' && ['camera_detection', 'audio_detection'].includes(alert.triggerSource)) {
      alert.deviceEventKey = undefined;
      alert.markModified('deviceEventKey');
    }
    await alert.save();

    await reconcileNodeIncidents([alert.nodeId]);

    return res.status(200).json({
      success: true,
      message: `Alert successfully marked as ${newStatus}`,
      alert
    });
  } catch (err) {
    next(err);
  }
}));

router.post(
  '/ingest',
  requireDeviceApiKey,
  uploadAlertImage.single('image'),
  incidentWrite(async (req, res, next) => {
    try {
      let packet = req.body;

      if (typeof packet.payload === 'string') {
        try {
          packet = { ...packet, ...JSON.parse(packet.payload) };
        } catch (e) {
          // ignore
        }
      }

      const {
        nodeId,
        building,
        room,
        emergencyType,
        threatStatus,
        sequenceNumber,
        checksum,
        audioConfidence,
        firearmConfidence,
        imageBase64
      } = packet;

      if (!nodeId || !building || !room || !emergencyType || !threatStatus || sequenceNumber === undefined || !checksum) {
        return res.status(400).json({
          ack: false,
          error: 'Missing required alert packet fields. Required: nodeId, building, room, emergencyType, threatStatus, sequenceNumber, checksum'
        });
      }

      const validEmergencyTypes = ['gunshot', 'medical', 'fire', 'panic'];
      if (!validEmergencyTypes.includes(emergencyType)) {
        return res.status(400).json({
          ack: false,
          error: `Invalid emergencyType '${emergencyType}'. Allowed: ${validEmergencyTypes.join(', ')}`
        });
      }

      const validThreatStatuses = ['verified_threat', 'unverified_audio_trigger', 'manual_alert'];
      if (!validThreatStatuses.includes(threatStatus)) {
        return res.status(400).json({
          ack: false,
          error: `Invalid threatStatus '${threatStatus}'. Allowed: ${validThreatStatuses.join(', ')}`
        });
      }

      const seqNum = parseInt(sequenceNumber, 10);
      if (isNaN(seqNum) || seqNum < 0) {
        return res.status(400).json({
          ack: false,
          error: 'sequenceNumber must be a non-negative integer'
        });
      }

      const isChecksumValid = verifyChecksum({
        nodeId: nodeId.toUpperCase(),
        sequenceNumber: seqNum,
        emergencyType,
        building,
        room,
        checksum
      });

      if (!isChecksumValid) {
        console.warn(`[Ingest] Corrupted packet received from Node ${nodeId} (Seq #${seqNum}). Checksum mismatch: ${checksum}`);
        return res.status(400).json({
          ack: false,
          error: 'Corrupted packet. Checksum verification failed.'
        });
      }

      const existingAlert = await Alert.findOne({
        nodeId: nodeId.toUpperCase(),
        sequenceNumber: seqNum
      });

      if (existingAlert) {
        console.log(`[Ingest] Duplicate alert packet from Node ${nodeId} (Seq #${seqNum}). Ignoring storage, returning ACK.`);
        return res.status(200).json({
          ack: true,
          sequenceNumber: seqNum,
          duplicate: true,
          message: 'Alert already recorded. ACK acknowledged.'
        });
      }

      let imageUrl = null;
      if (req.file) {
        imageUrl = saveAlertImage(req.file.buffer);
      } else if (imageBase64 || packet.image) {
        imageUrl = saveBase64Image(imageBase64 || packet.image);
      }

      const priority = calculatePriority(threatStatus, emergencyType);

      const alert = await Alert.create({
        nodeId: nodeId.toUpperCase(),
        building,
        room,
        emergencyType,
        threatStatus,
        priority,
        sequenceNumber: seqNum,
        timestamp: new Date(),
        checksum,
        imageUrl,
        audioConfidence: audioConfidence !== undefined ? parseFloat(audioConfidence) : null,
        firearmConfidence: firearmConfidence !== undefined ? parseFloat(firearmConfidence) : null,
        status: 'new'
      });

      await Node.findOneAndUpdate(
        { nodeId: nodeId.toUpperCase() },
        {
          status: 'active',
          lastSeen: new Date()
        },
        { upsert: false }
      );



      return res.status(201).json({
        ack: true,
        sequenceNumber: seqNum,
        alertId: alert._id,
        priority: alert.priority,
        timestamp: alert.timestamp
      });
    } catch (err) {
      next(err);
    }
  })
);

export default router;
