import { Alert } from '../models/Alert.js';

export const BUILDINGS = ['RSY', 'RG Birrey'];
export function buildingFilter(value = 'all') {
  if (typeof value !== 'string' || (value !== 'all' && !BUILDINGS.includes(value))) {
    throw Object.assign(new Error('Choose All buildings, RSY or RG Birrey.'), { statusCode: 400 });
  }
  return value === 'all' ? {} : { building: value };
}
export function pageNumber(value, fallback = 1, max = Number.MAX_SAFE_INTEGER) {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) > max) {
    throw Object.assign(new Error('Invalid pagination value.'), { statusCode: 400 });
  }
  return Number(value);
}
export function incidentFilter(params) {
  const query = buildingFilter(params.building);
  for (const [key, field, allowed] of [
    ['type', 'emergencyType', ['gunshot', 'medical', 'fire', 'panic']],
    ['status', 'status', ['new', 'acknowledged', 'resolved']],
    ['threatStatus', 'threatStatus', ['verified_threat', 'unverified_audio_trigger', 'manual_alert']]
  ]) {
    if (params[key] === undefined || params[key] === 'all') continue;
    if (typeof params[key] !== 'string' || !allowed.includes(params[key])) throw Object.assign(new Error(`Invalid ${key} filter.`), { statusCode: 400 });
    query[field] = params[key];
  }
  if (params.search !== undefined) {
    if (typeof params.search !== 'string' || params.search.length > 100) throw Object.assign(new Error('Search must be at most 100 characters.'), { statusCode: 400 });
    const literal = params.search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (literal) query.$or = ['nodeId', 'building', 'room', 'acknowledgedBy'].map(field => ({ [field]: { $regex: literal, $options: 'i' } }));
  }
  return query;
}
export async function alertCounts(scope = {}) {
  const rows = await Alert.aggregate([{ $match: scope }, { $group: { _id: '$emergencyType', total: { $sum: 1 },
    open: { $sum: { $cond: [{ $ne: ['$status', 'resolved'] }, 1, 0] } },
    verified: { $sum: { $cond: [{ $and: [{ $ne: ['$status', 'resolved'] }, { $eq: ['$threatStatus', 'verified_threat'] }] }, 1, 0] } } } }]);
  const counts = { gunshot: 0, medical: 0, fire: 0, panic: 0, total: 0, unresolved: 0, unresolvedTotal: 0, verifiedThreats: 0 };
  for (const row of rows) { counts[row._id] = row.total; counts.total += row.total; counts.unresolved += row.open; counts.verifiedThreats += row.verified; }
  counts.unresolvedTotal = counts.unresolved;
  return counts;
}
export async function dashboardFeed(userId, params = {}) {
  const scope = buildingFilter(params.building), filter = incidentFilter(params);
  const openFilter = { ...filter, status: filter.status && filter.status !== 'resolved' ? filter.status : { $ne: 'resolved' } };
  const historyFilter = { ...filter, status: 'resolved', ...(params.showCleared === 'true' ? {} : { clearedBy: { $ne: userId } }) };
  const requestedPage = pageNumber(params.historyPage), limit = 10;
  const [alerts, total, counts, campusOpen, latestThreat] = await Promise.all([
    Alert.find(openFilter).sort({ priority: 1, timestamp: -1, _id: -1 }).lean(),
    Alert.countDocuments(historyFilter), alertCounts(scope), Alert.countDocuments({ status: { $ne: 'resolved' } }),
    Alert.findOne({ ...scope, status: { $ne: 'resolved' }, threatStatus: 'verified_threat' }).sort({ timestamp: -1 }).lean()
  ]);
  const totalPages = Math.max(1, Math.ceil(total / limit)), page = Math.min(requestedPage, totalPages);
  const history = await Alert.find(historyFilter).sort({ timestamp: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean();
  return { alerts, history, counts, latestThreat, outsideOpen: campusOpen - counts.unresolved,
    historyPage: page, historyTotal: total, historyPages: totalPages };
}
