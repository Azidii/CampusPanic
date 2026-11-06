import express from 'express';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import mongoose from 'mongoose';

import { sameOrigin } from './middleware/browserSecurity.js';
import { requireAuth } from './middleware/auth.js';
import { config } from './config/config.js';
import { connectDB } from './config/db.js';
import { errorHandler } from './middleware/errorHandler.js';
import { startRetentionCleaner } from './utils/retentionCleaner.js';
import { User } from './models/User.js';
import phoneRoutes from './routes/phoneRoutes.js';
import liveRoutes from './routes/liveRoutes.js';
import espRoutes from './routes/espRoutes.js';
import mediaRoutes from './routes/mediaRoutes.js';
import audioRoutes from './routes/audioRoutes.js';
import { videoService } from './services/videoService.js';
import { audioService } from './services/audioService.js';

// Route Imports
import viewRoutes from './routes/viewRoutes.js';
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

// Template View Engine Setup
app.set('view engine', 'ejs');
app.set('views', path.resolve(__dirname, 'views'));

// Security Headers (configured to allow inline styles/Leaflet/scripts/CDNs)
app.use(
  helmet({
    contentSecurityPolicy: { directives: {
      scriptSrc: ["'self'", 'https://unpkg.com'],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com', 'https://unpkg.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      imgSrc: ["'self'", 'data:', 'blob:', 'https://*.basemaps.cartocdn.com', 'https://unpkg.com'],
      connectSrc: ["'self'"], upgradeInsecureRequests: null
    } },
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    crossOriginEmbedderPolicy: false
  })
);

app.use(
  cors({
    origin(origin, callback) { callback(null, !origin || origin === new URL(config.clientUrl).origin); },
    credentials: true
  })
);

// Camera JPEGs and Audio chunks use their own authentication, body limit and transmission limiters.
app.use(cookieParser());
app.use('/api/camera', phoneRoutes);
app.use('/api/audio', audioRoutes);
app.use('/media/nodes', mediaRoutes);

// Parsers
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));

// Static File Directories
app.use('/css', express.static(path.resolve(__dirname, 'css')));
app.use('/js', express.static(path.resolve(__dirname, 'js')));
app.use('/public', express.static(path.resolve(__dirname, 'public')));
app.use('/uploads', requireAuth, (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); }, express.static(path.resolve(__dirname, 'uploads')));

// General API Rate Limiter
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000,
  skip: req => req.method === 'GET' && ['/live', '/nodes', '/alerts', '/esp32/available', '/cameras', '/health'].includes(req.path),
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests, please try again later.' }
});
app.use('/api/', generalLimiter);
app.use('/api/', sameOrigin);
app.use('/api/auth/login', rateLimit({ windowMs: 15 * 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false }));

// API Health Check
app.get('/api/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    service: 'CampusPanic Alert Security Gateway',
    environment: config.env,
    database: mongoose.connection.name || null,
    workers: {
      video: { ready: videoService.ready, message: videoService.message },
      audio: { ready: audioService.ready, message: audioService.message }
    }
  });
});

// API Routes
app.use('/api/live', liveRoutes);
app.use('/api/esp32', espRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/nodes', nodeRoutes);
app.use('/api/alerts', alertRoutes);
app.use('/api/cameras', cameraRoutes);

// View Routes (SSR EJS Pages)
app.use('/', viewRoutes);

// 404 Handler
app.use((req, res) => {
  if (req.accepts('html')) {
    return res.status(404).render('404', {
      title: 'Page Not Found — CampusPanic',
      page: '404',
      user: res.locals.user || null
    });
  }
  res.status(404).json({ success: false, message: 'Resource not found' });
});

// Central Error Handler
app.use(errorHandler);

// Automatic Default Admin Check
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
    videoService.start();
    audioService.start();

    server.listen(config.port, process.env.HOST || '0.0.0.0', () => {
      console.log(`=======================================================`);
      console.log(` CampusPanic Web Console listening at http://localhost:${config.port}`);
      console.log(` Environment: ${config.env}`);
      console.log(` Ingest Endpoint: POST http://localhost:${config.port}/api/alerts/ingest`);
      console.log(`=======================================================`);
    });
  } catch (err) {
    console.error('[Startup Error] Failed to boot server:', err);
    process.exit(1);
  }
};

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) startServer();

let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  await Promise.allSettled([videoService.stop(), audioService.stop()]);
  server.close();
  process.exit(0);
}
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
export { app, server };
