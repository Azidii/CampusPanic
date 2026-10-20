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

/**
 * Determine alert priority (1: Critical verified, 2: High manual, 3: Warning unverified)
 */
const calculatePriority = (threatStatus, emergencyType) => {
  if (threatStatus === 'verified_threat' || emergencyType === 'gunshot' && threatStatus === 'verified_threat') {
    return 1;
  }
  if (threatStatus === 'manual_alert' || ['fire', 'panic', 'medical'].includes(emergencyType)) {
    return 2;
  }
  return 3; // unverified_audio_trigger
};

/**
 * GET /api/alerts
 * Authenticated security guard & admin feed
 */
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

    // Sorted by priority ascending (1 = critical first), then timestamp descending
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
            activeCount: {
              $sum: { $cond: [{ $in: ['$status', ['new', 'acknowledged']] }, 1, 0] }
            }
          }
        }
      ])
    ]);

    // Aggregate counts summary for dashboard
    const counts = {
      gunshot: 0,
      medical: 0,
      fire: 0,
      panic: 0,
      totalActive: 0
    };

    countsRaw.forEach(item => {
      if (counts[item._id] !== undefined) {
        counts[item._id] = item.count;
      }
      counts.totalActive += item.activeCount;
    });

    const activeThreatCount = await Alert.countDocuments({
      status: { $in: ['new', 'acknowledged'] },
      threatStatus: 'verified_threat'
    });

    return res.status(200).json({
      success: true,
      alerts,
      pagination: {
        total,
        page: parseInt(page, 10),
        limit: parseInt(limit, 10),
        pages: Math.ceil(total / parseInt(limit, 10))
      },
      counts: {
        ...counts,
        verifiedThreats: activeThreatCount
      }
    });
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /api/alerts/:id
 * Acknowledge or resolve an alert
 */
