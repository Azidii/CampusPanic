/**
 * Campus Map View Controller - map-view.js
 * Interactive Leaflet Map for Campus Nodes & Sensor Telemetry
 */

document.addEventListener('DOMContentLoaded', () => {
  const mapEl = document.getElementById('campusMap');
  if (!mapEl || typeof L === 'undefined') return;

  const campusCenter = [14.5995, 120.9842];
  const map = L.map('campusMap').setView(campusCenter, 17);

  // CartoDB Dark Matter tile layer
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
    subdomains: 'abcd',
    maxZoom: 20
  }).addTo(map);

  // Read nodes serialized in DOM
  const nodesScript = document.getElementById('nodesData');
  let nodes = [];
  if (nodesScript) {
    try {
      nodes = JSON.parse(nodesScript.textContent);
    } catch (e) {
      console.error('Failed to parse nodes data:', e);
    }
  }

  nodes.forEach((node) => {
    let pinColor = '#10b981'; // online
    if (node.status === 'active') pinColor = '#ef4444'; // active alert
    else if (node.status === 'offline') pinColor = '#64748b'; // offline

    const marker = L.circleMarker([node.lat, node.lng], {
      radius: 10,
      fillColor: pinColor,
      color: '#ffffff',
      weight: 2,
      opacity: 1,
      fillOpacity: 0.9
    }).addTo(map);

    const popupHtml = `
      <div class="node-popup-content">
        <div class="popup-node-title">${node.room}</div>
        <div class="popup-node-subtitle">${node.building} (${node.nodeId})</div>
        <div style="font-size: 0.78rem; font-family: monospace; margin-bottom: 8px;">
          STATUS: <strong style="color: ${pinColor}; text-transform: uppercase;">${node.status}</strong>
        </div>
        <a href="/cam-view?nodeId=${encodeURIComponent(node.nodeId)}" class="btn btn-sm btn-primary popup-btn">
          View Room Camera &rarr;
        </a>
      </div>
    `;

    marker.bindPopup(popupHtml);
  });
});
