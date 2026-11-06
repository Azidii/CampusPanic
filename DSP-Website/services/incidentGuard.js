import mongoose from 'mongoose';
import { randomUUID } from 'node:crypto';

const busy = () => Object.assign(new Error('Alert maintenance is busy. Retry shortly.'), { statusCode: 503 });
async function collection() {
  const locks = mongoose.connection.collection('maintenance');
  try { await locks.updateOne({ _id: 'alerts' }, { $setOnInsert: { resetting: false, writers: [] } }, { upsert: true }); }
  catch (error) { if (error.code !== 11000) throw error; }
  return locks;
}

// shortcut: crashed guards require recovery with all writers stopped; add fenced leases
// if unattended recovery becomes necessary (see maintenance docs).
export async function withIncidentWrite(fn) {
  const locks = await collection(), id = randomUUID();
  const result = await locks.updateOne({ _id: 'alerts', resetting: false }, { $addToSet: { writers: id } });
  if (!result.matchedCount) throw busy();
  try { return await fn(); }
  finally { await locks.updateOne({ _id: 'alerts' }, { $pull: { writers: id } }); }
}

export async function withIncidentReset(fn) {
  const locks = await collection(), id = randomUUID();
  const result = await locks.updateOne({ _id: 'alerts', resetting: false, writers: { $size: 0 } }, { $set: { resetting: id } });
  if (!result.matchedCount) throw busy();
  try { return await fn(); }
  finally { await locks.updateOne({ _id: 'alerts', resetting: id }, { $set: { resetting: false } }); }
}

export const incidentWrite = fn => (req, res, next) => withIncidentWrite(() => fn(req, res, next)).catch(next);
