import mongoose from 'mongoose';
import { config } from './config.js';
import { configureMongoDns, mongoConnectionError, validateMongoUri } from './mongoConfig.js';

export const connectDB = async () => {
  try {
    validateMongoUri(config.mongoUri);
    configureMongoDns();
    await mongoose.connect(config.mongoUri, { serverSelectionTimeoutMS: 10000 });
    console.log('[Database] Connected to persistent MongoDB storage.');
  } catch (error) {
    throw mongoConnectionError(error);
  }
};
export const disconnectDB = async () => { await mongoose.disconnect(); };
