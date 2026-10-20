import crypto from 'crypto';

/**
 * Generates canonical string for alert checksum
 * @param {Object} data 
 * @returns {string}
 */
export const getCanonicalAlertString = (data) => {
  const nodeId = String(data.nodeId || '').trim().toUpperCase();
  const seq = String(data.sequenceNumber ?? '');
  const type = String(data.emergencyType || '').trim().toLowerCase();
  const building = String(data.building || '').trim();
  const room = String(data.room || '').trim();
  return `${nodeId}|${seq}|${type}|${building}|${room}`;
};

/**
 * Computes standard SHA-256 hex checksum
 * @param {Object} data 
 * @returns {string} 8-to-64 char hex string
 */
export const computeAlertChecksum = (data) => {
  const canonical = getCanonicalAlertString(data);
  return crypto.createHash('sha256').update(canonical).digest('hex');
};

/**
 * Computes MD5 hex checksum (common on ESP32 microcontrollers)
 * @param {Object} data 
 * @returns {string}
 */
export const computeMD5Checksum = (data) => {
  const canonical = getCanonicalAlertString(data);
  return crypto.createHash('md5').update(canonical).digest('hex');
};

/**
 * Verifies checksum of incoming alert packet.
 * Supports full SHA-256, 8-character truncated SHA-256, or MD5.
 * Also supports exact raw payload hash if provided.
 *
 * @param {Object} data - Packet data { nodeId, sequenceNumber, emergencyType, building, room, checksum }
 * @returns {boolean}
 */
export const verifyChecksum = (data) => {
  if (!data || !data.checksum) return false;
  const provided = String(data.checksum).trim().toLowerCase();

  const sha256Full = computeAlertChecksum(data).toLowerCase();
  const sha256Prefix8 = sha256Full.slice(0, 8);
  const md5Full = computeMD5Checksum(data).toLowerCase();
  const md5Prefix8 = md5Full.slice(0, 8);

  // Check if matches standard hashes
  if (
    provided === sha256Full ||
    provided === sha256Prefix8 ||
    provided === md5Full ||
    provided === md5Prefix8
  ) {
    return true;
  }

  // Also support simple fallback hash: hex of nodeId:seq:type
  const simpleSha = crypto.createHash('sha256')
    .update(`${data.nodeId}:${data.sequenceNumber}:${data.emergencyType}`)
    .digest('hex').toLowerCase();

  if (provided === simpleSha || provided === simpleSha.slice(0, 8)) {
    return true;
  }

  return false;
};
