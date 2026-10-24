import express from 'express';
import { Camera } from '../models/Camera.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();
router.get('/', requireAuth, async (req, res, next) => {
  try { res.json({ success: true, cameras: await Camera.find().sort({ label: 1 }) }); }
  catch (error) { next(error); }
});
// Retired upload/registration routes cannot bypass node pairing.
router.use((req, res) => res.status(410).json({ success: false,
  message: 'Use Security Nodes to register cameras and the paired Android connection to upload frames.' }));
export default router;
