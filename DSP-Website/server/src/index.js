import express from 'express';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import { Server } from 'socket.io';

import { config } from './config/config.js';
import { connectDB } from './config/db.js';
import { initSocketIO } from './sockets/socketHandler.js';
import { errorHandler } from './middleware/errorHandler.js';
import { startRetentionCleaner } from './utils/retentionCleaner.js';
import { User } from './models/User.js';

// Route imports
import authRoutes from './routes/authRoutes.js';
import userRoutes from './routes/userRoutes.js';
import profileRoutes from './routes/profileRoutes.js';
import nodeRoutes from './routes/nodeRoutes.js';
import alertRoutes from './routes/alertRoutes.js';
import cameraRoutes from './routes/cameraRoutes.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);

// Initialize Socket.IO with CORS
const io = new Server(server, {
  cors: {
    origin: [config.clientUrl, 'http://localhost:5173', 'http://127.0.0.1:5173'],
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'],
    credentials: true
  }
});
initSocketIO(io);

// Security Middleware
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' }, // Allow loading uploaded images in frontend
    crossOriginEmbedderPolicy: false
  })
);

app.use(
  cors({
    origin: [config.clientUrl, 'http://localhost:5173', 'http://127.0.0.1:5173'],
    credentials: true
  })
);

// Body parsers with support for base64 camera frames
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));
app.use(cookieParser());

// Rate Limiter for general API protection
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000, // 1000 requests per 15 min
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests, please try again later.' }
});
app.use('/api/', generalLimiter);

// Static directory for uploaded alert snapshots
const uploadsPath = path.resolve(__dirname, '../uploads');
app.use('/uploads', express.static(uploadsPath));

// API Health Check
app.get('/api/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    service: 'CampusPanic Alert Security Gateway',
    environment: config.env
  });
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/nodes', nodeRoutes);
app.use('/api/alerts', alertRoutes);
app.use('/api/cameras', cameraRoutes);

// Error Handler
app.use(errorHandler);

// Automatic Initial Admin Check
const ensureInitialAdmin = async () => {
  try {
    const adminCount = await User.countDocuments({ role: 'admin' });
    if (adminCount === 0) {
      console.log(`[Bootstrap] No administrator found. Creating default admin (${config.admin.email})...`);
      const passwordHash = await User.hashPassword(config.admin.password);
      await User.create({
        name: config.admin.name,
        email: config.admin.email,
        passwordHash,
        role: 'admin',
        isActive: true,
        assignedBuilding: config.admin.assignedBuilding
      });
      console.log(`[Bootstrap] Administrator account created: ${config.admin.email}`);
    }
  } catch (err) {
    console.error('[Bootstrap] Error checking default admin:', err.message);
  }
};

// Start Server
const startServer = async () => {
  try {
    await connectDB();
    await ensureInitialAdmin();
    startRetentionCleaner();

    server.listen(config.port, () => {
      console.log(`=======================================================`);
      console.log(` CampusPanic Server listening on port ${config.port}`);
      console.log(` Environment: ${config.env}`);
      console.log(` Client URL: ${config.clientUrl}`);
      console.log(` Ingest Endpoint: POST http://localhost:${config.port}/api/alerts/ingest`);
      console.log(`=======================================================`);
    });
  } catch (err) {
    console.error('[Startup Error] Failed to boot server:', err);
    process.exit(1);
  }
};

startServer();

export { app, server, io };
