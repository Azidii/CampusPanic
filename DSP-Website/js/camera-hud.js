(() => {
  const labels = { smoke: 'Smoke', fire: 'Fire', medical: 'Medical', shooting: 'Shooting' };
  const escape = value => window.escapeHtml(value);
  function chips(hud) {
    return Object.entries(labels).map(([key, label]) => {
      const value = hud?.threats?.[key];
      const state = value === true ? 'on' : value === false ? 'off' : 'unknown';
      return `<span class="hud-threat" data-state="${state}">${label} <b>${state === 'on' ? 'On' : state === 'off' ? 'Off' : '—'}</b></span>`;
    }).join('');
  }
  window.renderCameraHud = (viewport, node) => {
    let hud = viewport.querySelector('.camera-hud');
    if (!hud) {
      hud = document.createElement('div');
      hud.className = 'camera-hud';
      hud.setAttribute('aria-label', 'Camera status');
      hud.innerHTML = '<div class="camera-hud-top"><span class="hud-battery"></span><span class="hud-network"></span></div><div class="camera-hud-threats"></div>';
      viewport.append(hud);
    }
    const state = node?.hud;
    const connected = Boolean(state?.cameraConnected);
    const battery = state?.batteryPercentage;
    hud.querySelector('.hud-battery').textContent = `Battery ${Number.isInteger(battery) ? battery + '%' : '—'}`;
    const networks = { wifi: 'Wi-Fi', cellular: 'Cellular', ethernet: 'Ethernet', connected: 'Connected', unknown: 'Connected', offline: 'Offline' };
    const network = hud.querySelector('.hud-network');
    network.textContent = `Network ${connected ? networks[state?.network] || 'Connected' : 'Offline'}`;
    network.dataset.connected = connected;
    hud.querySelector('.camera-hud-threats').innerHTML = chips(state);
  };
  window.markCameraHudOffline = viewport => {
    const hud = viewport.querySelector('.camera-hud');
    if (!hud) return;
    const network = hud.querySelector('.hud-network');
    network.textContent = 'Network Offline';
    network.dataset.connected = false;
    hud.querySelector('.hud-battery').textContent = 'Battery —';
    hud.querySelectorAll('.hud-threat').forEach(item => {
      if (item.dataset.state !== 'on') { item.dataset.state = 'unknown'; item.querySelector('b').textContent = '—'; }
    });
  };
  function renderNodes(nodes) {
    const container = document.getElementById('nodeThreatRows');
    if (!container) return;
    container.innerHTML = nodes.length ? nodes.map(node => `<div class="node-threat-row"><a href="/cam-view?nodeId=${encodeURIComponent(node.nodeId)}"><strong>${escape(node.name || node.nodeId)}</strong><small>${escape(node.building)}, ${escape(node.room)}</small></a><div class="node-threat-chips">${chips(node.hud)}</div><span class="hardware-state" data-connected="${Boolean(node.hud?.hardware?.connected)}">ESP32 ${node.hud?.hardware?.connected ? 'Online' : node.audio?.paired ? 'Offline' : 'Not paired'}</span></div>`).join('') : '<p>No security nodes yet. Add one in Security Nodes.</p>';
  }
  window.addEventListener('campus:state', ({ detail }) => renderNodes(window.filterBuilding && document.body.classList.contains('page-dashboard') ? window.filterBuilding(detail.nodes || []) : detail.nodes || []));
  window.addEventListener('campus:offline', () => {
    document.querySelectorAll('.hardware-state').forEach(item => { item.textContent = 'Status unavailable'; item.dataset.connected = false; });
  });
})();
