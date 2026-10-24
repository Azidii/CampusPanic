import mongoose from 'mongoose';
import { config } from '../config/config.js';

// This check never starts the application, seeds data or uses a temporary database.
const checkDB = async () => {
  if (!process.env.MONGODB_URI || /<[^>]+>/.test(config.mongoUri)) {
    console.error('[Database check] Enter your MongoDB database username and password in DSP-Website/.env first.');
    process.exitCode = 1;
    return;
  }

  try {
    await mongoose.connect(config.mongoUri, { serverSelectionTimeoutMS: 10000 });
    await mongoose.connection.db.command({ ping: 1 });
    console.log(`[Database check] Connected successfully. Database: ${mongoose.connection.name}`);
  } catch (error) {
    // Avoid logging driver messages because they can include connection credentials.
    const hint = error.code === 18
      ? 'Check your MongoDB database username and password.'
      : 'Check the connection string, database credentials, network and Atlas IP access list.';
    console.error(`[Database check] Connection failed. ${hint}`);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
};

await checkDB();
