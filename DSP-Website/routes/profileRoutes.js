import express from 'express';
import { body, validationResult } from 'express-validator';
import { User } from '../models/User.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();

router.use(requireAuth);

router.put(
  '/',
  [
    body('name').optional().trim().notEmpty().withMessage('Name cannot be empty'),
    body('email').optional().isEmail().withMessage('Valid email required').normalizeEmail(),
    body('assignedBuilding').optional().trim()
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, errors: errors.array() });
      }

      const { name, email, assignedBuilding } = req.body;
      const user = await User.findById(req.user._id);

      if (!user) {
        return res.status(404).json({ success: false, message: 'User not found' });
      }

      if (email && email !== user.email) {
        const existing = await User.findOne({ email });
        if (existing) {
          return res.status(409).json({ success: false, message: 'Email address already in use by another account.' });
        }
        user.email = email;
      }

      if (name) user.name = name;
      if (assignedBuilding !== undefined) user.assignedBuilding = assignedBuilding;

      await user.save();

      return res.status(200).json({
        success: true,
        message: 'Profile updated successfully',
        user: await User.findById(user._id)
      });
    } catch (err) {
      next(err);
    }
  }
);

router.put(
  '/password',
  [
    body('currentPassword').notEmpty().withMessage('Current password is required'),
    body('newPassword').isLength({ min: 6 }).withMessage('New password must be at least 6 characters')
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, errors: errors.array() });
      }

      const { currentPassword, newPassword } = req.body;
      const user = await User.findById(req.user._id).select('+passwordHash');

      if (!user) {
        return res.status(404).json({ success: false, message: 'User not found' });
      }

      const isMatch = await user.comparePassword(currentPassword);
      if (!isMatch) {
        return res.status(400).json({ success: false, message: 'Current password does not match.' });
      }

      user.passwordHash = await User.hashPassword(newPassword);
      await user.save();

      return res.status(200).json({
        success: true,
        message: 'Password changed successfully'
      });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
