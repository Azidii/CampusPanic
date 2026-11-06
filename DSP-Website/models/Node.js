import mongoose from 'mongoose';

const nodeSchema = new mongoose.Schema(
  {
    name: { type: String, trim: true, maxlength: 100, required: true },
    nameKey: { type: String, select: false },
    videoEnabled: { type: Boolean, default: false },
    audioMuted: { type: Boolean, default: false },
    physicalSequence: { type: Number, default: 0 },
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
      enum: ['RSY', 'RG Birrey'],
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
nodeSchema.pre('validate', function () { if (typeof this.name === 'string') this.nameKey = this.name.trim().toLowerCase(); });

export const Node = mongoose.model('Node', nodeSchema);
