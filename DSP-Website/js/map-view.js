document.addEventListener('DOMContentLoaded', () => {
  const element = document.getElementById('campusMap');
  if (!element || typeof L === 'undefined') return;
  const map = L.map(element).setView([14.5995, 120.9842], 17);
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; OpenStreetMap &copy; CARTO', subdomains: 'abcd', maxZoom: 20
  }).addTo(map);
  const group = L.featureGroup().addTo(map);
  let fitted = false;
  function render(nodes) {
    group.clearLayers();
    for (const node of nodes) {
      if (!Number.isFinite(node.lat) || !Number.isFinite(node.lng)) continue;
      const color = node.status === 'active' ? '#ef4444' : node.status === 'offline' ? '#64748b' : '#10b981';
      const marker = L.circleMarker([node.lat, node.lng], { radius: 10, fillColor: color,
        color: '#ffffff', weight: 2, fillOpacity: .9 }).addTo(group);
      const popup = document.createElement('div');
      const title = document.createElement('strong'); title.textContent = node.name || node.room;
      const location = document.createElement('p'); location.textContent = `${node.building}, ${node.room} · ${node.status}`;
      const link = document.createElement('a'); link.className = 'btn btn-sm btn-primary';
      link.href = `/cam-view?nodeId=${encodeURIComponent(node.nodeId)}`; link.textContent = 'View node camera →';
      popup.append(title, location, link); marker.bindPopup(popup);
    }
    if (!fitted && group.getLayers().length) { map.fitBounds(group.getBounds().pad(.3), { maxZoom: 17 }); fitted = true; }
    const chips = document.querySelectorAll('.legend-chip span');
    ['online', 'active', 'offline'].forEach((status, index) => {
      if (chips[index]) chips[index].textContent = `${status === 'active' ? 'Active Threat' : status === 'online' ? 'Online' : 'Offline'} (${nodes.filter(n => n.status === status).length})`;
    });
  }
  render(JSON.parse(document.getElementById('nodesData').textContent));
  window.addEventListener('campus:state', ({ detail }) => render(detail.nodes));
});
