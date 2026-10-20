import mongoose from 'mongoose';

const nodeSchema = new mongoose.Schema(
  {
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
      required: [true, 'latitude is required']
    },
    lng: {
      type: Number,
      required: [true, 'longitude is required']
    },
    status: {
      type: String,
      enum: ['online', 'offline', 'active'],
      default: 'online'
    },
    lastSeen: {
      type: Date,
      default: Date.now
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

export const Node = mongoose.model('Node', nodeSchema);
