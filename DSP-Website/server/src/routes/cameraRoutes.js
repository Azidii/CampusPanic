import express from 'express';
import { Camera } from '../models/Camera.js';
import { requireAuth } from '../middleware/auth.js';
import { uploadAlertImage, saveBase64Image } from '../middleware/upload.js';
import { getSocketIO } from '../sockets/socketHandler.js';

const router = express.Router();

/**
 * GET /api/cameras
 * List all camera feeds
 */
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const cameras = await Camera.find().sort({ building: 1, room: 1 });
    return res.status(200).json({
      success: true,
      count: cameras.length,
      cameras
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/cameras
 * Register or update a camera source
 */
router.post('/', requireAuth, async (req, res, next) => {
  try {
    const { cameraId, label, nodeId, building, room } = req.body;
    if (!cameraId || !label) {
      return res.status(400).json({ success: false, message: 'cameraId and label are required' });
    }

    const camera = await Camera.findOneAndUpdate(
      { cameraId },
      {
        label,
        nodeId: nodeId || null,
        building: building || 'Campus Main',
        room: room || 'Room 101',
        online: true,
        lastFrameAt: new Date()
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    const io = getSocketIO();
    if (io) {
      io.emit('camera:status', { cameraId: camera.cameraId, online: true });
    }

    return res.status(201).json({ success: true, camera });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/cameras/:cameraId/frame
 * Endpoint for laptop or smartphone camera gateway to post periodic snapshot frames
 */
router.post(
  '/:cameraId/frame',
  uploadAlertImage.single('frame'),
  async (req, res, next) => {
    try {
      const { cameraId } = req.params;
      const { frameBase64, timestamp } = req.body;

      let frameUrl = null;
      if (req.file) {
        frameUrl = `/uploads/alerts/${req.file.filename}`;
      } else if (frameBase64) {
        frameUrl = saveBase64Image(frameBase64);
      }

      if (!frameUrl) {
        return res.status(400).json({ success: false, message: 'No frame image provided' });
      }

      const camera = await Camera.findOneAndUpdate(
        { cameraId },
        {
          online: true,
          lastFrameAt: timestamp ? new Date(timestamp) : new Date(),
          lastFrameUrl: frameUrl
        },
        { new: true }
      );

      const io = getSocketIO();
      if (io) {
        io.emit('camera:frame', {
          cameraId,
          frameUrl,
          timestamp: new Date().toISOString()
        });
      }

      return res.status(200).json({
        success: true,
        cameraId,
        frameUrl
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * PATCH /api/cameras/:cameraId/status
 */
router.patch('/:cameraId/status', requireAuth, async (req, res, next) => {
  try {
    const { online } = req.body;
    const camera = await Camera.findOneAndUpdate(
      { cameraId: req.params.cameraId },
      { online: Boolean(online) },
      { new: true }
    );

    if (!camera) {
      return res.status(404).json({ success: false, message: 'Camera not found' });
    }

    const io = getSocketIO();
    if (io) {
      io.emit('camera:status', { cameraId: camera.cameraId, online: camera.online });
    }

    return res.status(200).json({ success: true, camera });
  } catch (err) {
    next(err);
  }
});

export default router;
