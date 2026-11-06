document.addEventListener('DOMContentLoaded', () => {
  const element = document.getElementById('activeThreatMap');
  if (!element || typeof L === 'undefined') return;
  const map = L.map(element);
  map.fitWorld();
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; OpenStreetMap &copy; CARTO', subdomains: 'abcd', maxZoom: 20
  }).addTo(map);
  const group = L.featureGroup().addTo(map);
  let fitted = false;
  let seen = null;
  const label = alert => alert.emergencyType === 'gunshot' ? 'SHOOTING' :
    alert.triggerSource === 'smoke_sensor' ? 'SMOKE / FIRE' : alert.emergencyType.toUpperCase();
  const hardwareText = node => node?.hud?.hardware?.connected ? 'ESP32 online · buttons and smoke reporting' :
    node?.audio?.paired ? 'ESP32 paired · offline' : 'No ESP32 paired to this node';

  function render(nodes, alerts) {
    nodes = window.filterBuilding(nodes);
    alerts = window.filterBuilding(alerts);
    document.getElementById('mapLocationStatus').textContent = 'Incident locations retain their recorded building and room. Pins use current node coordinates only where the recorded location still matches.';
    group.clearLayers();
    const unresolved = alerts.filter(alert => alert.status !== 'resolved');
    const byNode = new Map(nodes.map(node => [node.nodeId, node]));
    const activeIds = new Set(unresolved.map(alert => alert.nodeId));
    for (const node of nodes) {
      if (Object.values(node.hud?.threats || {}).some(value => value === true)) activeIds.add(node.nodeId);
    }
    document.getElementById('hotspotCount').textContent = `Active Incident Hotspots: ${activeIds.size}`;
    const banner = document.getElementById('threatLiveBanner');
    banner.dataset.alert = activeIds.size > 0;
    banner.textContent = activeIds.size ? `${activeIds.size} active threat location${activeIds.size === 1 ? '' : 's'} · Camera detections and ESP32 button/smoke reports are monitored here.` : 'LIVE · No active threats reported.';

    const ids = new Set(unresolved.map(alert => String(alert._id)));
    if (seen) {
      const incoming = unresolved.filter(alert => !seen.has(String(alert._id)) && ['gunshot', 'fire'].includes(alert.emergencyType));
      if (incoming.length) window.showToast(`${label(incoming[0])}: ${incoming[0].building}, ${incoming[0].room}`, 'error', 8000);
    }
    seen = ids;

    const sidebar = document.querySelector('.threat-sidebar-list');
    [...sidebar.children].slice(1).forEach(child => child.remove());
    for (const nodeId of activeIds) {
      const node = byNode.get(nodeId);
      const incidents = unresolved.filter(alert => alert.nodeId === nodeId);
      const first = incidents[0];
      const card = document.createElement('div');
      card.className = 'threat-hotspot-card';
      const heading = document.createElement('strong');
      heading.textContent = incidents.length ? [...new Set(incidents.map(label))].join(' / ') : Object.entries(node?.hud?.threats || {}).filter(([, value]) => value === true).map(([key]) => key.toUpperCase()).join(' / ') || 'HARDWARE ALERT';
      const location = document.createElement('p');
      location.textContent = `${first?.building || node?.building || nodeId}, ${first?.room || node?.room || ''}${window.isLegacyBuilding(first?.building || node?.building) ? ' · Building needs correction' : ''}`;
      const hardware = document.createElement('p');
      hardware.className = 'hardware-state';
      hardware.textContent = hardwareText(node);
      const link = document.createElement('a');
      link.className = 'btn btn-sm btn-danger'; link.textContent = 'Inspect Feed →';
      link.href = `/cam-view?nodeId=${encodeURIComponent(nodeId)}${first ? `&alertId=${encodeURIComponent(first._id)}` : ''}`;
      card.append(heading, location, hardware, link);
      sidebar.append(card);

      if (!Number.isFinite(node?.lat) || Math.abs(node.lat) > 90 || !Number.isFinite(node?.lng) || Math.abs(node.lng) > 180 || (first && (first.building !== node.building || first.room !== node.room))) {
        const note = document.createElement('p');
        note.textContent = 'No verified coordinates for this incident location. Review it from the incident link.';
        card.append(note);
        continue;
      }
      const fire = incidents.some(alert => alert.emergencyType === 'fire') || node.hud?.threats?.fire;
      const kind = fire ? 'pin-fire' : incidents.some(alert => alert.emergencyType === 'gunshot') || node.hud?.threats?.shooting ? 'pin-gunshot-verified' : 'pin-medical';
      const marker = L.marker([node.lat, node.lng], { icon: L.divIcon({
        className: `threat-pulse-pin ${kind}`, iconSize: [24, 24], iconAnchor: [12, 12]
      }) }).addTo(group);
      const popup = document.createElement('div');
      const title = document.createElement('strong'); title.textContent = heading.textContent;
      const status = document.createElement('p'); status.textContent = hardwareText(node);
      const camera = document.createElement('a'); camera.href = link.href; camera.textContent = 'Open incident camera →';
      popup.append(title, status, camera);
      marker.bindPopup(popup);
    }
    if (!activeIds.size) {
      const empty = document.createElement('p'); empty.textContent = 'No active emergency incidents currently reported.'; sidebar.append(empty);
    }
    if (!fitted && group.getLayers().length) { map.fitBounds(group.getBounds().pad(.3), { maxZoom: 17 }); fitted = true; }
  }
  const initial = JSON.parse(document.getElementById('activeNodesData').textContent);
  render(initial.activeNodes, initial.activeAlerts);
  window.addEventListener('campus:state', ({ detail }) => render(detail.nodes, detail.activeAlerts || detail.alerts));
  window.addEventListener('campus:offline', () => {
    document.getElementById('threatLiveBanner').textContent = 'Connection interrupted · Threat status may be out of date.';
  });
});
