import express from 'express';
import jwt from 'jsonwebtoken';
import { User } from '../models/User.js';
import { Node } from '../models/Node.js';
import { Alert } from '../models/Alert.js';
import { Camera } from '../models/Camera.js';
import { dashboardFeed, buildingFilter } from '../services/alertFeed.js';
import { config } from '../config/config.js';
import { requireViewAuth, requireViewAdmin } from '../middleware/auth.js';

import { videoService } from '../services/videoService.js';

const router = express.Router();

/**
 * Optional Auth middleware for login page
 * If already logged in, redirect to dashboard
 */
const redirectIfAuthenticated = async (req, res, next) => {
  const token = req.cookies ? req.cookies.token : null;
  if (!token) return next();

  try {
    const decoded = jwt.verify(token, config.jwtSecret);
    const user = await User.findById(decoded.id);
    if (user && user.isActive) {
      return res.redirect('/');
    }
  } catch (err) {
    // token invalid
  }
  next();
};

// 1. Login Page
router.get('/login', redirectIfAuthenticated, (req, res) => {
  res.render('login', {
    title: 'Security Console Login — CampusPanic',
    page: 'login',
    user: null,
    error: req.query.error || null
  });
});

// Logout Helper
router.get('/logout', (req, res) => {
  res.clearCookie('token');
  res.redirect('/login');
});

// 2. Main Dashboard
router.get('/', requireViewAuth, async (req, res, next) => {
  try {
    const feed = await dashboardFeed(req.user._id, req.query);
    const currentNodes = await videoService.describe(await Node.find(buildingFilter(req.query.building)).sort({ building: 1, room: 1 }));
    const { alerts, counts } = feed;
    const totalNodes = currentNodes.length;
    res.render('dashboard', {
      title: 'Operations Dashboard — CampusPanic',
      page: 'dashboard',
      feed,
      building: req.query.building || 'all',
      user: req.user,
      alerts,
      nodes: currentNodes,
      counts,
      totalNodes,
      activeNodesCount: currentNodes.filter(n => n.video?.cameraConnected || (!n.videoEnabled && n.status !== 'offline')).length
    });
  } catch (err) {
    next(err);
  }
});

// 3. Cam View & Verification Feed
router.get('/cam-view', requireViewAuth, async (req, res, next) => {
  try {
    const { nodeId, alertId } = req.query;

    const [nodes, cameras, latestAlerts] = await Promise.all([
      Node.find().sort({ building: 1, room: 1 }),
      Camera.find().sort({ label: 1 }),
      Alert.find({ imageUrl: { $ne: null } }).sort({ timestamp: -1 }).limit(20)
    ]);

    let selectedNode = null;
    let selectedAlert = null;

    if (alertId && !/^[a-f0-9]{24}$/i.test(alertId)) return res.status(400).send('Invalid incident link');
    if (alertId) {
      selectedAlert = await Alert.findById(alertId);
      if (selectedAlert) {
        selectedNode = await Node.findOne({ nodeId: selectedAlert.nodeId });
      }
    } else if (nodeId) {
      selectedNode = await Node.findOne({ nodeId });
    }

    if (!nodeId && !alertId && !selectedNode && !selectedAlert && nodes.length > 0) {
      selectedNode = nodes[0];
    }

    res.render('cam-view', {
      title: 'Camera & Threat Verification — CampusPanic',
      page: 'cam-view',
      user: req.user,
      nodes,
      cameras,
      latestAlerts,
      selectedNode,
      selectedAlert
    });
  } catch (err) {
    next(err);
  }
});

// 4. All Cameras CCTV Grid
router.get('/cameras', requireViewAuth, async (req, res, next) => {
  try {
    const nodes = await videoService.describe(await Node.find().sort({ building: 1, room: 1 }));
    res.render('all-cams', {
      title: 'CCTV Monitoring Room — CampusPanic',
      page: 'all-cams',
      user: req.user,
      nodes
    });
  } catch (err) {
    next(err);
  }
});

// 5. Campus Map View (All Nodes)
router.get('/map', requireViewAuth, async (req, res, next) => {
  try {
    const nodes = await videoService.describe(await Node.find().sort({ building: 1, room: 1 }));
    res.render('map-view', {
      title: 'Campus Node Map — CampusPanic',
      page: 'map-view',
      user: req.user,
      nodes
    });
  } catch (err) {
    next(err);
  }
});

// 6. Active Nodes Map (Emergency Hotspots Only)
router.get(['/active-threats-map', '/active-nodes-map'], requireViewAuth, async (req, res, next) => {
  try {
    const [activeNodes, activeAlerts] = await Promise.all([
      Node.find().sort({ building: 1, room: 1 }),
      Alert.find({ status: { $ne: 'resolved' } }).sort({ priority: 1, timestamp: -1 })
    ]);

    res.render('active-nodes-map', {
      title: 'Active Threats Campus Map — CampusPanic',
      page: 'active-nodes-map',
      user: req.user,
      activeNodes: await videoService.describe(activeNodes),
      activeAlerts
    });
  } catch (err) {
    next(err);
  }
});

// Security node setup. Preserve existing /streamer bookmarks.
router.get('/streamer', requireViewAuth, (req, res) => res.redirect('/security-nodes'));
router.get('/security-nodes', requireViewAuth, (req, res) => {
  res.render('security-nodes', {
    title: 'Security Nodes — CampusPanic', page: 'security-nodes', user: req.user
  });
});

router.get('/notifications', requireViewAuth, (req, res) => res.render('notifications', {
  title: 'Notifications — CampusPanic', page: 'notifications', user: req.user
}));

// 8. Profile View
router.get('/profile', requireViewAuth, (req, res) => {
  res.render('profile', {
    title: 'Operator Profile — CampusPanic',
    page: 'profile',
    user: req.user
  });
});

// 9. Settings View
router.get('/settings', requireViewAuth, (req, res) => {
  res.render('settings', {
    title: 'Console Settings — CampusPanic',
    page: 'settings',
    user: req.user
  });
});

// 10. Admin Users Management
router.get('/admin/users', requireViewAuth, requireViewAdmin, async (req, res, next) => {
  try {
    const users = await User.find().sort({ createdAt: -1 });
    res.render('admin-users', {
      title: 'User Administration — CampusPanic',
      page: 'admin-users',
      user: req.user,
      users
    });
  } catch (err) {
    next(err);
  }
});

export default router;
