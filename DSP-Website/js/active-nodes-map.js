/**
 * Active Threats Campus Map Controller - active-nodes-map.js
 * Shows ONLY activated emergency nodes with animated pulsing halos
 */

document.addEventListener('DOMContentLoaded', () => {
  const mapEl = document.getElementById('activeThreatMap');
  if (!mapEl || typeof L === 'undefined') return;

  const campusCenter = [14.5995, 120.9842];
  const map = L.map('activeThreatMap').setView(campusCenter, 17);

  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; OpenStreetMap &copy; CARTO',
    subdomains: 'abcd',
    maxZoom: 20
  }).addTo(map);

  const activeDataScript = document.getElementById('activeNodesData');
  let data = { activeNodes: [], activeAlerts: [] };
  if (activeDataScript) {
    try {
      data = JSON.parse(activeDataScript.textContent);
    } catch (e) {
      console.error('Failed to parse active nodes data:', e);
    }
  }

  const markersGroup = L.featureGroup().addTo(map);

  function getPinClass(alert) {
    if (!alert) return 'pin-gunshot-verified';
    if (alert.threatStatus === 'verified_threat') return 'pin-gunshot-verified';
    if (alert.threatStatus === 'unverified_audio_trigger') return 'pin-unverified-audio';
    if (alert.emergencyType === 'medical') return 'pin-medical';
    if (alert.emergencyType === 'fire') return 'pin-fire';
    if (alert.emergencyType === 'panic') return 'pin-panic';
    return 'pin-gunshot-verified';
  }

  data.activeNodes.forEach((node) => {
    const alert = data.activeAlerts.find((a) => a.nodeId === node.nodeId);
    const pinClass = getPinClass(alert);

    const pulseIcon = L.divIcon({
      className: `threat-pulse-pin ${pinClass}`,
      iconSize: [24, 24],
      iconAnchor: [12, 12]
    });

    const marker = L.marker([node.lat, node.lng], { icon: pulseIcon }).addTo(markersGroup);

    const snapshotHtml = alert && alert.imageUrl ? `
      <img src="${alert.imageUrl}" style="width: 100%; aspect-ratio: 16/9; object-fit: cover; border-radius: 4px; margin: 8px 0;" />
    ` : '';

    const popupHtml = `
      <div class="node-popup-content" style="min-width: 200px;">
        <div class="popup-node-title" style="color: #ef4444;">ACTIVE INCIDENT: ${alert ? alert.emergencyType.toUpperCase() : 'ALERT'}</div>
        <div class="popup-node-subtitle">${node.room} &bull; ${node.building} (${node.nodeId})</div>
        ${snapshotHtml}
        <div style="font-size: 0.75rem; font-family: monospace; color: #fca5a5; margin-bottom: 6px;">
          THREAT: ${alert ? alert.threatStatus.replace(/_/g, ' ') : 'ACTIVE'}
        </div>
        <a href="/cam-view?nodeId=${encodeURIComponent(node.nodeId)}${alert ? '&alertId=' + alert._id : ''}" class="btn btn-sm btn-danger popup-btn">
          Open Emergency Cam &rarr;
        </a>
      </div>
    `;

    marker.bindPopup(popupHtml);
  });

  if (data.activeNodes.length > 0) {
    map.fitBounds(markersGroup.getBounds().pad(0.3));
  }

  // Socket listener for new alerts
  if (window.appSocket) {
    window.appSocket.on('alert:new', (newAlert) => {
      // Refresh or add dynamic pin
      window.showToast(`Threat Map: New emergency at ${newAlert.building} - ${newAlert.room}!`, 'error');
    });
  }
});
