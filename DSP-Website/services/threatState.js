import { Alert } from '../models/Alert.js';
import { Node } from '../models/Node.js';
import { describeAudio } from './espDevices.js';
import { computeAlertChecksum } from '../utils/checksum.js';
import { withIncidentWrite } from './incidentGuard.js';

export const THREAT_KEYS = ['smoke', 'fire', 'medical', 'shooting'];
export const emptyOutputs = () => ({ fire: false, medical: false, shooting: false });

export function outputsFromAlerts(alerts) {
  const outputs = emptyOutputs();
  for (const alert of alerts) {
    if (alert.status === 'resolved') continue;
    if (alert.emergencyType === 'fire') outputs.fire = true;
    if (alert.emergencyType === 'medical') outputs.medical = true;
    if (alert.emergencyType === 'gunshot') outputs.shooting = true;
  }
  return outputs;
}

export function projectThreatState(node, alerts, now = Date.now()) {
  const active = alerts.filter(a => a.nodeId === node.nodeId && a.status !== 'resolved');
  const alarms = outputsFromAlerts(active);
  const cameraFresh = Boolean(node.cameraTelemetry &&
    now - node.cameraTelemetry.receivedAt < 5000);
  const smokeIncident = active.some(a => a.triggerSource === 'smoke_sensor');
  const threats = { smoke: smokeIncident ? true : null,
    fire: alarms.fire, medical: alarms.medical, shooting: alarms.shooting };
  return {
    threats,
    hardware: { paired: Boolean(node.audio?.paired), connected: Boolean(node.audio?.connected),
      lastSeen: node.audio?.lastSeen || null },
    batteryPercentage: cameraFresh ? node.cameraTelemetry.batteryPercentage : null,
    network: cameraFresh ? node.cameraTelemetry.network : 'offline',
    cameraConnected: cameraFresh && Boolean(node.video?.cameraConnected),
    updatedAt: new Date(now).toISOString()
  };
}

export async function attachThreatState(nodes) {
  if (!nodes.length) return nodes;
  const ids = nodes.map(node => node.nodeId);
  const alerts = await Alert.find({ nodeId: { $in: ids }, status: { $ne: 'resolved' } })
    .select('nodeId emergencyType status triggerSource').lean();
  return nodes.map(node => ({ ...node, hud: projectThreatState(node, alerts) }));
}

export async function nodeHud(nodeId, session) {
  const document = await Node.findOne({ nodeId });
  if (!document) return null;
  const [node] = await describeAudio([document.toObject()]);
  node.cameraTelemetry = session?.telemetry;
  node.video = { cameraConnected: Boolean(session && Date.now() - session.activity < 5000) };
  const [described] = await attachThreatState([node]);
  return described.hud;
}

export function cameraTelemetry(headers, now = Date.now()) {
  const rawBattery = headers['x-camera-battery'];
  const battery = rawBattery == null || rawBattery === '' ? NaN : Number(rawBattery);
  return {
    batteryPercentage: Number.isInteger(battery) && battery >= 0 && battery <= 100 ? battery : null,
    network: ['wifi', 'cellular', 'ethernet', 'connected', 'offline'].includes(headers['x-camera-network'])
      ? headers['x-camera-network'] : 'unknown',
    receivedAt: now
  };
}

export function validGunDetections(detections) {
  if (!Array.isArray(detections)) return [];
  return detections.slice(0, 32).filter(d => d &&
    /^(gun|pistol|handgun|rifle|firearm|weapon|shooter|shooting)$/i.test(String(d.label || '')) &&
    Number.isFinite(d.confidence) && d.confidence >= 0.5 && d.confidence <= 1 &&
    Array.isArray(d.box) && d.box.length === 4 && d.box.every(Number.isFinite))
    .map(d => ({ label: String(d.label).toLowerCase(), confidence: d.confidence, box: d.box }));
}

const pendingIncidents = new Map();
export async function recordDetectionIncident(nodeId, key, emergencyType, triggerSource, confidence) {
  if (pendingIncidents.has(key)) return pendingIncidents.get(key);
  const operation = withIncidentWrite(async () => {
    for (let attempt = 0; attempt < 4; attempt++) {
      const existing = await Alert.findOne({ deviceEventKey: key, status: { $ne: 'resolved' } });
      if (existing) return existing;
      const node = await Node.findOne({ nodeId });
      if (!node) return null;
      const latest = await Alert.findOne({ nodeId }).sort({ sequenceNumber: -1 }).select('sequenceNumber').lean();
      const floor = Math.max(latest?.sequenceNumber || 0, 0);
      if (!Number.isSafeInteger(floor) || floor >= Number.MAX_SAFE_INTEGER) throw new Error('Incident sequence exhausted');
      await Node.updateOne({ _id: node._id }, { $max: { physicalSequence: floor } });
      const current = await Node.findOneAndUpdate({ _id: node._id },
        { $inc: { physicalSequence: 1 }, $set: { status: 'active' } }, { new: true });
      if (!current) return null;
      const packet = { nodeId, building: current.building, room: current.room,
        emergencyType, sequenceNumber: current.physicalSequence };
      try {
        return await Alert.create({ ...packet, deviceEventKey: key,
          checksum: computeAlertChecksum(packet), triggerSource,
          threatStatus: 'verified_threat', priority: emergencyType === 'gunshot' ? 1 : 2, ...confidence });
      } catch (error) { if (error.code !== 11000) throw error; }
    }
    throw new Error('Incident sequence busy; retry detection');
  });
  pendingIncidents.set(key, operation);
  try { return await operation; } finally { pendingIncidents.delete(key); }
}

export async function recordVisionThreat(nodeId, detections) {
  const accepted = validGunDetections(detections);
  if (!accepted.length) return null;
  return recordDetectionIncident(nodeId, `camera:${nodeId}`, 'gunshot', 'camera_detection',
    { firearmConfidence: Math.max(...accepted.map(d => d.confidence)) });
}

export async function recordAudioThreat(nodeId, result) {
  if (!result.alert || !['Gunshot', 'Scream'].includes(result.class) ||
      !Number.isFinite(result.confidence) || result.confidence < 0 || result.confidence > 1) return null;
  const type = result.class === 'Gunshot' ? 'gunshot' : 'panic';
  return recordDetectionIncident(nodeId, `audio:${nodeId}:${type}`, type, 'audio_detection',
    { audioConfidence: result.confidence });
}
