import express from 'express';
import { Camera } from '../models/Camera.js';
import { Node } from '../models/Node.js';
import { buildingFilter } from '../services/alertFeed.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const scope = buildingFilter(req.query.building);
    const [cameras, nodes] = await Promise.all([Camera.find().sort({ label: 1 }).lean(), Node.find().select('nodeId name building room').lean()]);
    const current = new Map(nodes.map(node => [node.nodeId, node]));
    const rows = cameras.map(camera => {
      const node = current.get(camera.nodeId);
      return node ? {...camera, label:node.name || node.nodeId, building:node.building, room:node.room} : camera;
    }).filter(camera => !scope.building || camera.building === scope.building);
    res.set('Cache-Control', 'no-store').json({success:true,cameras:rows});
  }
  catch (error) { next(error); }
});
// Retired upload/registration routes cannot bypass node pairing.
router.use((req, res) => res.status(410).json({ success: false,
  message: 'Use Security Nodes to register cameras and the paired Android connection to upload frames.' }));
export default router;
