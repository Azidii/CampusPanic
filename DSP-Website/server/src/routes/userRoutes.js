import express from 'express';
import { body, validationResult } from 'express-validator';
import { User } from '../models/User.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';

const router = express.Router();

// Apply auth & admin guard to all user management routes
router.use(requireAuth, requireAdmin);

/**
 * GET /api/users
 * Searchable, filterable list of users
 */
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

/**
 * POST /api/users
 * Create a new user (admin only)
 */
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

      const { name, email, password, role = 'user', assignedBuilding } = req.body;

      const existing = await User.findOne({ email });
      if (existing) {
        return res.status(409).json({ success: false, message: 'Email address is already in use.' });
      }

      const passwordHash = await User.hashPassword(password);
      const newUser = await User.create({
        name,
        email,
        passwordHash,
        role,
        isActive: true,
        assignedBuilding: assignedBuilding || 'All Campus Buildings'
      });

      return res.status(201).json({
        success: true,
        message: 'User created successfully',
        user: newUser
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * PUT /api/users/:id
 * Edit user details, role, status, or reset password
 */
router.put(
  '/:id',
  [
    body('name').optional().trim().notEmpty(),
    body('email').optional().isEmail().normalizeEmail(),
    body('role').optional().isIn(['admin', 'user']),
    body('isActive').optional().isBoolean(),
    body('assignedBuilding').optional().trim(),
    body('password').optional().isLength({ min: 6 }).withMessage('New password must be at least 6 characters')
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, errors: errors.array() });
      }

      const user = await User.findById(req.params.id);
      if (!user) {
        return res.status(404).json({ success: false, message: 'User not found' });
      }

      const { name, email, role, isActive, assignedBuilding, password } = req.body;

      // Prevent admin from deactivating themselves or removing their own admin status
      if (user._id.toString() === req.user._id.toString()) {
        if (isActive === false) {
          return res.status(400).json({ success: false, message: 'Administrators cannot deactivate their own account.' });
        }
        if (role && role !== 'admin') {
          return res.status(400).json({ success: false, message: 'Administrators cannot demote themselves.' });
        }
      }

      if (name) user.name = name;
      if (email) {
        // Check uniqueness if email changed
        if (email !== user.email) {
          const emailExists = await User.findOne({ email });
          if (emailExists) {
            return res.status(409).json({ success: false, message: 'Email address already in use.' });
          }
        }
        user.email = email;
      }
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
        user: await User.findById(user._id)
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * DELETE /api/users/:id
 * Delete user (an admin cannot delete themselves)
 */
router.delete('/:id', async (req, res, next) => {
  try {
    const userToDelete = await User.findById(req.params.id);
    if (!userToDelete) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    if (userToDelete._id.toString() === req.user._id.toString()) {
      return res.status(400).json({
        success: false,
        message: 'Security protection: You cannot delete your own administrator account.'
      });
    }

    await User.findByIdAndDelete(req.params.id);

    return res.status(200).json({
      success: true,
      message: `User ${userToDelete.name} (${userToDelete.email}) was removed successfully.`
    });
  } catch (err) {
    next(err);
  }
});

export default router;
