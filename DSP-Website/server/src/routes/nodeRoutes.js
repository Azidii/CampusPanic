import express from 'express';
import { body, validationResult } from 'express-validator';
import { Node } from '../models/Node.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { getSocketIO } from '../sockets/socketHandler.js';

const router = express.Router();

// GET /api/nodes is accessible by authenticated users
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const { building, status } = req.query;
    const filter = {};
    if (building && building !== 'all') filter.building = building;
    if (status && status !== 'all') filter.status = status;

    const nodes = await Node.find(filter).sort({ building: 1, room: 1 });
    return res.status(200).json({
      success: true,
      count: nodes.length,
      nodes
    });
  } catch (err) {
    next(err);
  }
});

// Admin-only mutations
router.post(
  '/',
  requireAuth,
  requireAdmin,
  [
    body('nodeId').trim().notEmpty().withMessage('Node ID is required').toUpperCase(),
    body('building').trim().notEmpty().withMessage('Building name is required'),
    body('room').trim().notEmpty().withMessage('Room is required'),
    body('lat').isFloat({ min: -90, max: 90 }).withMessage('Valid latitude required'),
    body('lng').isFloat({ min: -180, max: 180 }).withMessage('Valid longitude required'),
    body('cameraId').optional().trim()
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, errors: errors.array() });
      }

      const { nodeId, building, room, lat, lng, cameraId } = req.body;

      const existing = await Node.findOne({ nodeId: nodeId.toUpperCase() });
      if (existing) {
        return res.status(409).json({ success: false, message: `Node with ID ${nodeId} already exists.` });
      }

      const node = await Node.create({
        nodeId: nodeId.toUpperCase(),
        building,
        room,
        lat: parseFloat(lat),
        lng: parseFloat(lng),
        cameraId: cameraId || null,
        status: 'online',
        lastSeen: new Date()
      });

      const io = getSocketIO();
      if (io) {
        io.emit('node:created', node);
      }

      return res.status(201).json({
        success: true,
        message: 'Node created successfully',
        node
      });
    } catch (err) {
      next(err);
    }
  }
);

router.put(
  '/:id',
  requireAuth,
  requireAdmin,
  [
    body('building').optional().trim().notEmpty(),
    body('room').optional().trim().notEmpty(),
    body('lat').optional().isFloat({ min: -90, max: 90 }),
    body('lng').optional().isFloat({ min: -180, max: 180 }),
    body('status').optional().isIn(['online', 'offline', 'active']),
    body('cameraId').optional().trim()
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, errors: errors.array() });
      }

      const node = await Node.findById(req.params.id);
      if (!node) {
        return res.status(404).json({ success: false, message: 'Node not found' });
      }

      const { building, room, lat, lng, status, cameraId } = req.body;
      if (building) node.building = building;
      if (room) node.room = room;
      if (lat !== undefined) node.lat = parseFloat(lat);
      if (lng !== undefined) node.lng = parseFloat(lng);
      if (status) node.status = status;
      if (cameraId !== undefined) node.cameraId = cameraId || null;

      await node.save();

      const io = getSocketIO();
      if (io) {
        io.emit('node:updated', node);
      }

      return res.status(200).json({
        success: true,
        message: 'Node updated successfully',
        node
      });
    } catch (err) {
      next(err);
    }
  }
);

router.delete('/:id', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const node = await Node.findByIdAndDelete(req.params.id);
    if (!node) {
      return res.status(404).json({ success: false, message: 'Node not found' });
    }

    const io = getSocketIO();
    if (io) {
      io.emit('node:deleted', { id: req.params.id, nodeId: node.nodeId });
    }

    return res.status(200).json({
      success: true,
      message: `Node ${node.nodeId} deleted successfully`
    });
  } catch (err) {
    next(err);
  }
});

export default router;
