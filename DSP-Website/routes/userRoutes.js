import express from 'express';
import { body, validationResult } from 'express-validator';
import { User } from '../models/User.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';

const router = express.Router();

router.use(requireAuth, requireAdmin);

router.get('/', async (req, res, next) => {
  try {
    const { search, role, status, building } = req.query;
    const query = {};

    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } }
      ];
    }

    if (role && role !== 'all') {
      query.role = role;
    }

    if (status && status !== 'all') {
      query.isActive = status === 'active';
    }

    if (building && building !== 'all') {
      query.assignedBuilding = building;
    }

    const users = await User.find(query).sort({ createdAt: -1 });

    return res.status(200).json({
      success: true,
      count: users.length,
      users
    });
  } catch (err) {
    next(err);
  }
});

router.post(
  '/',
  [
    body('name').trim().notEmpty().withMessage('Full name is required'),
    body('email').isEmail().withMessage('Valid email required').normalizeEmail(),
    body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
    body('role').optional().isIn(['admin', 'user']).withMessage('Role must be admin or user'),
    body('assignedBuilding').optional().trim()
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, errors: errors.array() });
      }

      const { name, email, password, role = 'user', assignedBuilding = 'All Campus Buildings' } = req.body;

      const existing = await User.findOne({ email });
      if (existing) {
        return res.status(409).json({ success: false, message: 'A user with this email already exists.' });
      }

      const passwordHash = await User.hashPassword(password);
      const user = await User.create({
        name,
        email,
        passwordHash,
        role,
        isActive: true,
        assignedBuilding
      });

      return res.status(201).json({
        success: true,
        message: 'User created successfully',
        user
      });
    } catch (err) {
      next(err);
    }
  }
);

router.put(
  '/:id',
  [
    body('name').optional().trim().notEmpty().withMessage('Name cannot be empty'),
    body('email').optional().isEmail().withMessage('Valid email required').normalizeEmail(),
    body('role').optional().isIn(['admin', 'user']).withMessage('Role must be admin or user'),
    body('isActive').optional().isBoolean().withMessage('isActive must be boolean'),
    body('assignedBuilding').optional().trim(),
    body('password').optional().isLength({ min: 6 }).withMessage('New password must be at least 6 characters')
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, errors: errors.array() });
      }

      const { id } = req.params;
      const { name, email, role, isActive, assignedBuilding, password } = req.body;

      const user = await User.findById(id);
      if (!user) {
        return res.status(404).json({ success: false, message: 'User not found' });
      }

      if (email && email !== user.email) {
        const existing = await User.findOne({ email });
        if (existing) {
          return res.status(409).json({ success: false, message: 'Email address already taken.' });
        }
        user.email = email;
      }

      if (name) user.name = name;
      if (role) user.role = role;
      if (typeof isActive === 'boolean') user.isActive = isActive;
      if (assignedBuilding !== undefined) user.assignedBuilding = assignedBuilding;
      if (password) {
        user.passwordHash = await User.hashPassword(password);
      }

      await user.save();

      return res.status(200).json({
        success: true,
        message: 'User updated successfully',
        user: await User.findById(id)
      });
    } catch (err) {
      next(err);
    }
  }
);

router.delete('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;

    if (req.user._id.toString() === id) {
      return res.status(400).json({
        success: false,
        message: 'Self-deletion prohibited. An administrator cannot delete their own account.'
      });
    }

    const user = await User.findById(id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    await User.findByIdAndDelete(id);

    return res.status(200).json({
      success: true,
      message: `User ${user.name} (${user.email}) has been permanently deleted.`
    });
  } catch (err) {
    next(err);
  }
});

export default router;
