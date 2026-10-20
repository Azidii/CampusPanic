import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { Modal } from '../common/Modal';
import {
  Search,
  Filter,
  UserPlus,
  Edit2,
  Trash2,
  Shield,
  User,
  CheckCircle2,
  XCircle,
  AlertTriangle
} from 'lucide-react';

export const UserTable = ({ users, onEdit, onDelete, onAddNew, loading }) => {
  const { user: currentAdmin } = useAuth();
  const [searchTerm, setSearchTerm] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');

  // Delete Confirmation State
  const [userToDelete, setUserToDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  // Filter users client-side
  const filteredUsers = users.filter((u) => {
    const matchesSearch =
      u.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      u.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (u.assignedBuilding && u.assignedBuilding.toLowerCase().includes(searchTerm.toLowerCase()));

    const matchesRole = roleFilter === 'all' || u.role === roleFilter;
    const matchesStatus =
      statusFilter === 'all' ||
      (statusFilter === 'active' && u.isActive) ||
      (statusFilter === 'disabled' && !u.isActive);

    return matchesSearch && matchesRole && matchesStatus;
  });

  const handleDeleteConfirm = async () => {
    if (!userToDelete) return;
    try {
      setDeleting(true);
      setDeleteError('');
      await onDelete(userToDelete._id);
      setUserToDelete(null);
    } catch (err) {
      setDeleteError(err.message || 'Failed to delete user.');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div>
      {/* Search and Filters Toolbar */}
      <div
        className="card"
        style={{
          padding: '16px 20px',
          marginBottom: '20px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '12px'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1, minWidth: '280px', maxWidth: '600px' }}>
          <div style={{ position: 'relative', width: '100%' }}>
            <Search
              size={16}
              style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }}
            />
            <input
              type="text"
              className="form-input"
              style={{ paddingLeft: '36px', fontSize: '0.88rem' }}
              placeholder="Search by name, email, or building..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>

          <select
            className="form-select"
            style={{ width: 'auto', fontSize: '0.84rem' }}
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
          >
            <option value="all">All Roles</option>
            <option value="admin">Administrators</option>
            <option value="user">Security Users</option>
          </select>

          <select
            className="form-select"
            style={{ width: 'auto', fontSize: '0.84rem' }}
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="all">All Statuses</option>
            <option value="active">Active Accounts</option>
            <option value="disabled">Disabled Accounts</option>
          </select>
        </div>

        <button className="btn btn-primary" onClick={onAddNew}>
          <UserPlus size={16} />
          <span>Add New User</span>
        </button>
      </div>

      {/* Users Data Table */}
      <div className="table-container card" style={{ padding: 0 }}>
        <table className="data-table">
          <thead>
            <tr>
              <th>User Name & Email</th>
              <th>System Role</th>
              <th>Account Status</th>
              <th>Assigned Building</th>
              <th>Member Since</th>
              <th style={{ textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredUsers.length === 0 ? (
              <tr>
                <td colSpan="6" style={{ textAlign: 'center', padding: '36px', color: 'var(--text-muted)' }}>
                  No users found matching your search.
                </td>
              </tr>
            ) : (
              filteredUsers.map((u) => {
                const isSelf = currentAdmin?._id === u._id;
                return (
                  <tr key={u._id}>
                    <td>
                      <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                        {u.name} {isSelf && <span style={{ fontSize: '0.72rem', color: '#38bdf8' }}>(You)</span>}
                      </div>
                      <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{u.email}</div>
                    </td>
                    <td>
                      <span
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '5px',
                          fontSize: '0.75rem',
                          fontWeight: 700,
                          textTransform: 'uppercase',
                          fontFamily: 'var(--font-mono)',
                          padding: '3px 8px',
                          borderRadius: '4px',
                          backgroundColor: u.role === 'admin' ? 'rgba(239, 68, 68, 0.15)' : 'rgba(59, 130, 246, 0.15)',
                          color: u.role === 'admin' ? '#f87171' : '#60a5fa'
                        }}
                      >
                        {u.role === 'admin' ? <Shield size={12} /> : <User size={12} />}
                        {u.role}
                      </span>
                    </td>
                    <td>
                      {u.isActive ? (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', color: '#10b981', fontSize: '0.8rem', fontWeight: 600 }}>
                          <CheckCircle2 size={14} /> Active
                        </span>
                      ) : (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', color: '#ef4444', fontSize: '0.8rem', fontWeight: 600 }}>
                          <XCircle size={14} /> Disabled
                        </span>
                      )}
                    </td>
                    <td style={{ color: 'var(--text-secondary)' }}>{u.assignedBuilding || 'All Buildings'}</td>
                    <td style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                      {new Date(u.createdAt).toLocaleDateString()}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <div style={{ display: 'inline-flex', gap: '6px' }}>
                        <button
                          className="btn btn-outline btn-sm"
                          onClick={() => onEdit(u)}
                          title="Edit User Details / Role / Password"
                        >
                          <Edit2 size={14} />
                        </button>
                        <button
                          className="btn btn-outline btn-sm"
                          onClick={() => setUserToDelete(u)}
                          disabled={isSelf}
                          title={isSelf ? 'Cannot delete your own account' : 'Delete user'}
                          style={{
                            color: isSelf ? 'var(--text-muted)' : '#ef4444',
                            cursor: isSelf ? 'not-allowed' : 'pointer'
                          }}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Delete Confirmation Modal */}
      {userToDelete && (
        <Modal
          isOpen={Boolean(userToDelete)}
          onClose={() => setUserToDelete(null)}
          title="Confirm User Deletion"
          maxWidth="460px"
          footer={
            <div style={{ display: 'flex', gap: '10px' }}>
              <button className="btn btn-outline" onClick={() => setUserToDelete(null)} disabled={deleting}>
                Cancel
              </button>
              <button className="btn btn-danger" onClick={handleDeleteConfirm} disabled={deleting}>
                {deleting ? 'Deleting...' : 'Delete User'}
              </button>
            </div>
          }
        >
          <div style={{ textAlign: 'center', padding: '10px 0' }}>
            <AlertTriangle size={42} color="#ef4444" style={{ margin: '0 auto 12px' }} />
            <h4 style={{ marginBottom: '8px', color: 'var(--text-primary)' }}>
              Are you sure you want to delete {userToDelete.name}?
            </h4>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
              This will permanently revoke access for <strong>{userToDelete.email}</strong>. This action cannot be undone.
            </p>
            {deleteError && (
              <div style={{ marginTop: '12px', color: '#ef4444', fontSize: '0.84rem' }}>
                {deleteError}
              </div>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
};
