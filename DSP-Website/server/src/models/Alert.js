import mongoose from 'mongoose';

const alertSchema = new mongoose.Schema(
  {
    nodeId: {
      type: String,
      required: [true, 'nodeId is required'],
      trim: true,
      uppercase: true,
      index: true
    },
    building: {
      type: String,
      required: [true, 'building is required'],
      trim: true,
      index: true
    },
    room: {
      type: String,
      required: [true, 'room is required'],
      trim: true
    },
    emergencyType: {
      type: String,
      required: [true, 'emergencyType is required'],
      enum: ['gunshot', 'medical', 'fire', 'panic'],
      index: true
    },
    threatStatus: {
      type: String,
      required: [true, 'threatStatus is required'],
      enum: ['verified_threat', 'unverified_audio_trigger', 'manual_alert'],
      index: true
    },
    // Priority: 1 = Critical (verified_threat), 2 = High (manual alerts: fire/panic/medical), 3 = Warning (unverified audio trigger)
    priority: {
      type: Number,
      required: [true, 'priority is required'],
      default: 2,
      index: true
    },
    sequenceNumber: {
      type: Number,
      required: [true, 'sequenceNumber is required']
    },
    timestamp: {
      type: Date,
      default: Date.now,
      index: true
    },
    checksum: {
      type: String,
      required: [true, 'checksum is required'],
      trim: true
    },
    imageUrl: {
      type: String,
      default: null
    },
    audioConfidence: {
      type: Number,
      min: 0,
      max: 1,
      default: null
    },
    firearmConfidence: {
      type: Number,
      min: 0,
      max: 1,
      default: null
    },
    status: {
      type: String,
      enum: ['new', 'acknowledged', 'resolved'],
      default: 'new',
      index: true
    },
    acknowledgedBy: {
      type: String,
      default: null
    },
    acknowledgedAt: {
      type: Date,
      default: null
    },
    resolvedAt: {
      type: Date,
      default: null
    }
  },
  {
    timestamps: true
  }
);

// Compound unique index for deduplication: (nodeId, sequenceNumber)
alertSchema.index({ nodeId: 1, sequenceNumber: 1 }, { unique: true });

// Compound index for priority-sorted alert feed
alertSchema.index({ status: 1, priority: 1, timestamp: -1 });

export const Alert = mongoose.model('Alert', alertSchema);
