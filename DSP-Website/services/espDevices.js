import { createHash, timingSafeEqual } from 'node:crypto';
import { EspDevice } from '../models/EspDevice.js';

export const hash = value => createHash('sha256').update(value).digest('hex');
export const fresh = device => Boolean(device?.lastSeen && Date.now() - new Date(device.lastSeen).getTime() < 20000);
export const sameHash = (a, b) => typeof a === 'string' && typeof b === 'string' &&
  a.length === 64 && b.length === 64 && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export async function describeAudio(nodes) {
  const devices = await EspDevice.find({ nodeId: { $in: nodes.map(node => node.nodeId) } });
  const byNode = new Map(devices.map(device => [device.nodeId, device]));
  return nodes.map(node => {
    const device = byNode.get(node.nodeId);
    const connected = fresh(device);
    node.audio = { deviceId: device?.deviceId || null, paired: Boolean(device), connected,
      muted: Boolean(node.audioMuted), rawAudioAvailable: false,
      status: !device ? 'not_configured' : !connected ? 'offline' : node.audioMuted ? 'muted' : 'connected_no_raw_audio',
      lastSeen: device?.lastSeen || null };
    node.audioStatus = node.audio.status;
    if (connected && node.status !== 'active') node.status = 'online';
    return node;
  });
}
