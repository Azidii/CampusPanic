document.addEventListener('DOMContentLoaded', () => {
  const toggle = document.getElementById('notificationToggle');
  const panel = document.getElementById('notificationPanel');
  const filter = document.getElementById('includeResolved');
  let alerts = [];
  let online = false;
  let previousOpen;
  function close() { if (!panel || !toggle) return; panel.hidden = true; toggle.setAttribute('aria-expanded', 'false'); }
  toggle?.addEventListener('click', () => { panel.hidden = !panel.hidden; toggle.setAttribute('aria-expanded', String(!panel.hidden)); });
  document.addEventListener('click', event => { if (!event.target.closest('.notification-wrap')) close(); });
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && panel && !panel.hidden) { close(); toggle.focus(); } });
  function renderRows(container, rows, empty) {
    if (!container) return;
    container.replaceChildren();
    if (!rows.length) { const p = document.createElement('p'); p.className = 'notification-empty'; p.textContent = empty; container.append(p); return; }
    for (const alert of rows) {
      const link = document.createElement('a');
      link.className = 'notification-row'; link.dataset.status = alert.status; link.dataset.emergency = alert.emergencyType;
      link.href = '/cam-view?' + new URLSearchParams({nodeId: alert.nodeId, alertId: alert._id});
      const heading = document.createElement('strong'); heading.textContent = alert.emergencyType.charAt(0).toUpperCase() + alert.emergencyType.slice(1) + ' · ' + alert.room;
      const location = document.createElement('span'); location.textContent = alert.building + ' · ' + alert.nodeId;
      const meta = document.createElement('small'); const date = new Date(alert.timestamp);
      meta.textContent = alert.status.replaceAll('_', ' ') + ' · ' + (Number.isNaN(date.getTime()) ? 'Time unavailable' : date.toLocaleString([], {month:'short', day:'numeric', hour:'2-digit', minute:'2-digit'}));
      const action = document.createElement('span'); action.className = 'notification-action'; action.textContent = 'Review node →';
      link.append(heading, location, meta, action); container.append(link);
    }
  }
  function render() {
    const open = alerts.filter(alert => alert.status !== 'resolved');
    renderRows(document.getElementById('notificationPreview'), open.slice(0,6), online ? 'No open incidents in the latest reports.' : 'Notifications unavailable. Reconnecting…');
    const rows = filter?.checked ? alerts : open;
    renderRows(document.getElementById('notificationList'), rows, online ? 'No incidents match this view.' : 'Notifications unavailable. Reconnecting…');
    const summary = document.getElementById('notificationSummary');
    if (summary) summary.textContent = online ? rows.length + ' incidents shown · ' + alerts.length + ' available reports · ' + open.length + ' open' : 'Updates interrupted. Showing the last received reports.';
  }
  filter?.addEventListener('change',render);
  window.addEventListener('campus:state', ({detail}) => {
    alerts = [...new Map([...(detail.activeAlerts || []), ...(detail.alerts || [])].map(alert => [alert._id, alert])).values()].sort((a,b) => a.priority-b.priority || new Date(b.timestamp)-new Date(a.timestamp)); online = true;
    const open = alerts.filter(a => a.status !== 'resolved');
    if (previousOpen) for (const alert of open.filter(a => !previousOpen.has(a._id))) {
      window.showToast?.(alert.emergencyType + ' alert at ' + alert.building + ' · ' + alert.room, 'warning');
      if (alert.threatStatus === 'verified_threat') window.alarmSound?.playAlarm(3500);
    }
    previousOpen = new Set(open.map(a => a._id));
    const count = open.length;
    for (const id of ['notificationCount','notificationNavCount']) { const el=document.getElementById(id); if(el) { el.textContent=count; el.hidden=count===0; } }
    toggle?.setAttribute('aria-label', 'Notifications, ' + count + ' open incidents');
    const status=document.getElementById('notificationConnection'); if(status) status.textContent='Latest emergency reports · Updated just now';
    render();
  });
  window.addEventListener('campus:offline', () => { online=false; const status=document.getElementById('notificationConnection'); if(status) status.textContent='Updates interrupted. Showing the last received reports.'; render(); });
});
