import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { unlink } from 'node:fs/promises';

export const SNAPSHOT_DIR = fileURLToPath(new URL('../uploads/alerts/', import.meta.url));
export async function removeSnapshot(url, remove = unlink) {
  if (!url) return;
  if (typeof url !== 'string' || !/^\/uploads\/alerts\/[^/\\]+$/.test(url) || ['.', '..'].includes(path.basename(url))) {
    throw new Error('Snapshot path requires manual review.');
  }
  try { await remove(path.join(SNAPSHOT_DIR, path.basename(url))); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
}
