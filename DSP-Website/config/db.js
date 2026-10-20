import mongoose from 'mongoose';
import { config } from './config.js';

let mongodInstance = null;

export const connectDB = async () => {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }

  try {
    console.log(`[Database] Attempting connection to MongoDB at: ${config.mongoUri}`);
    await mongoose.connect(config.mongoUri, {
      serverSelectionTimeoutMS: 2500
    });
    console.log('[Database] Connected successfully to primary MongoDB instance.');
    return;
  } catch (err) {
    console.warn(`[Database] Could not connect to primary MongoDB (${err.message}).`);
  }

  if (config.env === 'development' || !process.env.NODE_ENV) {
    try {
      console.log('[Database] Starting in-memory MongoDB server for local development...');
      const { MongoMemoryServer } = await import('mongodb-memory-server');
      mongodInstance = await MongoMemoryServer.create();
      const memoryUri = mongodInstance.getUri();
      console.log(`[Database] In-memory MongoDB started at: ${memoryUri}`);

      await mongoose.connect(memoryUri);
      console.log('[Database] Connected successfully to in-memory MongoDB instance.');
    } catch (fallbackError) {
      console.error('[Database] Failed to launch in-memory MongoDB:', fallbackError.message);
      throw fallbackError;
    }
  } else {
    throw new Error('Could not connect to MongoDB and in-memory fallback is disabled in production.');
  }
};

export const disconnectDB = async () => {
  try {
    await mongoose.disconnect();
    if (mongodInstance) {
      await mongodInstance.stop();
    }
    console.log('[Database] Disconnected from MongoDB.');
  } catch (err) {
    console.error('[Database] Error disconnecting:', err.message);
  }
};
