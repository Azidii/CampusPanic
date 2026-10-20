import { config } from '../config/config.js';

export const requireDeviceApiKey = (req, res, next) => {
  const apiKey = req.headers['x-device-api-key'] || req.headers['x-api-key'];

  if (!apiKey) {
    return res.status(401).json({
      ack: false,
      error: 'Device API key missing. Expected header x-device-api-key'
    });
  }

  if (apiKey !== config.deviceApiKey) {
    return res.status(403).json({
      ack: false,
      error: 'Invalid device API key'
    });
  }

  next();
};