router.patch(
  '/:id',
  requireAuth,
  [
    body('status').isIn(['acknowledged', 'resolved']).withMessage('Status must be acknowledged or resolved')
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, errors: errors.array() });
      }

      const { status } = req.body;
      const alert = await Alert.findById(req.params.id);

      if (!alert) {
        return res.status(404).json({ success: false, message: 'Alert not found' });
      }

      alert.status = status;
      if (status === 'acknowledged') {
        alert.acknowledgedBy = req.user.name;
        alert.acknowledgedAt = new Date();
      } else if (status === 'resolved') {
        alert.resolvedAt = new Date();
        if (!alert.acknowledgedBy) {
          alert.acknowledgedBy = req.user.name;
        }
      }

      await alert.save();

      // Check if node has remaining active alerts; if none, reset node status to online
      const activeAlertsForNode = await Alert.countDocuments({
        nodeId: alert.nodeId,
        status: { $in: ['new', 'acknowledged'] }
      });

      const io = getSocketIO();

      if (activeAlertsForNode === 0) {
        const updatedNode = await Node.findOneAndUpdate(
          { nodeId: alert.nodeId },
          { status: 'online' },
          { new: true }
        );
        if (io && updatedNode) {
          io.emit('node:updated', updatedNode);
        }
      }

      if (io) {
        io.emit('alert:updated', alert);
      }

      return res.status(200).json({
        success: true,
        message: `Alert marked as ${status}`,
        alert
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /api/alerts/ingest
 * Ingest endpoint for ESP32 nodes and laptop/phone verification gateways
 * Requires x-device-api-key header
 */
router.post(
  '/ingest',
  requireDeviceApiKey,
  uploadAlertImage.single('image'),
  async (req, res, next) => {
    try {
      const {
        nodeId,
        sequenceNumber,
        emergencyType,
        threatStatus,
        checksum,
        audioConfidence,
        firearmConfidence,
        image: base64ImageString,
        timestamp
      } = req.body;

      // 1. Validate mandatory fields
      if (!nodeId || sequenceNumber === undefined || !emergencyType || !threatStatus || !checksum) {
        return res.status(400).json({
          ack: false,
          error: 'Missing required packet fields (nodeId, sequenceNumber, emergencyType, threatStatus, checksum)'
        });
      }

      const cleanNodeId = String(nodeId).trim().toUpperCase();
      const seq = parseInt(sequenceNumber, 10);

      // Find node to get building & room if not supplied in packet
      let building = req.body.building;
      let room = req.body.room;

      const nodeRecord = await Node.findOne({ nodeId: cleanNodeId });
      if (nodeRecord) {
        if (!building) building = nodeRecord.building;
        if (!room) room = nodeRecord.room;
      } else {
        if (!building) building = 'Campus Zone';
        if (!room) room = 'Room Unknown';
      }

      // 2. Validate Checksum
      const packetForChecksum = {
        nodeId: cleanNodeId,
        sequenceNumber: seq,
        emergencyType: String(emergencyType).trim().toLowerCase(),
        building,
        room,
        checksum
      };

      const isValidChecksum = verifyChecksum(packetForChecksum);
      if (!isValidChecksum) {
        console.warn(`[Alert Ingest] Checksum mismatch from node ${cleanNodeId} seq ${seq}: provided ${checksum}`);
        return res.status(400).json({
          ack: false,
          error: 'Checksum verification failed. Packet corrupted or tampered.'
        });
      }

      // 3. Deduplication check: Duplicates (same nodeId + sequenceNumber) must be ignored but still ACKed.
      const existingAlert = await Alert.findOne({
        nodeId: cleanNodeId,
        sequenceNumber: seq
      });

      if (existingAlert) {
        console.log(`[Alert Ingest] Duplicate alert detected for node ${cleanNodeId} seq ${seq}. Ignored but ACKed.`);
        return res.status(200).json({
          ack: true,
          sequenceNumber: seq,
          duplicate: true,
          message: 'Duplicate alert ignored but ACKed'
        });
      }

      // 4. Handle Alert Image (from multer upload or base64 payload)
      let imageUrl = null;
      if (req.file) {
        imageUrl = `/uploads/alerts/${req.file.filename}`;
      } else if (base64ImageString) {
        imageUrl = saveBase64Image(base64ImageString);
      }

      // 5. Calculate Priority
      const priority = calculatePriority(threatStatus, emergencyType);

      // 6. Save Alert
      const alert = await Alert.create({
        nodeId: cleanNodeId,
        building,
        room,
        emergencyType: String(emergencyType).toLowerCase(),
        threatStatus,
        priority,
        sequenceNumber: seq,
        timestamp: timestamp ? new Date(timestamp) : new Date(),
        checksum,
        imageUrl,
        audioConfidence: audioConfidence !== undefined ? parseFloat(audioConfidence) : null,
        firearmConfidence: firearmConfidence !== undefined ? parseFloat(firearmConfidence) : null,
        status: 'new'
      });

      // 7. Update Node status to 'active' and refresh lastSeen
      if (nodeRecord) {
        nodeRecord.status = 'active';
        nodeRecord.lastSeen = new Date();
        await nodeRecord.save();

        const io = getSocketIO();
        if (io) {
          io.emit('node:updated', nodeRecord);
        }
      }

      // 8. Broadcast new alert via Socket.IO
      const io = getSocketIO();
      if (io) {
        io.emit('alert:new', alert);
      }

      console.log(`[Alert Ingest] Alert stored and broadcasted: Node ${cleanNodeId} | Type: ${emergencyType} | Threat: ${threatStatus} | Priority: ${priority}`);

      // 9. Respond with ACK
      return res.status(201).json({
        ack: true,
        sequenceNumber: seq,
        alertId: alert._id
      });
    } catch (err) {
      // Handle MongoDB duplicate key race condition
      if (err.code === 11000) {
        return res.status(200).json({
          ack: true,
          sequenceNumber: parseInt(req.body.sequenceNumber, 10),
          duplicate: true,
          message: 'Duplicate alert ignored but ACKed'
        });
      }
      next(err);
    }
  }
);

export default router;
