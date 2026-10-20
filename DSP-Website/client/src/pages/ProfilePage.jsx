import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { api } from '../services/api';
import { User, Lock, Save, ShieldCheck, Mail, Building, Key } from 'lucide-react';

export const ProfilePage = () => {
  const { user, updateUserProfile } = useAuth();

  // Profile Form State
  const [name, setName] = useState(user?.name || '');
  const [email, setEmail] = useState(user?.email || '');
  const [assignedBuilding, setAssignedBuilding] = useState(user?.assignedBuilding || '');
  const [profileMessage, setProfileMessage] = useState({ text: '', type: '' });
  const [savingProfile, setSavingProfile] = useState(false);

  // Password Form State
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordMessage, setPasswordMessage] = useState({ text: '', type: '' });
  const [savingPassword, setSavingPassword] = useState(false);

  const handleUpdateProfile = async (e) => {
    e.preventDefault();
    setProfileMessage({ text: '', type: '' });

    try {
      setSavingProfile(true);
      const res = await api.updateProfile({ name, email, assignedBuilding });
      if (res.success && res.user) {
        updateUserProfile(res.user);
        setProfileMessage({ text: 'Profile details updated successfully.', type: 'success' });
      }
    } catch (err) {
      setProfileMessage({ text: err.message || 'Failed to update profile.', type: 'error' });
    } finally {
      setSavingProfile(false);
    }
  };

  const handleChangePassword = async (e) => {
    e.preventDefault();
    setPasswordMessage({ text: '', type: '' });

    if (newPassword.length < 6) {
      setPasswordMessage({ text: 'New password must be at least 6 characters long.', type: 'error' });
      return;
    }

    if (newPassword !== confirmPassword) {
      setPasswordMessage({ text: 'New passwords do not match.', type: 'error' });
      return;
    }

    try {
      setSavingPassword(true);
      const res = await api.changePassword(currentPassword, newPassword);
      if (res.success) {
        setPasswordMessage({ text: 'Password successfully changed.', type: 'success' });
        setCurrentPassword('');
        setNewPassword('');
        setConfirmPassword('');
      }
    } catch (err) {
      setPasswordMessage({ text: err.message || 'Failed to change password.', type: 'error' });
    } finally {
      setSavingPassword(false);
    }
  };

  return (
    <div style={{ maxWidth: '900px', margin: '0 auto' }}>
      <div style={{ marginBottom: '24px' }}>
        <h1 style={{ fontSize: '1.6rem', fontWeight: 800, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '10px' }}>
          <User size={24} color="#38bdf8" />
          Operator Profile & Security Credentials
        </h1>
        <p style={{ fontSize: '0.88rem', color: 'var(--text-muted)' }}>
          Manage your operator identity, contact email, assigned campus jurisdiction, and console credentials.
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))', gap: '24px' }}>
        {/* Profile Details Card */}
        <div className="card">
          <div className="card-header">
            <h3 className="card-title">
              <User size={18} color="#38bdf8" />
              General Profile Information
            </h3>
          </div>

          {profileMessage.text && (
            <div
              style={{
                padding: '10px 14px',
                borderRadius: 'var(--radius-sm)',
                marginBottom: '16px',
                fontSize: '0.84rem',
                backgroundColor: profileMessage.type === 'success' ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                color: profileMessage.type === 'success' ? '#34d399' : '#f87171',
                border: `1px solid ${profileMessage.type === 'success' ? '#10b981' : '#ef4444'}`
              }}
            >
              {profileMessage.text}
            </div>
          )}

          <form onSubmit={handleUpdateProfile}>
            <div className="form-group">
              <label className="form-label">Full Name</label>
              <div style={{ position: 'relative' }}>
                <User size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                <input
                  type="text"
                  className="form-input"
                  style={{ paddingLeft: '38px' }}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                />
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">Email Address</label>
              <div style={{ position: 'relative' }}>
                <Mail size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                <input
                  type="email"
                  className="form-input"
                  style={{ paddingLeft: '38px' }}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">Assigned Campus Building</label>
              <div style={{ position: 'relative' }}>
                <Building size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                <input
                  type="text"
                  className="form-input"
                  style={{ paddingLeft: '38px' }}
                  value={assignedBuilding}
                  onChange={(e) => setAssignedBuilding(e.target.value)}
                  placeholder="e.g. Science Complex"
                />
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">Station Role</label>
              <input
                type="text"
                className="form-input"
                value={user?.role?.toUpperCase()}
                disabled
                style={{ opacity: 0.7, background: 'var(--bg-surface-active)' }}
              />
            </div>

            <button type="submit" className="btn btn-primary" disabled={savingProfile} style={{ marginTop: '8px' }}>
              <Save size={16} />
              <span>{savingProfile ? 'Saving...' : 'Update Profile'}</span>
            </button>
          </form>
        </div>

        {/* Change Password Card */}
        <div className="card">
          <div className="card-header">
            <h3 className="card-title">
              <Key size={18} color="#f59e0b" />
              Change Console Password
            </h3>
          </div>

          {passwordMessage.text && (
            <div
              style={{
                padding: '10px 14px',
                borderRadius: 'var(--radius-sm)',
                marginBottom: '16px',
                fontSize: '0.84rem',
                backgroundColor: passwordMessage.type === 'success' ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                color: passwordMessage.type === 'success' ? '#34d399' : '#f87171',
                border: `1px solid ${passwordMessage.type === 'success' ? '#10b981' : '#ef4444'}`
              }}
            >
              {passwordMessage.text}
            </div>
          )}

          <form onSubmit={handleChangePassword}>
            <div className="form-group">
              <label className="form-label">Current Password</label>
              <div style={{ position: 'relative' }}>
                <Lock size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                <input
                  type="password"
                  className="form-input"
                  style={{ paddingLeft: '38px' }}
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  placeholder="Enter current password"
                  required
                />
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">New Password</label>
              <div style={{ position: 'relative' }}>
                <Key size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                <input
                  type="password"
                  className="form-input"
                  style={{ paddingLeft: '38px' }}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Minimum 6 characters"
                  required
                  minLength={6}
                />
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">Confirm New Password</label>
              <div style={{ position: 'relative' }}>
                <Key size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                <input
                  type="password"
                  className="form-input"
                  style={{ paddingLeft: '38px' }}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Re-enter new password"
                  required
                  minLength={6}
                />
              </div>
            </div>

            <button type="submit" className="btn btn-warning" disabled={savingPassword} style={{ marginTop: '8px' }}>
              <ShieldCheck size={16} />
              <span>{savingPassword ? 'Changing Password...' : 'Update Password'}</span>
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};
