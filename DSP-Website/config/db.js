import mongoose from 'mongoose';
import { config } from './config.js';
import { configureMongoDns, mongoConnectionError, validateMongoUri } from './mongoConfig.js';
import { installNodeNameIndex } from '../services/nodeNames.js';

export const connectDB = async () => {
  try {
    validateMongoUri(config.mongoUri);
    configureMongoDns();
    await mongoose.connect(config.mongoUri, { serverSelectionTimeoutMS: 10000 });
  } catch (error) {
    throw mongoConnectionError(error);
  }
  await installNodeNameIndex();
  console.log('[Database] Connected to persistent MongoDB storage; node name constraint verified.');
};
export const disconnectDB = async () => { await mongoose.disconnect(); };
