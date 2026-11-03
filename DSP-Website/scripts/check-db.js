import mongoose from 'mongoose';
import dns from 'node:dns';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import '../config/env.js';
import { configureMongoDns, mongoConnectionError, resolveMongoUri, validateMongoUri } from '../config/mongoConfig.js';

// This check never starts the application, seeds data or uses a temporary database.
export const checkDB = async ({ client = mongoose, env = process.env, logger = console, resolver = dns } = {}) => {
  let success = false;
  try {
    const uri = resolveMongoUri(env);
    validateMongoUri(uri);
    configureMongoDns(env, resolver);
    await client.connect(uri, { serverSelectionTimeoutMS: 10000 });
    await client.connection.db.command({ ping: 1 });
    logger.log(`[Database check] Connected successfully. Database: ${client.connection.name} (persistent storage; ping passed).`);
    success = true;
  } catch (error) {
    const diagnostic = mongoConnectionError(error);
    logger.error(`[Database check] ${diagnostic.code}: ${diagnostic.message}`);
  } finally {
    try {
      await client.disconnect();
    } catch (error) {
      const diagnostic = mongoConnectionError(error);
      logger.error(`[Database check] Disconnect failed. ${diagnostic.code}: ${diagnostic.message}`);
      success = false;
    }
  }
  return success;
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!await checkDB()) process.exitCode = 1;
}
