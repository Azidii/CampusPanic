import React, { useState, useEffect } from 'react';
import { api } from '../services/api';
import { UserTable } from '../components/admin/UserTable';
import { UserModal } from '../components/admin/UserModal';
import { Users, Shield, RefreshCw } from 'lucide-react';

export const AdminUsersPage = () => {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  const [alertBanner, setAlertBanner] = useState({ text: '', type: '' });

  const fetchUsers = async () => {
    try {
      setLoading(true);
      const res = await api.getUsers();
      if (res.success && res.users) {
        setUsers(res.users);
      }
    } catch (err) {
      setAlertBanner({ text: err.message || 'Failed to load user records.', type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  const handleAddNew = () => {
    setEditingUser(null);
    setModalOpen(true);
  };

  const handleEdit = (user) => {
    setEditingUser(user);
    setModalOpen(true);
  };

  const handleSaveUser = async (formData, userId) => {
    if (userId) {
      const res = await api.updateUser(userId, formData);
      if (res.success) {
        setAlertBanner({ text: `User ${res.user.name} was successfully updated.`, type: 'success' });
        await fetchUsers();
      }
    } else {
      const res = await api.createUser(formData);
      if (res.success) {
        setAlertBanner({ text: `User ${res.user.name} created successfully.`, type: 'success' });
        await fetchUsers();
      }
    }
  };

  const handleDeleteUser = async (userId) => {
    const res = await api.deleteUser(userId);
    if (res.success) {
      setAlertBanner({ text: res.message || 'User deleted successfully.', type: 'success' });
      await fetchUsers();
    }
  };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h1 style={{ fontSize: '1.6rem', fontWeight: 800, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '10px' }}>
            <Users size={24} color="#ef4444" />
            Security Personnel & Operator Management
          </h1>
          <p style={{ fontSize: '0.88rem', color: 'var(--text-muted)' }}>
            Admin console: Authorize security personnel, configure assigned buildings, and enforce access revocation.
          </p>
        </div>

        <button className="btn btn-outline btn-sm" onClick={fetchUsers} disabled={loading}>
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          <span>Refresh</span>
        </button>
      </div>

      {alertBanner.text && (
        <div
          style={{
            padding: '12px 16px',
            borderRadius: 'var(--radius-sm)',
            marginBottom: '20px',
            fontSize: '0.88rem',
            backgroundColor: alertBanner.type === 'success' ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)',
            color: alertBanner.type === 'success' ? '#34d399' : '#fca5a5',
            border: `1px solid ${alertBanner.type === 'success' ? '#10b981' : '#ef4444'}`
          }}
        >
          {alertBanner.text}
        </div>
      )}

      <UserTable
        users={users}
        onEdit={handleEdit}
        onDelete={handleDeleteUser}
        onAddNew={handleAddNew}
        loading={loading}
      />

      <UserModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        user={editingUser}
        onSave={handleSaveUser}
      />
    </div>
  );
};
