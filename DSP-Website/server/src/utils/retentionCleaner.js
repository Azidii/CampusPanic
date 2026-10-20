import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Alert } from '../models/Alert.js';
import { config } from '../config/config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const UPLOADS_DIR = path.resolve(__dirname, '../../uploads/alerts');

/**
 * Purges alert images older than the retention threshold
 * Per Data Privacy Act compliance
 */
export const runRetentionCleanup = async () => {
  if (config.imageRetentionHours <= 0) {
    return;
  }

  const cutoff = new Date(Date.now() - config.imageRetentionHours * 60 * 60 * 1000);
  console.log(`[Retention Cleaner] Running cleanup for images older than ${config.imageRetentionHours} hours (before ${cutoff.toISOString()})...`);

  try {
    // 1. Find alerts with images older than cutoff
    const oldAlerts = await Alert.find({
      imageUrl: { $ne: null },
      timestamp: { $lt: cutoff }
    });

    let removedCount = 0;

    for (const alert of oldAlerts) {
      if (alert.imageUrl) {
        const filename = path.basename(alert.imageUrl);
        const filepath = path.join(UPLOADS_DIR, filename);

        if (fs.existsSync(filepath)) {
          try {
            fs.unlinkSync(filepath);
            removedCount++;
          } catch (e) {
            console.warn(`[Retention Cleaner] Failed to delete file ${filepath}:`, e.message);
          }
        }

        // Clear the imageUrl reference or keep alert metadata intact
        alert.imageUrl = null;
        await alert.save();
      }
    }

    // 2. Also check disk files directly for unreferenced or orphan expired images
    if (fs.existsSync(UPLOADS_DIR)) {
      const files = fs.readdirSync(UPLOADS_DIR);
      for (const file of files) {
        if (file === '.gitkeep') continue;
        const filepath = path.join(UPLOADS_DIR, file);
        try {
          const stats = fs.statSync(filepath);
          if (stats.mtime < cutoff) {
            fs.unlinkSync(filepath);
            removedCount++;
          }
        } catch (e) {
          // ignore
        }
      }
    }

    if (removedCount > 0) {
      console.log(`[Retention Cleaner] Successfully deleted ${removedCount} expired alert image(s).`);
    }
  } catch (err) {
    console.error('[Retention Cleaner] Error during retention cleanup:', err.message);
  }
};

/**
 * Initializes recurring retention cleanup interval (runs hourly)
 */
export const startRetentionCleaner = () => {
  if (config.imageRetentionHours <= 0) {
    console.log('[Retention Cleaner] Automatic retention cleanup disabled (retention period = 0).');
    return;
  }
  // Run once immediately on startup
  runRetentionCleanup();
  // Then run every 60 minutes
  setInterval(runRetentionCleanup, 60 * 60 * 1000);
  console.log(`[Retention Cleaner] Scheduled to run hourly. Retention window: ${config.imageRetentionHours} hours.`);
};
