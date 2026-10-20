import mongoose from 'mongoose';

const cameraSchema = new mongoose.Schema(
  {
    cameraId: {
      type: String,
      required: [true, 'cameraId is required'],
      unique: true,
      trim: true
    },
    label: {
      type: String,
      required: [true, 'label is required'],
      trim: true
    },
    nodeId: {
      type: String,
      trim: true,
      default: null,
      index: true
    },
    building: {
      type: String,
      trim: true,
      default: 'Unknown Building'
    },
    room: {
      type: String,
      trim: true,
      default: 'Unknown Room'
    },
    online: {
      type: Boolean,
      default: false,
      index: true
    },
    lastFrameAt: {
      type: Date,
      default: null
    },
    lastFrameUrl: {
      type: String,
      default: null
    }
  },
  {
    timestamps: true
  }
);

export const Camera = mongoose.model('Camera', cameraSchema);
