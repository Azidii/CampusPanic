import mongoose from 'mongoose';
import { config } from './config.js';

export const connectDB = async () => {
  if (/<[^>]+>/.test(config.mongoUri)) throw new Error('Replace MongoDB placeholders in DSP-Website/.env.');
  try {
    await mongoose.connect(config.mongoUri, { serverSelectionTimeoutMS: 10000 });
    console.log('[Database] Connected to persistent MongoDB storage.');
  } catch {
    throw new Error('Cannot connect to MongoDB. Start local MongoDB or configure MONGODB_URI for Atlas. Temporary storage is disabled so saved security nodes are preserved.');
  }
};
export const disconnectDB = async () => { await mongoose.disconnect(); };
