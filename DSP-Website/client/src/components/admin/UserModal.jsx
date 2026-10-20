import React, { useState, useEffect } from 'react';
import { Modal } from '../common/Modal';

export const UserModal = ({ isOpen, onClose, user, onSave }) => {
  const isEditing = Boolean(user);

  const [formData, setFormData] = useState({
    name: '',
    email: '',
    password: '',
    role: 'user',
    isActive: true,
    assignedBuilding: 'All Campus Buildings'
  });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (user) {
      setFormData({
        name: user.name || '',
        email: user.email || '',
        password: '', // Blank unless admin wants to reset password
        role: user.role || 'user',
        isActive: user.isActive !== undefined ? user.isActive : true,
        assignedBuilding: user.assignedBuilding || 'All Campus Buildings'
      });
    } else {
      setFormData({
        name: '',
        email: '',
        password: '',
        role: 'user',
        isActive: true,
        assignedBuilding: 'All Campus Buildings'
      });
    }
    setError('');
  }, [user, isOpen]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!formData.name.trim()) {
      setError('Full name is required.');
      return;
    }

    if (!formData.email.trim()) {
      setError('Email address is required.');
      return;
    }

    if (!isEditing && (!formData.password || formData.password.length < 6)) {
      setError('Password must be at least 6 characters.');
      return;
    }

    if (isEditing && formData.password && formData.password.length < 6) {
      setError('New password must be at least 6 characters.');
      return;
    }

    try {
      setSaving(true);
      const payload = { ...formData };
      if (isEditing && !payload.password) {
        delete payload.password; // Do not send blank password if not resetting
      }
      await onSave(payload, user?._id);
      onClose();
    } catch (err) {
      setError(err.message || 'Failed to save user.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={isEditing ? `Edit User — ${user.name}` : 'Add New Campus Security User'}
      maxWidth="550px"
      footer={
        <div style={{ display: 'flex', gap: '10px' }}>
          <button type="button" className="btn btn-outline" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button type="submit" form="user-form" className="btn btn-primary" disabled={saving}>
            {saving ? 'Saving...' : isEditing ? 'Save Changes' : 'Create User'}
          </button>
        </div>
      }
    >
      <form id="user-form" onSubmit={handleSubmit}>
        {error && (
          <div
            style={{
              padding: '10px 14px',
              backgroundColor: 'rgba(239, 68, 68, 0.15)',
              border: '1px solid #ef4444',
              borderRadius: 'var(--radius-sm)',
              color: '#f87171',
              fontSize: '0.84rem',
              marginBottom: '16px'
            }}
          >
            {error}
          </div>
        )}

        <div className="form-group">
          <label className="form-label">Full Name *</label>
          <input
            type="text"
            className="form-input"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            placeholder="e.g. Officer Maria Santos"
            required
          />
        </div>

        <div className="form-group">
          <label className="form-label">Email Address *</label>
          <input
            type="email"
            className="form-input"
            value={formData.email}
            onChange={(e) => setFormData({ ...formData, email: e.target.value })}
            placeholder="e.g. santos@campuspanic.edu"
            required
          />
        </div>

        <div className="form-group">
          <label className="form-label">
            {isEditing ? 'Reset Password (Leave blank to keep current)' : 'Password *'}
          </label>
          <input
            type="password"
            className="form-input"
            value={formData.password}
            onChange={(e) => setFormData({ ...formData, password: e.target.value })}
            placeholder={isEditing ? 'Enter new password' : 'At least 6 characters'}
            minLength={isEditing ? 0 : 6}
            required={!isEditing}
          />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
          <div className="form-group">
            <label className="form-label">System Role *</label>
            <select
              className="form-select"
              value={formData.role}
              onChange={(e) => setFormData({ ...formData, role: e.target.value })}
            >
              <option value="user">User (Security Guard / Monitor)</option>
              <option value="admin">Administrator (Full Access)</option>
            </select>
          </div>

          <div className="form-group">
            <label className="form-label">Assigned Building</label>
            <input
              type="text"
              className="form-input"
              value={formData.assignedBuilding}
              onChange={(e) => setFormData({ ...formData, assignedBuilding: e.target.value })}
              placeholder="e.g. Science Complex"
            />
          </div>
        </div>

        {isEditing && (
          <div className="form-group" style={{ marginTop: '8px' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '0.88rem' }}>
              <input
                type="checkbox"
                checked={formData.isActive}
                onChange={(e) => setFormData({ ...formData, isActive: e.target.checked })}
              />
              <span>Account Active (Uncheck to disable user login)</span>
            </label>
          </div>
        )}
      </form>
    </Modal>
  );
};
