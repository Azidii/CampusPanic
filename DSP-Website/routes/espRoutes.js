import express from 'express';
import rateLimit from 'express-rate-limit';
import { EspDevice } from '../models/EspDevice.js';
import { Node } from '../models/Node.js';
import { Alert } from '../models/Alert.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { hash, sameHash, fresh } from '../services/espDevices.js';
import { computeAlertChecksum } from '../utils/checksum.js';

const router = express.Router();
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const fail = (res, code, message) => res.status(code).json({ success: false, message });
const deviceIdValid = value => typeof value === 'string' && /^ESP-[A-F0-9]{12}$/.test(value);
const tokenValid = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
router.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  if (req.method !== 'GET' && req.headers.origin) {
    try { if (new URL(req.headers.origin).host !== req.get('host')) return fail(res, 403, 'Same-origin request required'); }
    catch { return fail(res, 403, 'Invalid origin'); }
  }
  next();
});
const discoveryLimit = rateLimit({ windowMs: 60000, max: 120, standardHeaders: true, legacyHeaders: false });
const pairLimit = rateLimit({ windowMs: 60000, max: 15, standardHeaders: true, legacyHeaders: false });

async function authenticate(req, res, next) {
  try {
    const token = req.headers['x-esp32-token'];
    if (!deviceIdValid(req.body.deviceId) || !tokenValid(token)) return fail(res, 401, 'ESP32 authentication required');
    const device = await EspDevice.findOne({ deviceId: req.body.deviceId }).select('+tokenHash');
    if (!device || !sameHash(device.tokenHash, hash(token))) return fail(res, 401, 'ESP32 authentication failed');
    req.device = device;
    next();
  } catch (error) { next(error); }
}

function deviceState(res, device, node) {
  res.set('X-Node-ID', node?.nodeId || '');
  res.set('X-Audio-Muted', node?.audioMuted ? 'true' : 'false');
  return res.json({ success: true, paired: Boolean(node), nodeId: node?.nodeId || null,
    muted: Boolean(node?.audioMuted), rawAudioAvailable: false });
}

router.post('/register', discoveryLimit, wrap(async (req, res) => {
  const { deviceId, pinHash } = req.body;
  const token = req.headers['x-esp32-token'];
  if (!deviceIdValid(deviceId) || !tokenValid(token) || !tokenValid(pinHash)) return fail(res, 400, 'Invalid ESP32 registration');
  let device = await EspDevice.findOne({ deviceId }).select('+tokenHash +pinHash');
  if (device && !sameHash(device.tokenHash, hash(token))) return fail(res, 401, 'ESP32 authentication failed');
  const now = new Date();
  if (!device) {
    await EspDevice.deleteMany({ nodeId: null, lastSeen: { $lt: new Date(Date.now() - 86400000) } });
    if (await EspDevice.countDocuments({ nodeId: null }) >= 64) return fail(res, 503, 'Discovery capacity reached');
    device = await EspDevice.create({ deviceId, tokenHash: hash(token), pinHash, lastSeen: now,
      pinExpiresAt: new Date(Date.now() + 5 * 60000) });
  } else {
    const update = { lastSeen: now };
    if (!device.nodeId && !sameHash(device.pinHash, pinHash)) {
      Object.assign(update, { pinHash, pinAttempts: 0, pinExpiresAt: new Date(Date.now() + 5 * 60000) });
    }
    device = await EspDevice.findByIdAndUpdate(device._id, { $set: update }, { new: true });
  }
  const node = device.nodeId ? await Node.findOne({ nodeId: device.nodeId }) : null;
  if (device.nodeId && !node) await EspDevice.updateOne({ _id: device._id }, { nodeId: null, pinExpiresAt: new Date(0) });
  deviceState(res, device, node);
}));

router.post('/heartbeat', authenticate, wrap(async (req, res) => {
  await EspDevice.updateOne({ _id: req.device._id }, { lastSeen: new Date() });
  const node = req.device.nodeId ? await Node.findOne({ nodeId: req.device.nodeId }) : null;
  deviceState(res, req.device, node);
}));

router.get('/available', requireAuth, requireAdmin, wrap(async (req, res) => {
  const devices = await EspDevice.find({ nodeId: null, lastSeen: { $gt: new Date(Date.now() - 20000) },
    pinExpiresAt: { $gt: new Date() }, pinAttempts: { $lt: 5 } }).sort({ deviceId: 1 });
  res.json({ success: true, devices: devices.map(device => ({ deviceId: device.deviceId,
    lastSeen: device.lastSeen, pinExpiresAt: device.pinExpiresAt, capability: device.capability })) });
}));

