import mongoose from 'mongoose';

const nodeSchema = new mongoose.Schema(
  {
    name: { type: String, trim: true, maxlength: 100, default: '' },
    videoEnabled: { type: Boolean, default: false },
    pairingHash: { type: String, select: false },
    pairingExpiresAt: { type: Date, default: null },
    nodeId: {
      type: String,
      required: [true, 'nodeId is required'],
      unique: true,
      trim: true,
      uppercase: true
    },
    building: {
      type: String,
      required: [true, 'building is required'],
      trim: true
    },
    room: {
      type: String,
      required: [true, 'room is required'],
      trim: true
    },
    lat: {
      type: Number,
      default: null
    },
    lng: {
      type: Number,
      default: null
    },
    status: {
      type: String,
      enum: ['online', 'offline', 'active'],
      default: 'offline'
    },
    lastSeen: {
      type: Date,
      default: null
    },
    cameraId: {
      type: String,
      trim: true,
      default: null
    }
  },
  {
    timestamps: true
  }
);

nodeSchema.index({ building: 1, room: 1 });
nodeSchema.index({ status: 1 });
nodeSchema.index({ pairingHash: 1 }, { unique: true, sparse: true });

export const Node = mongoose.model('Node', nodeSchema);
