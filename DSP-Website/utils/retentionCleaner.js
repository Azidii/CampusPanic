import fs from 'node:fs/promises';
import path from 'node:path';
import { Alert } from '../models/Alert.js';
import { config } from '../config/config.js';
import { withIncidentWrite } from '../services/incidentGuard.js';
import { removeSnapshot, SNAPSHOT_DIR } from './snapshots.js';

export async function cleanupAlertSnapshot(alert, remove = removeSnapshot) {
  await remove(alert.imageUrl);
  await Alert.updateOne({ _id: alert._id, imageUrl: alert.imageUrl }, { $set: { imageUrl: null } });
}
export async function runRetentionCleanup() {
  if (config.imageRetentionHours <= 0) return;
  const cutoff = new Date(Date.now() - config.imageRetentionHours * 3600000);
  try {
    await withIncidentWrite(async () => {
      for await (const alert of Alert.find({ imageUrl: { $ne: null }, timestamp: { $lt: cutoff } }).lean().cursor()) {
        try { await cleanupAlertSnapshot(alert); }
        catch { console.warn('[Retention] Snapshot cleanup failed; database reference retained:', String(alert._id)); }
      }
      const referenced = new Set(await Alert.distinct('imageUrl', { imageUrl: { $ne: null } }));
      let files;
      try { files = await fs.readdir(SNAPSHOT_DIR); }
      catch (error) { if (error.code === 'ENOENT') return; throw error; }
      for (const filename of files) {
        if (filename === '.gitkeep' || referenced.has(`/uploads/alerts/${filename}`)) continue;
        try {
          const stat = await fs.stat(path.join(SNAPSHOT_DIR, filename));
          if (stat.isFile() && stat.mtime < cutoff) await removeSnapshot(`/uploads/alerts/${filename}`);
        } catch { console.warn('[Retention] Unreferenced snapshot could not be removed.'); }
      }
    });
  } catch { console.warn('[Retention] Cleanup unavailable; will retry on the next sweep.'); }
}
export function startRetentionCleaner() {
  if (config.imageRetentionHours <= 0) return;
  runRetentionCleanup();
  setInterval(runRetentionCleanup, 3600000).unref();
}
