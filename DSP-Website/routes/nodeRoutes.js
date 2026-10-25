import express from 'express';
import { randomUUID } from 'node:crypto';
import { Node } from '../models/Node.js';
import { Camera } from '../models/Camera.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { videoService } from '../services/videoService.js';
import { issuePairing } from '../services/nodePairing.js';
import { EspDevice } from '../models/EspDevice.js';

const router = express.Router();
router.use(requireAuth, (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function details(body) {
  const result = {};
  for (const key of ['name', 'building', 'room']) {
    if (typeof body[key] !== 'string' || !body[key].trim() || body[key].trim().length > 100) {
      throw Object.assign(new Error(`A ${key} of 1–100 characters is required`), { statusCode: 400 });
    }
    result[key] = body[key].trim();
  }
  const hasLat = body.lat !== undefined && body.lat !== null && body.lat !== '';
  const hasLng = body.lng !== undefined && body.lng !== null && body.lng !== '';
  if (hasLat !== hasLng) throw Object.assign(new Error('Provide both latitude and longitude, or leave both blank'), { statusCode: 400 });
  result.lat = hasLat ? Number(body.lat) : null;
  result.lng = hasLng ? Number(body.lng) : null;
  if (hasLat && (!Number.isFinite(result.lat) || !Number.isFinite(result.lng) ||
    Math.abs(result.lat) > 90 || Math.abs(result.lng) > 180)) {
    throw Object.assign(new Error('Invalid map coordinates'), { statusCode: 400 });
  }
  return result;
}

router.get('/', wrap(async (req, res) => {
  const filter = {};
  if (req.query.building && req.query.building !== 'all') filter.building = req.query.building;
  const nodes = await videoService.describe(await Node.find(filter).sort({ building: 1, room: 1 }));
  const filtered = req.query.status && req.query.status !== 'all' ? nodes.filter(n => n.status === req.query.status) : nodes;
  res.json({ success: true, count: filtered.length, nodes: filtered,
    receiver: { ready: videoService.ready, message: videoService.message, addresses: videoService.addresses() } });
}));

router.post('/', requireAdmin, wrap(async (req, res) => {
  const values = details(req.body);
  const nodeId = `NODE-${randomUUID().slice(0, 8).toUpperCase()}`;
  const cameraId = `CAM-${nodeId}`;
  const node = await Node.create({ ...values, nodeId, cameraId, videoEnabled: true, status: 'offline' });
  try {
    await Camera.create({ cameraId, label: node.name, nodeId, building: node.building, room: node.room, online: false });
    const pairing = await issuePairing(nodeId);
    res.status(201).json({ success: true, node: (await videoService.describe([node]))[0], pairing,
      addresses: videoService.addresses() });
  } catch (error) {
    await Camera.deleteOne({ cameraId });
    await Node.deleteOne({ nodeId });
    throw error;
  }
}));

async function mutate(req, res, fn) {
  const id = req.params.nodeId.toUpperCase();
  if (videoService.pending.has(id)) return res.status(409).json({ success: false, message: 'Connection is changing; try again.' });
  videoService.pending.add(id);
  try {
    const node = await Node.findOne({ nodeId: id });
    if (!node) return res.status(404).json({ success: false, message: 'Node not found' });
    await fn(node, id);
  } finally { videoService.pending.delete(id); }
}

router.put('/:nodeId', requireAdmin, wrap(async (req, res) => {
  const values = details(req.body);
  await mutate(req, res, async (node) => {
    Object.assign(node, values);
    await node.save();
    if (node.cameraId) await Camera.updateOne({ cameraId: node.cameraId }, {
      label: node.name, building: node.building, room: node.room });
    res.json({ success: true, node: (await videoService.describe([node]))[0] });
  });
}));

router.post('/:nodeId/pairing', requireAdmin, wrap(async (req, res) => {
  await mutate(req, res, async (node, id) => {
    node.pairingExpiresAt = new Date(0);
    await node.save();
    await videoService.revoke(id);
    if (!node.videoEnabled) {
      node.videoEnabled = true;
      node.cameraId = node.cameraId || `CAM-${id}`;
      await node.save();
      await Camera.updateOne({ cameraId: node.cameraId }, { nodeId: id, label: node.name || id,
        building: node.building, room: node.room, online: false }, { upsert: true });
    }
    res.json({ success: true, pairing: await issuePairing(id), addresses: videoService.addresses() });
  });
}));

router.post('/:nodeId/disconnect', requireAdmin, wrap(async (req, res) => {
  await mutate(req, res, async (node, id) => {
    node.pairingExpiresAt = new Date(0);
    await node.save();
    await videoService.revoke(id);
    res.json({ success: true });
  });
}));

router.delete('/:nodeId', requireAdmin, wrap(async (req, res) => {
  await mutate(req, res, async (node, id) => {
    node.pairingExpiresAt = new Date(0);
    await node.save();
    await videoService.revoke(id);
    await Camera.deleteMany({ $or: [{ nodeId: id }, { cameraId: node.cameraId || '' }] });
    await EspDevice.updateMany({ nodeId: id }, { $set: { nodeId: null, pinExpiresAt: new Date(0) } });
    await node.deleteOne();
    res.json({ success: true });
  });
}));

export default router;
