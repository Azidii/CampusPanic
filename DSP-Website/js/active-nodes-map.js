document.addEventListener('DOMContentLoaded', () => {
  const element = document.getElementById('activeThreatMap');
  if (!element || typeof L === 'undefined') return;
  const map = L.map(element).setView([14.5995, 120.9842], 17);
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; OpenStreetMap &copy; CARTO', subdomains: 'abcd', maxZoom: 20
  }).addTo(map);
  const group = L.featureGroup().addTo(map);
  let fitted = false;
  function render(nodes, alerts) {
    group.clearLayers();
    const unresolved = alerts.filter(alert => alert.status !== 'resolved');
    const count = document.getElementById('hotspotCount');
    if (count) count.textContent = `Active Incident Hotspots: ${new Set(unresolved.map(a => a.nodeId)).size}`;
    const sidebar = document.querySelector('.threat-sidebar-list');
    if (sidebar) {
      [...sidebar.children].slice(1).forEach(child => child.remove());
      for (const alert of unresolved) {
        const card = document.createElement('div'); card.className = 'threat-hotspot-card';
        const title = document.createElement('strong'); title.textContent = `${alert.emergencyType.toUpperCase()} · ${alert.room}`;
        const location = document.createElement('p'); location.textContent = `${alert.building} (${alert.nodeId})`;
        const status = document.createElement('p'); status.textContent = alert.threatStatus.replace(/_/g, ' ');
        const link = document.createElement('a'); link.className = 'btn btn-sm btn-danger'; link.textContent = 'Inspect Feed →';
        link.href = `/cam-view?alertId=${encodeURIComponent(alert._id)}`;
        card.append(title, location, status, link); sidebar.append(card);
      }
      if (!unresolved.length) { const empty = document.createElement('p'); empty.textContent = 'No active emergency incidents currently reported.'; sidebar.append(empty); }
    }
    for (const node of nodes.filter(n => n.status === 'active')) {
      if (!Number.isFinite(node.lat) || !Number.isFinite(node.lng)) continue;
      const alert = alerts.find(a => a.nodeId === node.nodeId && a.status !== 'resolved');
      if (!alert) continue;
      const kind = alert.threatStatus === 'verified_threat' ? 'pin-gunshot-verified' :
        alert.threatStatus === 'unverified_audio_trigger' ? 'pin-unverified-audio' : `pin-${alert.emergencyType}`;
      const marker = L.marker([node.lat, node.lng], { icon: L.divIcon({
        className: `threat-pulse-pin ${kind}`, iconSize: [24, 24], iconAnchor: [12, 12]
      }) }).addTo(group);
      const popup = document.createElement('div');
      const title = document.createElement('strong'); title.textContent = `${alert.emergencyType.toUpperCase()}: ${node.building}, ${node.room}`;
      const link = document.createElement('a'); link.className = 'btn btn-sm btn-danger'; link.textContent = 'Open incident camera →';
      link.href = `/cam-view?nodeId=${encodeURIComponent(node.nodeId)}&alertId=${encodeURIComponent(alert._id)}`;
      popup.append(title, document.createElement('br'), link); marker.bindPopup(popup);
    }
    if (!fitted && group.getLayers().length) { map.fitBounds(group.getBounds().pad(.3), { maxZoom: 17 }); fitted = true; }
  }
  const initial = JSON.parse(document.getElementById('activeNodesData').textContent);
  render(initial.activeNodes, initial.activeAlerts);
  window.addEventListener('campus:state', ({ detail }) => render(detail.nodes, detail.alerts));
});
