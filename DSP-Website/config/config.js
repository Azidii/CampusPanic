import './env.js';
import { resolveMongoUri } from './mongoConfig.js';

const requiredSecret = (name) => {
  const value = process.env[name];
  if (!value || !value.trim()) throw new Error(`Missing required environment variable: ${name}`);
  return value;
};

export const config = {
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT, 10) || 5000,
  clientUrl: process.env.CLIENT_URL || 'http://localhost:5000',
  mongoUri: resolveMongoUri(process.env),
  jwtSecret: requiredSecret('JWT_SECRET'),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  deviceApiKey: requiredSecret('DEVICE_API_KEY'),
  imageRetentionHours: parseInt(process.env.IMAGE_RETENTION_HOURS, 10) || 24,
  admin: {
    name: process.env.ADMIN_NAME || 'Chief of Campus Security',
    email: (process.env.ADMIN_EMAIL || 'admin@campuspanic.edu').toLowerCase(),
    password: requiredSecret('ADMIN_PASSWORD'),
    assignedBuilding: process.env.ADMIN_BUILDING || 'Security HQ'
  }
};
