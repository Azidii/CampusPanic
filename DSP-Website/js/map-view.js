document.addEventListener('DOMContentLoaded', () => {
  const { buildings, connection, feed, project } = CampusMap;
  const $ = id => document.getElementById(id);
  const warning = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 3 2 21h20L12 3Z"/><path d="M12 9v5m0 3v1"/></svg>';
  let buildingId = buildings.find(b => b.label === new URLSearchParams(location.search).get('building'))?.id || buildings[0].id;
  let floorId = 'all', nodes = [], model = project([], []), fresh = false, lastUpdate = null, selected = null, opener = null;
  let roomElements = new Map();
  const label = node => node.name || node.nodeId;
  const statusText = status => ({ online: 'Online', offline: 'Offline', unknown: 'Unknown' })[status];
  const time = value => value && Number.isFinite(new Date(value).getTime()) ? new Date(value).toLocaleString() : 'Unavailable';
  function nodeButton(node) {
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'map-node'; button.dataset.nodeId = node.nodeId;
    const mark = document.createElement('span'); mark.className = 'map-node-mark'; mark.setAttribute('aria-hidden', 'true');
    const text = document.createElement('span'); text.className = 'map-node-name';
    const tooltip = document.createElement('span'); tooltip.className = 'map-tooltip'; tooltip.setAttribute('role', 'tooltip');
    button.append(mark, text, tooltip);
    button.addEventListener('click', () => select({ nodeId: node.nodeId }, button));
    button.addEventListener('keydown', event => { if (event.key === 'Escape') button.classList.add('tooltip-muted'); });
    for (const event of ['pointerenter', 'focus']) button.addEventListener(event, () => button.classList.remove('tooltip-muted'));
    return button;
  }
  function updateNode(button, node) {
    const status = connection(node, fresh), text = `${label(node)} · ${node.nodeId} · ${statusText(status)}`;
    button.dataset.status = status;
    button.querySelector('.map-node-name').textContent = label(node);
    button.querySelector('.map-node-mark').textContent = { online: '●', offline: '×', unknown: '?' }[status];
    button.querySelector('.map-tooltip').textContent = text;
    button.setAttribute('aria-label', text);
    button.setAttribute('aria-pressed', String(selected?.nodeId === node.nodeId));
  }
  // Reconcile by ID so two-second snapshots never remove a focused node button.
  function syncNodes(container, rows) {
    const existing = new Map([...container.children].map(button => [button.dataset.nodeId, button]));
    for (const node of rows) {
      let button = existing.get(node.nodeId);
      if (!button) { button = nodeButton(node); container.append(button); }
      existing.delete(node.nodeId); updateNode(button, node);
    }
    for (const button of existing.values()) button.remove();
  }
  function badge(element, count) {
    element.hidden = count === 0; element.textContent = count;
    element.setAttribute('aria-label', `${count} active alerts`);
  }
  function buildFloors() {
    const building = buildings.find(b => b.id === buildingId);
    $('mapBuildingPanel').setAttribute('aria-labelledby', buildingId === 'rsy' ? 'mapRsyTab' : 'mapBirreyTab');
    const diagram = $('mapDiagrams'); diagram.replaceChildren(); roomElements = new Map();
    for (const floor of building.floors.filter(f => floorId === 'all' || f.id === floorId)) {
      const section = document.createElement('section'); section.className = 'map-floor'; section.dataset.floorId = floor.id;
      const heading = document.createElement('h2'); heading.textContent = `${building.label} · ${floor.label}`;
      const count = document.createElement('span'); count.className = 'map-alert-badge'; count.dataset.floorBadge = `${buildingId}/${floor.id}`;
      heading.append(' ', count);
      const plan = document.createElement('div'); plan.className = 'map-plan';
      for (const row of floor.rows) {
        const scroll = document.createElement('div'); scroll.className = 'map-floor-scroll'; scroll.tabIndex = 0;
        scroll.setAttribute('role', 'region'); scroll.setAttribute('aria-label', `${building.label} ${floor.label}, ${row.map(r => r.label).join(', ')}; scroll horizontally for all rooms`);
        const line = document.createElement('div'); line.className = 'map-room-row';
        line.style.setProperty('--columns', row.length);
        for (const room of row) {
          const key = `${buildingId}/${floor.id}/${room.id}`;
          const cell = document.createElement('div'); cell.className = 'map-room'; cell.dataset.roomKey = key;
          const button = document.createElement('button'); button.type = 'button'; button.className = 'map-room-select';
          const title = document.createElement('strong'); title.textContent = room.label;
          const emergency = document.createElement('span'); emergency.className = 'map-room-alert';
          const nodeList = document.createElement('div'); nodeList.className = 'map-room-nodes';
          button.append(title, emergency); cell.append(button, nodeList); line.append(cell);
          button.addEventListener('click', () => select({ roomKey: key }, button));
          roomElements.set(key, { cell, button, emergency, nodeList });
        }
        scroll.append(line); plan.append(scroll);
      }
      section.append(heading, plan); diagram.append(section);
    }
  }
  function buildOptions() {
    const select = $('mapFloor'); select.replaceChildren(new Option('Entire building', 'all'));
    for (const floor of buildings.find(b => b.id === buildingId).floors) select.append(new Option(floor.label, floor.id));
    select.value = floorId;
  }
  function render() {
    for (const building of buildings) {
      const tab = document.querySelector(`[data-building="${building.id}"]`);
      tab.setAttribute('aria-selected', String(buildingId === building.id)); tab.tabIndex = buildingId === building.id ? 0 : -1;
      badge(tab.querySelector('.map-alert-badge'), model.buildingCounts.get(building.id));
    }
    for (const option of $('mapFloor').options) {
      const building = buildings.find(b => b.id === buildingId);
      const count = option.value === 'all' ? model.buildingCounts.get(buildingId) : model.floorCounts.get(`${buildingId}/${option.value}`) || 0;
      const name = option.value === 'all' ? 'Entire building' : building.floors.find(f => f.id === option.value).label;
      option.textContent = name + (count ? ` — ${count} active ${count === 1 ? 'alert' : 'alerts'}` : '');
    }
    for (const element of document.querySelectorAll('[data-floor-badge]')) badge(element, model.floorCounts.get(element.dataset.floorBadge) || 0);
    for (const [key, elements] of roomElements) {
      const room = model.rooms.get(key), count = room.alerts.length;
      elements.cell.classList.toggle('has-emergency', count > 0);
      elements.button.setAttribute('aria-label', `${room.label}, ${count} active alerts, ${room.nodes.length} nodes`);
      elements.button.setAttribute('aria-pressed', String(selected?.roomKey === key));
      elements.emergency.innerHTML = count ? warning : '';
      if (count) elements.emergency.append(`${count} active ${count === 1 ? 'alert' : 'alerts'}`);
      syncNodes(elements.nodeList, room.nodes);
    }
    syncNodes($('mapUnmappedNodes'), model.unmappedNodes);
    const unmapped = $('mapUnmappedAlerts'); unmapped.replaceChildren();
    for (const alert of model.unmappedAlerts) {
      const li = document.createElement('li');
      li.textContent = `${alert.emergencyType} · ${alert.building || 'No building'} · ${alert.room || 'No room'} · ${alert.nodeId} · ${alert.status}`;
      unmapped.append(li);
    }
    $('mapUnmapped').hidden = model.unmappedNodes.length + model.unmappedAlerts.length === 0;
    $('mapUnmappedSummary').textContent = `${model.unmappedNodes.length} nodes · ${model.unmappedAlerts.length} active alerts`;
    $('mapEmpty').hidden = nodes.length > 0 || !lastUpdate;
    $('mapSummary').textContent = lastUpdate ? `${nodes.length} nodes · ${model.active.length} active alerts campus-wide` : 'Waiting for node and incident data…';
    $('mapFreshness').textContent = lastUpdate ? `${fresh ? 'Updated' : 'Updates disconnected — showing last received data from'} ${time(lastUpdate)}${fresh ? '' : '. Node status is unknown until reconnected.'}` :
      $('mapError').hidden ? 'Loading live status…' : 'No live data has been received. Retry or wait for reconnection.';
    renderDetail();
  }
  function select(value, button) {
    selected = value; opener = button; $('mapDetail').hidden = false; render();
    $('mapDetailTitle').focus();
  }
  function closeDetail() {
    selected = null; $('mapDetail').hidden = true; render(); if (opener?.isConnected) opener.focus();
  }
  function renderDetail() {
    if (!selected) return;
    const node = selected.nodeId ? nodes.find(n => n.nodeId === selected.nodeId) : null;
    const room = selected.roomKey ? model.rooms.get(selected.roomKey) : node ? CampusMap.locate(node) : null;
    $('mapDetailTitle').textContent = selected.nodeId ? (node ? label(node) : 'Node no longer available') : room.label;
    const fields = $('mapDetailFields'); fields.replaceChildren();
    const values = node ? { 'Node ID': node.nodeId, Building: node.building, Floor: room?.floor.label || 'Unmapped', Room: node.room,
      Connection: statusText(connection(node, fresh)), 'Last seen': time(node.audio?.lastSeen || node.lastSeen) } : selected.nodeId ? {} :
      { Building: room.building.label, Floor: room.floor.label, Room: room.label, Nodes: room.nodes.length };
    for (const [key, value] of Object.entries(values)) {
      const dt = document.createElement('dt'), dd = document.createElement('dd'); dt.textContent = key; dd.textContent = value; fields.append(dt, dd);
    }
    const active = selected.nodeId ? model.active.filter(a => a.nodeId === selected.nodeId) : room.alerts;
    $('mapDetailCount').textContent = `${active.length} active ${active.length === 1 ? 'alert' : 'alerts'}`;
    const alerts = $('mapDetailAlerts'); alerts.replaceChildren();
    for (const alert of active) {
      const li = document.createElement('li'); li.textContent = `${alert.emergencyType} · ${alert.status} · ${alert.nodeId} · ${alert.room} · ${time(alert.timestamp)}`; alerts.append(li);
    }
    $('mapDetailNoAlerts').hidden = active.length > 0;
    const availability = node ? feed(node, fresh) : { reason: selected.nodeId ? 'The selected node was removed.' : 'Select a node marker to open its specific camera feed.' };
    const link = $('mapLiveFeed'); link.hidden = false;
    link.setAttribute('aria-disabled', String(!availability.href));
    if (availability.href) { link.href = availability.href; link.removeAttribute('tabindex'); }
    else { link.removeAttribute('href'); link.tabIndex = -1; }
    $('mapFeedReason').textContent = availability.reason || '';
  }
  function changeBuilding(id) {
    buildingId = id; floorId = 'all'; selected = null; $('mapDetail').hidden = true;
    buildOptions(); buildFloors(); render();
  }
  const tabs = [...document.querySelectorAll('[data-building]')];
  for (const tab of tabs) {
    tab.addEventListener('click', () => changeBuilding(tab.dataset.building));
    tab.addEventListener('keydown', event => {
      const index = tabs.indexOf(tab);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 :
        event.key === 'ArrowRight' ? (index + 1) % tabs.length : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length : null;
      if (next !== null) { event.preventDefault(); tabs[next].click(); tabs[next].focus(); }
    });
  }
  $('mapFloor').addEventListener('change', event => { floorId = event.target.value; selected = null; $('mapDetail').hidden = true; buildFloors(); render(); });
  $('mapDetailClose').addEventListener('click', closeDetail);
  $('mapDetail').addEventListener('keydown', event => { if (event.key === 'Escape') closeDetail(); });
  $('mapRetry').addEventListener('click', () => window.refreshCampus());
  window.addEventListener('campus:state', ({ detail }) => {
    if (!Array.isArray(detail.nodes) || !Array.isArray(detail.activeAlerts)) { disconnected(); return; }
    nodes = detail.nodes; model = project(nodes, detail.activeAlerts); fresh = true; lastUpdate = Date.now();
    $('mapError').hidden = true; render();
  });
  function disconnected() { fresh = false; $('mapError').hidden = false; render(); }
  window.addEventListener('campus:offline', disconnected);
  // A stalled poll must not leave the last heartbeat looking current indefinitely.
  setInterval(() => { if (fresh && lastUpdate && Date.now() - lastUpdate > 12000) disconnected(); }, 2000);
  buildOptions(); buildFloors(); render();
});
