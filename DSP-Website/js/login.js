/**
 * Login Page Controller - login.js
 */

document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('loginForm');
  const errorBox = document.getElementById('loginErrorBox');
  const errorMsg = document.getElementById('loginErrorMsg');
  const submitBtn = document.getElementById('loginSubmitBtn');

  // Quick fill demo buttons
  const demoAdminBtn = document.getElementById('demoAdminBtn');
  const demoGuardBtn = document.getElementById('demoGuardBtn');

  if (demoAdminBtn) {
    demoAdminBtn.addEventListener('click', () => {
      document.getElementById('email').value = 'admin@campuspanic.edu';
      document.getElementById('password').value = 'Admin123!';
    });
  }

  if (demoGuardBtn) {
    demoGuardBtn.addEventListener('click', () => {
      document.getElementById('email').value = 'guard@campuspanic.edu';
      document.getElementById('password').value = 'Guard123!';
    });
  }

  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (errorBox) errorBox.style.display = 'none';

      const email = document.getElementById('email').value.trim();
      const password = document.getElementById('password').value;

      if (!email || !password) {
        showError('Please enter both email address and password.');
        return;
      }

      submitBtn.disabled = true;
      submitBtn.textContent = 'Authenticating...';

      try {
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password })
        });

        const data = await res.json();

        if (res.ok && data.success) {
          window.location.href = '/';
        } else {
          showError(data.message || (data.errors && data.errors[0]?.msg) || 'Authentication failed');
          submitBtn.disabled = false;
          submitBtn.textContent = 'Sign In to Operations Console';
        }
      } catch (err) {
        showError('Unable to connect to security gateway. Ensure server is online.');
        submitBtn.disabled = false;
        submitBtn.textContent = 'Sign In to Operations Console';
      }
    });
  }

  function showError(msg) {
    if (errorBox && errorMsg) {
      errorMsg.textContent = msg;
      errorBox.style.display = 'flex';
    } else {
      alert(msg);
    }
  }
});
