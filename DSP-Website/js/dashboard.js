document.addEventListener('DOMContentLoaded', () => {
  const byId = id => document.getElementById(id), escape = window.escapeHtml;
  let feed = JSON.parse(byId('dashboardData').textContent), searchTimer;
  function setFilter(key, value) {
    const url = new URL(window.location.href); url.searchParams.set(key, value); url.searchParams.delete('historyPage');
    history.replaceState(null, '', url); window.refreshCampus();
  }
  const params = new URLSearchParams(location.search);
  byId('incidentFilters').open = window.matchMedia('(min-width: 641px)').matches || ['building','type','status','search'].some(key => params.has(key));
  for (const [id, key] of [['incidentType','type'],['incidentStatus','status']]) {
    byId(id).value = params.get(key) || 'all';
    byId(id).addEventListener('change', event => setFilter(key, event.target.value));
  }
  byId('showCleared').checked = params.get('showCleared') === 'true';
  byId('showCleared').addEventListener('change', event => { byId('historyDetails').open = true; setFilter('showCleared', String(event.target.checked)); });
  byId('historyDetails').open = params.get('showCleared') === 'true' || Number(params.get('historyPage')) > 1;
  byId('alertSearchInput').value = params.get('search') || '';
  byId('alertSearchInput').addEventListener('input', event => { clearTimeout(searchTimer); searchTimer = setTimeout(() => setFilter('search', event.target.value.trim()), 250); });
  for (const [id, delta] of [['historyPrevious',-1],['historyNext',1]]) byId(id).addEventListener('click', () => {
    const url = new URL(location.href); url.searchParams.set('historyPage', feed.historyPage + delta); history.replaceState(null, '', url); window.refreshCampus();
  });
  async function action(url, method, body) {
    const response = await fetch(url, { method, headers: {'Content-Type':'application/json'}, body: JSON.stringify(body) });
    const data = await response.json(); if (!response.ok || !data.success) throw new Error(data.message || 'Request failed');
    await window.refreshCampus(); return data;
  }
  byId('clearResolved').addEventListener('click', async event => {
    event.target.disabled = true;
    try { const result = await action('/api/alerts/clear-resolved', 'POST', {building:window.selectedBuilding()}); window.showToast(result.cleared + ' resolved incidents cleared for your account.', 'success'); }
    catch (error) { window.showToast(error.message, 'error'); }
    finally { event.target.disabled = false; }
  });
  document.addEventListener('click', async event => {
    const button = event.target.closest('.alert-action-trigger'); if (!button) return;
    button.disabled = true;
    try { await action('/api/alerts/' + encodeURIComponent(button.dataset.alertId), 'PATCH', {action:button.dataset.action}); }
    catch (error) { window.showToast(error.message, 'error'); button.disabled = false; }
  });
  function card(alert) {
    const a = Object.fromEntries(Object.entries(alert).map(([k,v]) => [k, typeof v === 'string' ? escape(v) : v]));
    const link = '/cam-view?' + new URLSearchParams({nodeId:alert.nodeId,alertId:alert._id});
    return `<article class="alert-card priority-${a.priority}" id="alert-card-${a._id}"><div class="alert-card-header"><div class="alert-badges"><span class="badge badge-${a.emergencyType}">${a.emergencyType}</span><span class="badge">${a.threatStatus.replaceAll('_',' ')}</span><span class="badge">${a.status}${a.acknowledgedBy ? ' · ' + a.acknowledgedBy : ''}</span></div><time class="alert-time">${escape(new Date(alert.timestamp).toLocaleString())}</time></div><div class="alert-card-body"><div class="alert-location"><div><strong class="location-room">${a.room}</strong><div class="location-building">${a.building}${window.isLegacyBuilding(alert.building) ? ' · Recorded building needs review' : ''}</div></div><span class="location-node">${a.nodeId}</span></div></div><div class="alert-card-actions"><a class="btn btn-sm btn-outline" href="${escape(link)}">Review incident →</a><div class="alert-action-btns">${alert.status === 'new' ? `<button class="btn btn-sm btn-warning alert-action-trigger" data-alert-id="${a._id}" data-action="acknowledge">Acknowledge</button>` : ''}${alert.status !== 'resolved' ? `<button class="btn btn-sm btn-success alert-action-trigger" data-alert-id="${a._id}" data-action="resolve">Resolve</button>` : '<span>Incident closed</span>'}</div></div></article>`;
  }
  function renderEmptyState() {
    const empty = byId('alertEmptyState');
    const connected = Number(empty.dataset.connected), total = Number(empty.dataset.total);
    const filtered = feed.counts.unresolved > 0;
    byId('radarTitle').textContent = filtered ? 'No matching incidents' : 'No open incidents';
    byId('radarDescription').textContent = filtered
      ? feed.counts.unresolved + ' open incidents in this building selection. Try another type, status, or search.'
      : connected === 0 ? 'No nodes connected. Monitoring coverage is unavailable.'
      : connected < total ? connected + ' of ' + total + ' nodes connected. Some monitoring coverage is unavailable.'
      : 'No open incidents reported by the connected campus nodes.';
  }
  function render(next, nodes) {
    feed = next;
    // Reuse stable DOM when a poll has no changes, preserving keyboard focus on incident actions.
    for (const [id, alerts] of [['alertFeedList',feed.alerts],['resolvedFeed',feed.history]]) {
      const html = alerts.map(card).join(''); if (byId(id).dataset.content !== html) { byId(id).innerHTML = html; byId(id).dataset.content = html; }
    }
    byId('alertEmptyState').hidden = feed.alerts.length > 0; byId('resolvedEmpty').hidden = feed.history.length > 0;
    byId('openIncidentCount').textContent = feed.alerts.length + ' matching · ' + feed.counts.unresolved + ' open in this building selection';
    byId('historyPage').textContent = `Page ${feed.historyPage} of ${feed.historyPages} · ${feed.historyTotal} matching resolved incidents`;
    byId('historySummary').textContent = `Browse resolved incidents (${feed.historyTotal} matching)`;
    byId('historyPrevious').disabled = feed.historyPage <= 1; byId('historyNext').disabled = feed.historyPage >= feed.historyPages;
    for (const type of ['gunshot','medical','fire']) byId('count-' + type).textContent = feed.counts[type];
    if (nodes) {
      const selected = window.filterBuilding(nodes), connected = selected.filter(n => n.video?.cameraConnected || n.audio?.connected).length;
      byId('count-active-nodes').textContent = connected + ' / ' + selected.length;
      byId('alertEmptyState').dataset.connected = connected;
      byId('alertEmptyState').dataset.total = selected.length;
      byId('footerActiveNodes').textContent = connected + ' NODES CONNECTED';
    }
    renderEmptyState();
    byId('outsideIncidents').innerHTML = `${feed.outsideOpen} open incidents outside this building selection. <a href="/notifications">Campus-wide notifications →</a>`;
    const threat = feed.latestThreat;
    byId('dashboardThreat').innerHTML = threat ? `<div class="latest-threat-banner"><div><strong>Verified ${escape(threat.emergencyType)} · ${escape(threat.room)}</strong><p>${escape(threat.building)}</p></div><a class="btn btn-danger" href="${escape('/cam-view?' + new URLSearchParams({nodeId:threat.nodeId,alertId:threat._id}))}">Review incident →</a></div>` : '';
  }
  render(feed);
  window.addEventListener('campus:state', ({detail}) => {
    if (detail.dashboard) render(detail.dashboard, detail.nodes);
    const updated = 'Updated ' + new Date().toLocaleTimeString();
    byId('dashboardConnection').textContent = updated;
    byId('radarConnection').textContent = 'Live feed · ' + updated.toLowerCase();
    byId('alertEmptyState').classList.remove('is-offline');
    byId('dashboardConnection').classList.remove('is-offline');
  });
  window.addEventListener('campus:offline', () => {
    byId('dashboardConnection').textContent = 'Updates interrupted. Showing the last received reports.';
    byId('dashboardConnection').classList.add('is-offline');
    byId('alertEmptyState').classList.add('is-offline');
    byId('radarConnection').textContent = 'Live feed interrupted · last received reports';
    byId('radarTitle').textContent = 'Live updates interrupted';
    byId('radarDescription').textContent = 'Connection unavailable. The last received reports remain visible.';
  });
});
