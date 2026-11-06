import { createHash } from 'node:crypto';
import { Alert } from '../models/Alert.js';
import { Node } from '../models/Node.js';
import { withIncidentReset } from './incidentGuard.js';
import { removeSnapshot } from '../utils/snapshots.js';

export async function resetPreview() {
  const hash = createHash('sha256'); let count = 0;
  for await (const alert of Alert.find().select('_id updatedAt imageUrl').sort({ _id: 1 }).lean().cursor()) {
    hash.update(JSON.stringify(alert)); count++;
  }
  return { count, fingerprint: hash.digest('hex') };
}
export async function reconcileNodeIncidents(nodeIds) {
  const active = await Alert.distinct('nodeId', { nodeId: { $in: nodeIds }, status: { $ne: 'resolved' } });
  await Node.updateMany({ nodeId: { $in: active } }, { $set: { status: 'active' } });
  // Connectivity is projected from live camera sessions / ESP32 heartbeats, never from incident closure.
  await Node.updateMany({ nodeId: { $in: nodeIds, $nin: active }, status: 'active' }, { $set: { status: 'offline' } });
}
export async function deleteAllAlerts(expected, remove = removeSnapshot) {
  return withIncidentReset(async () => {
    const current = await resetPreview();
    if (current.count !== expected.count || current.fingerprint !== expected.fingerprint) {
      throw Object.assign(new Error('Alerts changed. Review the current count and confirm again.'), { statusCode: 409 });
    }
    let deleted = 0; const failures = [];
    for await (const alert of Alert.find().select('_id imageUrl').lean().cursor()) {
      try {
        await remove(alert.imageUrl);
        const result = await Alert.deleteOne({ _id: alert._id }); deleted += result.deletedCount;
      } catch { failures.push({ alertId: String(alert._id), message: 'Could not remove snapshot or incident; record retained for retry.' }); }
    }
    let reconciled = true;
    try { await reconcileNodeIncidents(await Node.distinct('nodeId')); }
    catch { reconciled = false; }
    return { deleted, remaining: await Alert.countDocuments(), failures, reconciled };
  });
}
