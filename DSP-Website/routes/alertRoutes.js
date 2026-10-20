import express from 'express';
import { body, validationResult } from 'express-validator';
import { Alert } from '../models/Alert.js';
import { Node } from '../models/Node.js';
import { requireAuth } from '../middleware/auth.js';
import { requireDeviceApiKey } from '../middleware/deviceAuth.js';
import { uploadAlertImage, saveBase64Image } from '../middleware/upload.js';
import { verifyChecksum } from '../utils/checksum.js';
import { getSocketIO } from '../sockets/socketHandler.js';

const router = express.Router();

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
    const { status, type, building, threatStatus, limit = 50, page = 1 } = req.query;
    const query = {};

    if (status && status !== 'all') {
      query.status = status;
    }
    if (type && type !== 'all') {
      query.emergencyType = type;
    }
    if (building && building !== 'all') {
      query.building = building;
    }
    if (threatStatus && threatStatus !== 'all') {
      query.threatStatus = threatStatus;
    }

    const skip = (parseInt(page, 10) - 1) * parseInt(limit, 10);

    const [alerts, total, countsRaw] = await Promise.all([
      Alert.find(query)
        .sort({ priority: 1, timestamp: -1 })
        .skip(skip)
        .limit(parseInt(limit, 10)),
      Alert.countDocuments(query),
      Alert.aggregate([
        {
          $group: {
            _id: '$emergencyType',
            count: { $sum: 1 },
            unresolved: {
              $sum: { $cond: [{ $ne: ['$status', 'resolved'] }, 1, 0] }
            }
          }
        }
      ])
    ]);

    const counts = {
      gunshot: 0,
      medical: 0,
      fire: 0,
      panic: 0,
      total,
      unresolvedTotal: 0
    };

    countsRaw.forEach((c) => {
      if (counts[c._id] !== undefined) {
        counts[c._id] = c.count;
      }
      counts.unresolvedTotal += c.unresolved;
    });

    return res.status(200).json({
      success: true,
      count: alerts.length,
      total,
      page: parseInt(page, 10),
      totalPages: Math.ceil(total / parseInt(limit, 10)) || 1,
      counts,
      alerts
    });
  } catch (err) {
    next(err);
  }
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

router.patch('/:id', requireAuth, async (req, res, next) => {
  try {
    const { id } = req.params;
    const { action, status } = req.body;

    const alert = await Alert.findById(id);
    if (!alert) {
      return res.status(404).json({ success: false, message: 'Alert not found.' });
    }

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

    await alert.save();

    const unresolvedCount = await Alert.countDocuments({
      nodeId: alert.nodeId,
      status: { $ne: 'resolved' }
    });

    if (unresolvedCount === 0) {
      await Node.findOneAndUpdate(
        { nodeId: alert.nodeId },
        { status: 'online' }
      );
    }

    const io = getSocketIO();
    if (io) {
      io.emit('alert:updated', alert);
      if (unresolvedCount === 0) {
        io.emit('node:status', { nodeId: alert.nodeId, status: 'online' });
      }
    }

    return res.status(200).json({
      success: true,
      message: `Alert successfully marked as ${newStatus}`,
      alert
    });
  } catch (err) {
    next(err);
  }
});

router.post(
  '/ingest',
  requireDeviceApiKey,
  uploadAlertImage.single('image'),
  async (req, res, next) => {
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
        imageUrl = `/uploads/alerts/${req.file.filename}`;
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
          building,
          room,
          status: 'active',
          lastSeen: new Date()
        },
        { upsert: false }
      );

      const io = getSocketIO();
      if (io) {
        io.emit('alert:new', alert);
        io.emit('node:status', { nodeId: alert.nodeId, status: 'active' });
      }

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
  }
);

export default router;
