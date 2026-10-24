import { createHash, randomInt } from 'node:crypto';
import { Node } from '../models/Node.js';

export const hashCode = code => createHash('sha256').update(code).digest('hex');

export async function issuePairing(nodeId) {
  // Codes are unique amongst pending nodes. The raw code is returned once, never stored.
  for (let attempt = 0; attempt < 10; attempt++) {
    const code = String(randomInt(100_000_000)).padStart(8, '0');
    const pairingHash = hashCode(code);
    if (await Node.exists({ pairingHash })) continue;
    const pairingExpiresAt = new Date(Date.now() + 10 * 60 * 1000);
    try {
      const node = await Node.findOneAndUpdate({ nodeId }, { pairingHash, pairingExpiresAt }, { new: true });
      if (!node) throw new Error('Node no longer exists');
      return { code, expiresAt: pairingExpiresAt };
    } catch (error) { if (error.code !== 11000) throw error; }
  }
  throw new Error('Unable to allocate a pairing code. Try again.');
}