router.post('/pair/:nodeId', requireAuth, requireAdmin, pairLimit, wrap(async (req, res) => {
  const { deviceId, pin } = req.body;
  if (!deviceIdValid(deviceId) || typeof pin !== 'string' || !/^\d{8}$/.test(pin)) return fail(res, 400, 'Select an ESP32 and enter its 8-digit PIN');
  const node = await Node.findOne({ nodeId: req.params.nodeId.toUpperCase() });
  if (!node) return fail(res, 404, 'Node not found');
  if (await EspDevice.exists({ nodeId: node.nodeId })) return fail(res, 409, 'Disconnect this node’s ESP32 before replacing it');
  const device = await EspDevice.findOne({ deviceId, nodeId: null }).select('+pinHash');
  if (!device || !fresh(device) || device.pinExpiresAt <= new Date() || device.pinAttempts >= 5) return fail(res, 409, 'ESP32 unavailable or PIN expired; refresh the device PIN');
  if (!sameHash(device.pinHash, hash(pin))) {
    await EspDevice.updateOne({ _id: device._id, nodeId: null }, { $inc: { pinAttempts: 1 } });
    return fail(res, 400, 'Incorrect PIN');
  }
  try {
    const paired = await EspDevice.findOneAndUpdate({ _id: device._id, nodeId: null, pinHash: hash(pin),
      pinAttempts: { $lt: 5 }, pinExpiresAt: { $gt: new Date() } },
    { $set: { nodeId: node.nodeId, pinExpiresAt: new Date(0) } }, { new: true });
    if (!paired) return fail(res, 409, 'Pairing changed; scan again');
  } catch (error) { if (error.code === 11000) return fail(res, 409, 'Node already has an ESP32'); throw error; }
  res.json({ success: true, deviceId, nodeId: node.nodeId });
}));

router.patch('/nodes/:nodeId/mute', requireAuth, requireAdmin, wrap(async (req, res) => {
  if (typeof req.body.muted !== 'boolean') return fail(res, 400, 'muted must be true or false');
  const node = await Node.findOneAndUpdate({ nodeId: req.params.nodeId.toUpperCase() },
    { audioMuted: req.body.muted }, { new: true });
  if (!node) return fail(res, 404, 'Node not found');
  res.json({ success: true, muted: node.audioMuted });
}));

router.delete('/nodes/:nodeId', requireAuth, requireAdmin, wrap(async (req, res) => {
  await EspDevice.updateOne({ nodeId: req.params.nodeId.toUpperCase() }, { $set: { nodeId: null, pinExpiresAt: new Date(0) } });
  res.json({ success: true });
}));

router.post('/alert', authenticate, wrap(async (req, res) => {
  const { emergencyType, sequenceNumber, source = 'manual_button' } = req.body;
  if (!['fire', 'medical', 'gunshot'].includes(emergencyType) || !Number.isInteger(sequenceNumber) || sequenceNumber < 1 ||
      sequenceNumber > 0xffffffff || !['manual_button', 'smoke_sensor'].includes(source) ||
      (source === 'smoke_sensor' && emergencyType !== 'fire')) return fail(res, 400, 'Invalid physical alert');
  const node = req.device.nodeId ? await Node.findOne({ nodeId: req.device.nodeId }) : null;
  if (!node || req.body.nodeId !== node.nodeId) return fail(res, 409, 'Pairing changed; this alert belongs to a different node');
  const deviceEventKey = hash(`${req.device._id}:${sequenceNumber}`);
  let recorded = Boolean(await Alert.exists({ deviceEventKey }));
  // Preserve the legacy per-node incident index while deduplicating ESP32 retries per device.
  for (let attempt = 0; !recorded && attempt < 4; attempt++) {
    const latest = await Alert.findOne({ nodeId: node.nodeId }).sort({ sequenceNumber: -1 }).select('sequenceNumber').lean();
    const floor = Math.max(latest?.sequenceNumber || 0, 0);
    if (!Number.isSafeInteger(floor) || floor >= Number.MAX_SAFE_INTEGER) return fail(res, 503, 'Incident sequence requires maintenance');
    await Node.updateOne({ _id: node._id }, { $max: { physicalSequence: floor } });
    const current = await Node.findOneAndUpdate({ _id: node._id }, { $inc: { physicalSequence: 1 } }, { new: true });
    if (!current) return fail(res, 409, 'Node was deleted');
    const packet = { nodeId: current.nodeId, building: current.building, room: current.room,
      emergencyType, sequenceNumber: current.physicalSequence };
    try {
      await Alert.create({ ...packet, checksum: computeAlertChecksum(packet), threatStatus: 'manual_alert',
        triggerSource: source, priority: 2, deviceId: req.device.deviceId, deviceSequence: sequenceNumber, deviceEventKey });
      recorded = true;
      await Node.updateOne({ _id: node._id }, { status: 'active', lastSeen: new Date() });
    } catch (error) {
      if (error.code !== 11000) throw error;
      recorded = Boolean(await Alert.exists({ deviceEventKey }));
    }
  }
  if (!recorded) return fail(res, 503, 'Incident sequence busy; retry this event');
  await EspDevice.updateOne({ _id: req.device._id }, { lastSeen: new Date() });
  res.json({ ack: true, sequenceNumber });
}));

export default router;
