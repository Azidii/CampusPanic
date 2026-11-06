document.addEventListener('DOMContentLoaded', () => {
  const element = document.getElementById('campusMap');
  if (!element || typeof L === 'undefined') return;
  const map = L.map(element);
  map.fitWorld();
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; OpenStreetMap &copy; CARTO', subdomains: 'abcd', maxZoom: 20
  }).addTo(map);
  const group = L.featureGroup().addTo(map);
  let fitted = false;
  function render(nodes) {
    nodes = window.filterBuilding(nodes);
    group.clearLayers();
    const valid = nodes.filter(node => Number.isFinite(node.lat) && Math.abs(node.lat) <= 90 && Number.isFinite(node.lng) && Math.abs(node.lng) <= 180);
    document.getElementById('mapLocationStatus').textContent = nodes.length ? valid.length + ' of ' + nodes.length + ' matching nodes have coordinates. Locations without coordinates are not plotted.' : 'No nodes match this building selection.';
    for (const node of nodes) {
      if (!valid.includes(node)) continue;
      const color = node.status === 'active' ? '#ef4444' : node.status === 'offline' ? '#64748b' : '#10b981';
      const marker = L.circleMarker([node.lat, node.lng], { radius: 10, fillColor: color,
        color: '#ffffff', weight: 2, fillOpacity: .9 }).addTo(group);
      const popup = document.createElement('div');
      const title = document.createElement('strong'); title.textContent = node.name || node.room;
      const location = document.createElement('p'); location.textContent = `${node.building}, ${node.room} · ${node.status}${window.isLegacyBuilding(node.building) ? ' · Building needs correction' : ''}`;
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
