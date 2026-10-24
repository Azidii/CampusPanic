/**
 * Operations Dashboard Controller - dashboard.js
 * Real-time Emergency Feed, Priority Alerting & Incident Workflow
 */

document.addEventListener('DOMContentLoaded', () => {
  const alertList = document.getElementById('alertFeedList');
  let currentFilterType = 'all';
  let currentFilterStatus = 'all';
  let searchQuery = '';

  // 1. Filter Chips
  document.querySelectorAll('.filter-type-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-type-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      currentFilterType = btn.dataset.type;
      applyFilters();
    });
  });

  document.querySelectorAll('.filter-status-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-status-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      currentFilterStatus = btn.dataset.status;
      applyFilters();
    });
  });

  const searchInput = document.getElementById('alertSearchInput');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      searchQuery = e.target.value.toLowerCase().trim();
      applyFilters();
    });
  }

  function applyFilters() {
    const cards = document.querySelectorAll('.alert-card');
    let visibleCount = 0;

    cards.forEach((card) => {
      const type = card.dataset.type;
      const status = card.dataset.status;
      const text = card.textContent.toLowerCase();

      const typeMatch = currentFilterType === 'all' || type === currentFilterType;
      const statusMatch = currentFilterStatus === 'all' || status === currentFilterStatus;
      const searchMatch = !searchQuery || text.includes(searchQuery);

      if (typeMatch && statusMatch && searchMatch) {
        card.style.display = 'flex';
        visibleCount++;
      } else {
        card.style.display = 'none';
      }
    });

    const emptyEl = document.getElementById('alertEmptyState');
    if (emptyEl) {
      emptyEl.style.display = visibleCount === 0 ? 'block' : 'none';
    }
  }

  // 2. Incident Status Actions (Acknowledge / Resolve)
  document.addEventListener('click', async (e) => {
    const actionBtn = e.target.closest('.alert-action-trigger');
    if (!actionBtn) return;

    const alertId = actionBtn.dataset.alertId;
    const action = actionBtn.dataset.action; // 'acknowledge' or 'resolve'

    actionBtn.disabled = true;

    try {
      const res = await fetch(`/api/alerts/${alertId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action })
      });

      const data = await res.json();
      if (res.ok && data.success) {
        window.showToast(`Alert #${data.alert.sequenceNumber} marked as ${data.alert.status}`, 'success');
        updateCardUI(data.alert);
      } else {
        window.showToast(data.message || 'Action failed', 'error');
        actionBtn.disabled = false;
      }
    } catch (err) {
      window.showToast('Network error updating alert', 'error');
      actionBtn.disabled = false;
    }
  });

  function updateCardUI(alert) {
    const card = document.getElementById(`alert-card-${alert._id}`);
    if (!card) return;

    card.dataset.status = alert.status;

    const badgeContainer = card.querySelector('.status-badge-wrap');
    if (badgeContainer) {
      if (alert.status === 'acknowledged') {
        badgeContainer.innerHTML = `<span class="badge badge-status-ack">ACKNOWLEDGED BY ${window.escapeHtml(alert.acknowledgedBy || 'OPERATOR')}</span>`;
      } else if (alert.status === 'resolved') {
        badgeContainer.innerHTML = `<span class="badge badge-status-resolved">RESOLVED</span>`;
      }
    }

    const actionContainer = card.querySelector('.alert-action-btns');
    if (actionContainer) {
      if (alert.status === 'acknowledged') {
        actionContainer.innerHTML = `
          <button class="btn btn-sm btn-success alert-action-trigger" data-alert-id="${alert._id}" data-action="resolve">
            Mark Resolved
          </button>
        `;
      } else if (alert.status === 'resolved') {
        actionContainer.innerHTML = `<span style="font-size: 0.8rem; color: var(--status-online); font-weight: 600;">Incident Closed</span>`;
      }
    }
  }

  // Snapshot reconciliation keeps filters and action controls in place.
  let initialized = false;
  const seen = new Set([...document.querySelectorAll('.alert-card')].map(card => card.id.replace('alert-card-', '')));
  window.addEventListener('campus:state', ({ detail }) => {
    const ids = new Set(detail.alerts.map(alert => alert._id));
    document.querySelectorAll('.alert-card').forEach(card => {
      if (!ids.has(card.id.replace('alert-card-', ''))) card.remove();
    });
    for (const alert of [...detail.alerts].reverse()) {
      if (!document.getElementById(`alert-card-${alert._id}`)) renderNewAlertCard(alert);
      updateCardUI(alert);
      if (initialized && !seen.has(alert._id)) {
        window.showToast(`New ${alert.emergencyType} alert at ${alert.building} - ${alert.room}`, 'warning');
        if (alert.threatStatus === 'verified_threat') window.alarmSound?.playAlarm(3500);
      }
      seen.add(alert._id);
    }
    initialized = true;
    for (const [type, count] of Object.entries(detail.counts)) {
      const element = document.getElementById(`count-${type}`);
      if (element) element.textContent = count;
    }
    const active = document.getElementById('count-active-nodes');
    if (active) active.textContent = `${detail.nodes.filter(n => n.video?.cameraConnected || (!n.videoEnabled && n.status !== 'offline')).length} / ${detail.nodes.length}`;
    const latest = detail.alerts.find(a => a.threatStatus === 'verified_threat' && a.status !== 'resolved');
    let banner = document.querySelector('.latest-threat-banner');
    if (!latest) banner?.remove();
    else {
      if (!banner) {
        banner = document.createElement('div'); banner.className = 'latest-threat-banner';
        document.querySelector('.stats-grid')?.after(banner);
      }
      banner.innerHTML = `<div><strong>CRITICAL THREAT: ${window.escapeHtml(latest.room)}</strong><div>${window.escapeHtml(latest.building)}</div></div><a class="btn btn-danger" href="/cam-view?alertId=${encodeURIComponent(latest._id)}">Open Verification Cam →</a>`;
    }
    applyFilters();
  });

  function renderNewAlertCard(raw) {
    const a = Object.fromEntries(Object.entries(raw).map(([key, value]) => [key, typeof value === 'string' ? window.escapeHtml(value) : value]));
    if (!alertList) return;

    const card = document.createElement('div');
    card.id = `alert-card-${a._id}`;
    card.className = `alert-card priority-${a.priority}`;
    card.dataset.type = a.emergencyType;
    card.dataset.status = a.status;

    let threatBadgeClass = 'badge-medical';
    let threatText = a.threatStatus.replace(/_/g, ' ');
    if (a.threatStatus === 'verified_threat') threatBadgeClass = 'badge-verified-threat';
    else if (a.threatStatus === 'unverified_audio_trigger') threatBadgeClass = 'badge-unverified-audio';

    card.innerHTML = `
      <div class="alert-card-header">
        <div class="alert-badges">
          <span class="badge ${threatBadgeClass}">${threatText}</span>
          <span class="badge badge-${a.emergencyType}">${a.emergencyType}</span>
          <div class="status-badge-wrap">
            <span class="badge badge-status-new">NEW INCIDENT</span>
          </div>
        </div>
        <div class="alert-time">Just now (Seq #${a.sequenceNumber})</div>
      </div>
      <div class="alert-card-body">
        <div class="alert-location">
          <div>
            <div class="location-room">${a.room}</div>
            <div class="location-building">${a.building}</div>
          </div>
          <span class="location-node">${a.nodeId}</span>
        </div>
        <div class="alert-telemetry">
          ${a.audioConfidence !== null && a.audioConfidence !== undefined ? `
            <div class="telemetry-item">
              <span>Audio TinyML:</span>
              <span class="telemetry-val">${Math.round(a.audioConfidence * 100)}%</span>
            </div>
          ` : ''}
          ${a.firearmConfidence !== null && a.firearmConfidence !== undefined ? `
            <div class="telemetry-item">
              <span>Firearm Vision:</span>
              <span class="telemetry-val" style="color: ${a.firearmConfidence > 0.5 ? 'var(--threat-verified)' : '#f97316'};">
                ${Math.round(a.firearmConfidence * 100)}%
              </span>
            </div>
          ` : ''}
        </div>
      </div>
      <div class="alert-card-actions">
        <a href="/cam-view?nodeId=${a.nodeId}&alertId=${a._id}" class="btn btn-sm btn-outline">
          Inspect Camera Feed &rarr;
        </a>
        <div class="alert-action-btns">
          <button class="btn btn-sm btn-warning alert-action-trigger" data-alert-id="${a._id}" data-action="acknowledge">
            Acknowledge
          </button>
          <button class="btn btn-sm btn-success alert-action-trigger" data-alert-id="${a._id}" data-action="resolve">
            Resolve
          </button>
        </div>
      </div>
    `;

    alertList.prepend(card);
  }

  function updateStatsOnNewAlert(a) {
    const valEl = document.getElementById(`count-${a.emergencyType}`);
    if (valEl) {
      valEl.textContent = (parseInt(valEl.textContent, 10) || 0) + 1;
    }
  }
});
