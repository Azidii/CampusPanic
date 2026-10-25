import mongoose from 'mongoose';

const schema = new mongoose.Schema({
  deviceId: { type: String, required: true, unique: true },
  tokenHash: { type: String, required: true, select: false },
  pinHash: { type: String, required: true, select: false },
  pinExpiresAt: { type: Date, required: true },
  pinAttempts: { type: Number, default: 0 },
  nodeId: { type: String, default: null },
  lastSeen: { type: Date, required: true },
  capability: { type: String, enum: ['voice_v3'], default: 'voice_v3' }
}, { timestamps: true });
schema.index({ nodeId: 1 }, { unique: true, partialFilterExpression: { nodeId: { $type: 'string' } } });
export const EspDevice = mongoose.model('EspDevice', schema);
