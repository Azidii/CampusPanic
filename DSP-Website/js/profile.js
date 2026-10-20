/**
 * Profile Controller - profile.js
 */

document.addEventListener('DOMContentLoaded', () => {
  const profileForm = document.getElementById('profileDetailsForm');
  const passwordForm = document.getElementById('changePasswordForm');

  if (profileForm) {
    profileForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = document.getElementById('profileName').value.trim();
      const assignedBuilding = document.getElementById('profileBuilding').value.trim();

      try {
        const res = await fetch('/api/profile', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, assignedBuilding })
        });

        const data = await res.json();
        if (res.ok && data.success) {
          window.showToast('Profile information updated successfully', 'success');
        } else {
          window.showToast(data.message || 'Failed to update profile', 'error');
        }
      } catch (err) {
        window.showToast('Network error saving profile', 'error');
      }
    });
  }

  if (passwordForm) {
    passwordForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const currentPassword = document.getElementById('currentPassword').value;
      const newPassword = document.getElementById('newPassword').value;
      const confirmPassword = document.getElementById('confirmPassword').value;

      if (newPassword !== confirmPassword) {
        window.showToast('New passwords do not match', 'error');
        return;
      }

      if (newPassword.length < 6) {
        window.showToast('New password must be at least 6 characters', 'error');
        return;
      }

      try {
        const res = await fetch('/api/profile/password', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ currentPassword, newPassword })
        });

        const data = await res.json();
        if (res.ok && data.success) {
          window.showToast('Password changed successfully!', 'success');
          passwordForm.reset();
        } else {
          window.showToast(data.message || 'Error updating password', 'error');
        }
      } catch (err) {
        window.showToast('Network error updating password', 'error');
      }
    });
  }
});
