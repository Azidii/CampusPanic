/**
 * Admin User Management Controller - admin-users.js
 */

document.addEventListener('DOMContentLoaded', () => {
  const searchInput = document.getElementById('userSearchInput');
  const roleFilter = document.getElementById('userRoleFilter');
  const statusFilter = document.getElementById('userStatusFilter');

  const addModal = document.getElementById('addUserModal');
  const editModal = document.getElementById('editUserModal');
  const openAddBtn = document.getElementById('openAddUserModalBtn');

  // 1. Filter and Search
  function filterUsers() {
    const query = (searchInput?.value || '').toLowerCase().trim();
    const role = roleFilter?.value || 'all';
    const status = statusFilter?.value || 'all';

    document.querySelectorAll('.user-row').forEach((row) => {
      const text = row.textContent.toLowerCase();
      const userRole = row.dataset.role;
      const userStatus = row.dataset.status;

      const matchSearch = !query || text.includes(query);
      const matchRole = role === 'all' || userRole === role;
      const matchStatus = status === 'all' || userStatus === status;

      row.style.display = matchSearch && matchRole && matchStatus ? '' : 'none';
    });
  }

  if (searchInput) searchInput.addEventListener('input', filterUsers);
  if (roleFilter) roleFilter.addEventListener('change', filterUsers);
  if (statusFilter) statusFilter.addEventListener('change', filterUsers);

  // 2. Open Add User Modal
  if (openAddBtn && addModal) {
    openAddBtn.addEventListener('click', () => {
      addModal.classList.add('active');
    });
  }

  // Close modals
  document.querySelectorAll('.modal-close-trigger').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (addModal) addModal.classList.remove('active');
      if (editModal) editModal.classList.remove('active');
    });
  });

  // 3. Add User Form Submit
  const addUserForm = document.getElementById('addUserForm');
  if (addUserForm) {
    addUserForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = document.getElementById('addName').value.trim();
      const email = document.getElementById('addEmail').value.trim();
      const password = document.getElementById('addPassword').value;
      const role = document.getElementById('addRole').value;
      const assignedBuilding = document.getElementById('addBuilding').value.trim();

      try {
        const res = await fetch('/api/users', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, email, password, role, assignedBuilding })
        });

        const data = await res.json();
        if (res.ok && data.success) {
          window.showToast(`User ${name} created successfully!`, 'success');
          addModal.classList.remove('active');
          setTimeout(() => window.location.reload(), 800);
        } else {
          window.showToast(data.message || 'Error creating user', 'error');
        }
      } catch (err) {
        window.showToast('Network error creating user', 'error');
      }
    });
  }

  // 4. Edit User & Delete User delegation
  document.addEventListener('click', async (e) => {
    const editBtn = e.target.closest('.open-edit-user-btn');
    const deleteBtn = e.target.closest('.delete-user-btn');

    if (editBtn) {
      // Opening a different account must not carry over a pending password reset.
      document.getElementById('editUserForm')?.reset();
      const id = editBtn.dataset.id;
      const name = editBtn.dataset.name;
      const email = editBtn.dataset.email;
      const role = editBtn.dataset.role;
      const building = editBtn.dataset.building;
      const active = editBtn.dataset.active === 'true';

      document.getElementById('editUserId').value = id;
      document.getElementById('editName').value = name;
      document.getElementById('editEmail').value = email;
      document.getElementById('editRole').value = role;
      document.getElementById('editBuilding').value = building;
      document.getElementById('editActive').checked = active;

      if (editModal) editModal.classList.add('active');
    }

    if (deleteBtn) {
      const id = deleteBtn.dataset.id;
      const name = deleteBtn.dataset.name;

      if (confirm(`Are you sure you want to delete user "${name}"? This action cannot be undone.`)) {
        try {
          const res = await fetch(`/api/users/${id}`, { method: 'DELETE' });
          const data = await res.json();
          if (res.ok && data.success) {
            window.showToast(data.message, 'success');
            const row = document.getElementById(`user-row-${id}`);
            if (row) row.remove();
          } else {
            window.showToast(data.message || 'Cannot delete user', 'error');
          }
        } catch (err) {
          window.showToast('Network error deleting user', 'error');
        }
      }
    }
  });

  // Edit User Form Submit
  const editUserForm = document.getElementById('editUserForm');
  if (editUserForm) {
    editUserForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const id = document.getElementById('editUserId').value;
      const name = document.getElementById('editName').value.trim();
      const email = document.getElementById('editEmail').value.trim();
      const role = document.getElementById('editRole').value;
      const assignedBuilding = document.getElementById('editBuilding').value.trim();
      const isActive = document.getElementById('editActive').checked;
      const password = document.getElementById('editPassword').value;

      const payload = { name, email, role, assignedBuilding, isActive };
      if (password) payload.password = password;

      try {
        const res = await fetch(`/api/users/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        const data = await res.json();
        if (res.ok && data.success) {
          window.showToast(`User ${name} updated successfully!`, 'success');
          editModal.classList.remove('active');
          setTimeout(() => window.location.reload(), 800);
        } else {
          window.showToast(data.message || 'Error updating user', 'error');
        }
      } catch (err) {
        window.showToast('Network error updating user', 'error');
      }
    });
  }
});
