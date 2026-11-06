/**
 * CampusPanic Common Client Script - common.js
 * Theme Controller, Sound Synthesizer, Toast Notifications & HTTP Updates
 */

// 1. Theme Controller
(function initTheme() {
  const savedTheme = localStorage.getItem('cp_theme') || 'dark';
  document.documentElement.setAttribute('data-theme', savedTheme);
})();

window.setTheme = function (theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('cp_theme', theme);
  document.querySelectorAll('.theme-card').forEach((card) => {
    card.classList.toggle('active', card.dataset.themeVal === theme);
  });
};

// 2. Audio Synthesizer for Emergency Alarm (Web Audio API)
class EmergencyAlarmSound {
  constructor() {
    this.ctx = null;
    this.isPlaying = false;
  }

  initCtx() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) this.ctx = new AudioCtx();
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  playAlarm(durationMs = 2000) {
    const isSoundEnabled = localStorage.getItem('cp_sound_enabled') !== 'false';
    if (!isSoundEnabled) return;

    try {
      this.initCtx();
      if (!this.ctx) return;

      const volumeLevel = parseFloat(localStorage.getItem('cp_sound_volume') || '0.8');
      const now = this.ctx.currentTime;

      // Two-tone warble emergency siren
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(800, now);
      osc.frequency.linearRampToValueAtTime(1100, now + 0.3);
      osc.frequency.linearRampToValueAtTime(800, now + 0.6);
      osc.frequency.linearRampToValueAtTime(1100, now + 0.9);
      osc.frequency.linearRampToValueAtTime(800, now + 1.2);
      osc.frequency.linearRampToValueAtTime(1100, now + 1.5);

      gain.gain.setValueAtTime(volumeLevel * 0.4, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + (durationMs / 1000));

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(now);
      osc.stop(now + (durationMs / 1000));
    } catch (e) {
      console.warn('Web Audio synthesis failed:', e);
    }
  }
}

window.alarmSound = new EmergencyAlarmSound();

// 3. Toast Notifications
window.showToast = function (message, type = 'info', duration = 4000) {
  let container = document.getElementById('toastContainer');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toastContainer';
    container.className = 'toast-container';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `
    <div style="flex: 1;">
      <div style="font-weight: 700; margin-bottom: 2px;">${type === 'error' ? 'ALERT' : type === 'success' ? 'SYSTEM' : 'NOTICE'}</div>
      <div class="toast-message"></div>
    </div>
    <button onclick="this.parentElement.remove()" style="background: none; border: none; color: var(--text-muted); cursor: pointer; font-size: 1.1rem;">&times;</button>
  `;

  toast.querySelector('.toast-message').textContent = message;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.transition = 'opacity 0.25s ease-out, transform 0.25s ease-out';
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(30px)';
    setTimeout(() => toast.remove(), 250);
  }, duration);
};

// HTTP snapshots replace the former real-time transport.
window.escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[c]));
window.selectedBuilding = () => {
  const value = new URLSearchParams(window.location.search).get('building') || 'all';
  return ['all', 'RSY', 'RG Birrey'].includes(value) ? value : 'all';
};
window.filterBuilding = rows => rows.filter(row => window.selectedBuilding() === 'all' || row.building === window.selectedBuilding());
window.isLegacyBuilding = value => !['RSY', 'RG Birrey'].includes(value);
window.refreshCampus = async function () {
  if (window.campusRefreshing || document.hidden || document.body.classList.contains('page-login')) return;
  window.campusRefreshing = true;
  try {
    const requestedSearch = window.location.search;
    const query = document.body.classList.contains('page-dashboard') ? new URLSearchParams(requestedSearch) : new URLSearchParams();
    if (document.body.classList.contains('page-dashboard')) query.set('dashboard', 'true');
    const response = await fetch('/api/live?' + query, { cache: 'no-store', signal: AbortSignal.timeout(8000) });
    if (response.status === 401 || response.status === 403) { window.location.href = '/login'; return; }
    if (!response.ok) throw new Error('Update unavailable');
    const state = await response.json();
    if (requestedSearch !== window.location.search) return;
    window.campusState = state;
    window.dispatchEvent(new CustomEvent('campus:state', { detail: window.campusState }));
  } catch {
    window.dispatchEvent(new CustomEvent('campus:offline'));
  } finally { window.campusRefreshing = false; }
};
document.addEventListener('DOMContentLoaded', () => {
  const building = document.getElementById('buildingFilter');
  if (building) {
    building.value = window.selectedBuilding();
    building.addEventListener('change', () => {
      const url = new URL(window.location.href);
      url.searchParams.set('building', building.value); url.searchParams.delete('historyPage');
      window.history.replaceState(null, '', url);
      window.refreshCampus();
    });
  }
  document.getElementById('quickAlarmToggleBtn')?.addEventListener('click', () => window.alarmSound?.playAlarm(2000));
  window.refreshCampus();
  setInterval(window.refreshCampus, 2000);
});
document.addEventListener('visibilitychange', () => { if (!document.hidden) window.refreshCampus(); });

// Sidebar badge: number of unresolved incidents (hidden when there are none).
window.addEventListener('campus:state', ({ detail }) => {
  const badge = document.getElementById('sidebarThreatCount');
  if (!badge) return;
  const open = Number(detail?.counts?.unresolved) || 0;
  badge.textContent = open;
  badge.hidden = open === 0;
});

// 5. Live Clock Updater & Mobile Drawer
document.addEventListener('DOMContentLoaded', () => {
  const clockEl = document.getElementById('liveClock');
  if (clockEl) {
    const updateTime = () => {
      const d = new Date();
      clockEl.textContent = d.toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    };
    updateTime();
    setInterval(updateTime, 1000);
  }

  const mobileToggle = document.getElementById('mobileNavToggle');
  const sidebar = document.getElementById('appSidebar');
  if (mobileToggle && sidebar) {
    mobileToggle.addEventListener('click', () => {
      sidebar.classList.toggle('open');
    });
  }
});
