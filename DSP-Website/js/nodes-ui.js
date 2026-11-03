document.addEventListener('DOMContentLoaded', () => {
  const escape = window.escapeHtml;
  const dialog = document.getElementById('nodeDialog');
  const grid = document.getElementById('cctvGrid');
  const list = document.getElementById('setupNodeList');
  const editForm = document.getElementById('editNodeForm');
  const createForm = document.getElementById('createNodeForm');
  let nodes = [];
  let receiver = {};
  let selectedId = null;
  let previewId = null;
  let filter = 'all';
  let busy = false;
  let expiresAt = null;
  const previews = new Map();
  const fetching = new Set();
  const generations = new WeakMap();
  // Only the node ID enters the URL. Pairing instructions cross the navigation
  // in this tab's storage and are removed as soon as the CCTV page loads.
  let createdNodeId = grid ? new URLSearchParams(window.location.search).get('created') : null;
  let createdNodePairing = null;
  if (createdNodeId) {
    try {
      const key = `cp_createdNode:${createdNodeId}`;
      const saved = sessionStorage.getItem(key);
      sessionStorage.removeItem(key);
      if (saved) createdNodePairing = JSON.parse(saved);
    } catch { /* Pairing can still be regenerated from the node dialog. */ }
  }

  async function api(url, method = 'GET', body) {
    const response = await fetch(url, { method, cache: 'no-store',
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(12000) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || data.error || 'Request failed');
    return data;
  }
  function title(node) { return node.name || node.nodeId; }
  function location(node) { return `${node.building}, ${node.room}`; }
  function status(node) { return node.video?.status || 'offline'; }
  function message(text, error = false) {
    const element = document.getElementById('nodeActionMessage');
    if (element) { element.textContent = text; element.classList.toggle('node-error', error); }
  }
  async function action(fn) {
    if (busy) return;
    busy = true;
    dialog?.querySelectorAll('button:not(#closeNodeDialog)').forEach(button => button.disabled = true);
    message('Updating node…');
    try { await fn(); await window.refreshCampus(); }
    catch (error) { message(error.message, true); }
    finally { busy = false; dialog?.querySelectorAll('button').forEach(button => button.disabled = false); renderDialog(); }
  }

  function micSymbol(muted) {
    return `<svg class="audio-mic-symbol" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8"/>${muted ? '<path d="M3 3l18 18"/>' : ''}</svg>`;
  }
  function audioText(node) {
    const phoneAudio = node?.phoneAudio || node?.audioCNN;
    if (phoneAudio && phoneAudio.class && phoneAudio.class !== 'Idle') {
      const pct = Math.round((phoneAudio.confidence || 0) * 100);
      if (phoneAudio.alert) {
        return ⚠️  DETECTED (%);
      }
      return Audio:  (%);
    }
    const audio = node?.audio;
    if (!audio?.paired) return 'Audio · Phone Mic / ESP32';
    if (audio.muted) return audio.connected ? 'Audio muted' : 'Audio muted · ESP32 offline';
    return audio.connected ? 'ESP32 connected · Raw audio unavailable' : 'Audio · ESP32 offline';
  }
  function updateAudioBadge(viewport, node) {
    const badge = viewport?.querySelector('.node-muted');
    if (!badge) return;
    const phoneAudio = node?.phoneAudio || node?.audioCNN;
    if (phoneAudio?.alert) {
      badge.style.background = '#dc2626';
      badge.style.color = '#ffffff';
      badge.style.fontWeight = 'bold';
    } else {
      badge.style.background = '';
      badge.style.color = '';
      badge.style.fontWeight = '';
    }
    badge.dataset.muted = Boolean(node?.audio?.muted);
    badge.innerHTML = micSymbol(Boolean(node?.audio?.muted)) + <span></span>;
  }
  function espMessage(text, error = false) {
    const element = document.getElementById('esp32PairMessage');
    if (element) { element.textContent = text; element.classList.toggle('node-error', error); }
  }
  function renderAudio(node) {
    const state = document.getElementById('esp32AudioState');
    if (!state) return;
    const paired = Boolean(node.audio?.paired);
    const muted = Boolean(node.audio?.muted);
    state.dataset.muted = muted;
    state.innerHTML = micSymbol(muted) + `<span>${escape(audioText(node))}</span>`;
    document.getElementById('esp32DeviceStatus').textContent = paired ?
      `${node.audio.deviceId} · ${node.audio.connected ? 'Connected' : 'Offline'} · Location comes from this node.` :
      'Connect the ESP32 to the same network, scan, then enter the PIN shown on its Serial Monitor.';
    const mute = document.getElementById('muteEsp32Btn');
    if (mute) { mute.disabled = busy || !paired; mute.setAttribute('aria-pressed', String(muted)); mute.innerHTML = micSymbol(muted) + (muted ? ' Unmute audio' : ' Mute audio'); }
    const disconnect = document.getElementById('disconnectEsp32Btn');
    if (disconnect) disconnect.disabled = busy || !paired;
    const scan = document.getElementById('scanEsp32Btn');
    if (scan) { scan.hidden = paired; scan.disabled = busy; }
    const form = document.getElementById('esp32PairForm');
    if (form) form.hidden = paired;
  }
  async function loadAvailableEsp32() {
    const select = document.getElementById('esp32Device');
    if (!select || !dialog?.open) return;
    const id = selectedId;
    const scan = document.getElementById('scanEsp32Btn');
    scan.disabled = true;
    espMessage('Scanning announced ESP32 devices…');
    try {
      const result = await api('/api/esp32/available');
      if (selectedId !== id || !dialog.open) return;
      const previous = select.value;
      select.replaceChildren();
      const placeholder = new Option(result.devices.length ? 'Choose an ESP32' : 'No available ESP32 found', '');
      select.append(placeholder);
      for (const device of result.devices) select.append(new Option(device.deviceId, device.deviceId));
      if (result.devices.some(device => device.deviceId === previous)) select.value = previous;
      else if (result.devices.length === 1) select.value = result.devices[0].deviceId;
      espMessage(result.devices.length ? 'Enter the current 8-digit PIN shown on the selected ESP32.' :
        'No available ESP32 found. Check Wi-Fi, USB provisioning and website address, then scan again.');
    } catch (error) { if (selectedId === id && dialog.open) espMessage(error.message, true); }
    finally { if (selectedId === id && dialog.open) scan.disabled = busy; }
  }

  function stopPreview(viewport) {
    if (!viewport) return;
    previews.delete(viewport);
    generations.set(viewport, (generations.get(viewport) || 0) + 1);
    const image = viewport.querySelector('img');
    image.hidden = true;
    image.removeAttribute('src');
    if (image.dataset.objectUrl) URL.revokeObjectURL(image.dataset.objectUrl);
    delete image.dataset.objectUrl;
    delete image.dataset.streaming;
    viewport.querySelector('.node-idle').hidden = false;
  }
  function updatePreview(viewport, node) {
    if (!viewport) return;
    updateAudioBadge(viewport, node);
    const image = viewport.querySelector('img');
    const idle = viewport.querySelector('.node-idle');
    const live = node?.video?.live && !document.hidden;
    if (!live) {
      stopPreview(viewport);
      idle.querySelector('strong').textContent = status(node || {}) === 'processing' ? 'Camera connected · Model processing' :
        status(node || {}) === 'error' ? 'Model processing unavailable' : 'Camera is currently inactive';
      idle.querySelector('span:last-child').textContent = node ? `${title(node)} · ${location(node)}` : 'Create a node and connect the Campus Panic Camera app.';
      return;
    }
    previews.set(viewport, node.nodeId);
  }
  // Short HTTP requests avoid the browser's per-host limit on persistent streams.
  // At most three requests run together, regardless of the number of visible feeds.
  async function fetchPreview(viewport, id) {
    if (fetching.has(viewport)) return;
    fetching.add(viewport);
    const generation = generations.get(viewport) || 0;
    try {
      const response = await fetch(`/media/nodes/${encodeURIComponent(id)}/frame.jpg`, {
        cache: 'no-store', signal: AbortSignal.timeout(2500) });
      if (!response.ok) throw new Error('No fresh video');
      const blob = await response.blob();
      if (previews.get(viewport) !== id || (generations.get(viewport) || 0) !== generation || document.hidden) return;
      const image = viewport.querySelector('img');
      const old = image.dataset.objectUrl;
      const url = URL.createObjectURL(blob);
      image.dataset.objectUrl = url;
      image.src = url;
      image.hidden = false;
      viewport.querySelector('.node-idle').hidden = true;
      if (old) URL.revokeObjectURL(old);
    } catch { if (previews.get(viewport) === id && (generations.get(viewport) || 0) === generation) stopPreview(viewport); }
    finally { fetching.delete(viewport); }
  }
  let frameBatchRunning = false;
  setInterval(async () => {
    if (frameBatchRunning || document.hidden) return;
    frameBatchRunning = true;
    try {
      const queue = [...previews];
      const consumer = async () => { while (queue.length) { const [viewport, id] = queue.shift(); await fetchPreview(viewport, id); } };
      await Promise.all([consumer(), consumer(), consumer()]);
    } finally { frameBatchRunning = false; }
  }, 250);
  function details(element, node) {
    if (!element) return;
    if (!node) { element.textContent = 'Node is no longer available.'; return; }
    const video = node.video || {};
    const detections = video.detections || [];
    const best = detections.length ? Math.max(...detections.map(d => d.confidence)) : null;
    const values = {
      'Node ID': node.nodeId,
      'Video status': status(node).toUpperCase(),
      'Last processed frame': video.predictedAt ? new Date(video.predictedAt).toLocaleTimeString() : 'No fresh output',
      'Resolution': video.width ? `${video.width} × ${video.height}` : '—',
      'Inference': video.inferenceMs != null ? `${video.inferenceMs} ms` : '—',
      'Frame age': video.frameAgeMs != null ? `${video.frameAgeMs} ms` : '—',
      'Model result': video.live ? best !== null ? `Gun detected · ${(best * 100).toFixed(1)}%` : 'No gun detected in current frame' : 'Waiting for fresh model output',
      'Audio': audioText(node)
    };
    element.innerHTML = Object.entries(values).map(([label, value]) => `<div><dt>${escape(label)}</dt><dd>${escape(value)}</dd></div>`).join('');
  }
  function createViewport() {
    return '<div class="node-viewport"><img hidden alt="Live security node video"><div class="node-idle"><span class="camera-symbol">◉</span><strong>Camera is currently inactive</strong><span>Waiting for a phone connection</span></div><span class="node-muted">🔇 Audio not configured</span></div>';
  }
  function renderGrid() {
    if (!grid) return;
    const visible = nodes.filter(node => filter === 'all' || (filter === 'live' ? node.video?.live : !node.video?.cameraConnected));
    const ids = new Set(visible.map(node => node.nodeId));
    [...grid.children].forEach(card => { if (!ids.has(card.dataset.nodeId)) { stopPreview(card.querySelector('.node-viewport')); card.remove(); } });
    for (const node of visible) {
      let card = [...grid.children].find(card => card.dataset.nodeId === node.nodeId);
      if (!card) {
        card = document.createElement('button');
        card.type = 'button';
        card.className = 'security-cctv-card';
        card.dataset.nodeId = node.nodeId;
        card.innerHTML = createViewport() + '<div class="node-card-heading"><strong></strong><span class="node-state"></span></div><div class="node-card-location"></div><div class="node-card-stats"><span class="node-card-model"></span><span class="node-card-time"></span></div>';
        card.addEventListener('click', () => openNode(node.nodeId));
        grid.append(card);
      }
      card.setAttribute('aria-label', `View ${title(node)}, ${status(node)}`);
      card.querySelector('.node-card-heading strong').textContent = title(node);
      const badge = card.querySelector('.node-state');
      badge.textContent = status(node).toUpperCase(); badge.dataset.live = Boolean(node.video?.live);
      card.querySelector('.node-card-location').textContent = location(node);
      const result = node.video?.detections || [];
      card.querySelector('.node-card-model').textContent = node.video?.live ? (result.length ? `Gun detected · ${(Math.max(...result.map(d => d.confidence)) * 100).toFixed(1)}%` : 'Model running · No gun detected') : 'Awaiting fresh video';
      card.querySelector('.node-card-time').textContent = node.video?.inferenceMs != null ? `${node.video.inferenceMs} ms inference` : node.nodeId;
      updatePreview(card.querySelector('.node-viewport'), node);
    }
    document.getElementById('cctvEmpty').hidden = visible.length > 0;
    document.getElementById('cctvSummary').textContent = `${nodes.filter(n => n.video?.live).length} live cameras / ${nodes.length} nodes · ${nodes.filter(n => n.audio?.connected).length} ESP32 connected`;
  }
  function renderList() {
    if (!list) return;
    list.replaceChildren();
    document.getElementById('nodeCount').textContent = `${nodes.length} nodes`;
    if (!nodes.length) { const empty = document.createElement('p'); empty.className = 'nodes-hint'; empty.textContent = 'No nodes yet. Create your first node to connect a phone.'; list.append(empty); }
    for (const node of nodes) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'setup-node-button';
      button.innerHTML = `<span><strong>${escape(title(node))}</strong><small>${escape(location(node))} · ${escape(audioText(node))}</small></span><span class="node-state" data-live="${Boolean(node.video?.live)}">${escape(status(node).toUpperCase())} →</span>`;
      button.addEventListener('click', () => { previewId = node.nodeId; updatePreview(document.getElementById('setupPreview'), node); openNode(node.nodeId); });
      list.append(button);
    }
    previewId = nodes.some(n => n.nodeId === previewId) ? previewId : nodes[0]?.nodeId;
    updatePreview(document.getElementById('setupPreview'), nodes.find(n => n.nodeId === previewId));
  }
  function renderDialog() {
    if (!dialog?.open) return;
    const node = nodes.find(n => n.nodeId === selectedId);
    if (!node) { dialog.close(); return; }
    document.getElementById('nodeDialogTitle').textContent = title(node);
    document.getElementById('nodeDialogLocation').textContent = location(node);
    updatePreview(document.getElementById('dialogPreview'), node);
    details(document.getElementById('nodeLiveDetails'), node);
    renderAudio(node);
  }
  function openNode(id, pairing, addresses) {
    const node = nodes.find(n => n.nodeId === id);
    if (!node) return;
    selectedId = id;
    expiresAt = null;
    document.getElementById('pairingPanel')?.setAttribute('hidden', '');
    if (editForm) for (const key of ['name', 'building', 'room', 'lat', 'lng']) editForm.elements[key].value = node[key] ?? '';
    message('');
    espMessage('');
    const pin = document.getElementById('esp32Pin'); if (pin) pin.value = '';
    if (!dialog.open) dialog.showModal();
    renderDialog();
    if (pairing && editForm) showPairing(pairing, addresses);
    if (!node.audio?.paired) loadAvailableEsp32();
  }
  function showPairing(pairing, addresses = []) {
    document.getElementById('pairingPanel').hidden = false;
    document.getElementById('pairingCode').textContent = pairing.code;
    expiresAt = new Date(pairing.expiresAt).getTime();
    const container = document.getElementById('pairingAddresses'); container.replaceChildren();
    for (const address of addresses) { const line = document.createElement('code'); line.className = 'pairing-address'; line.textContent = address; container.append(line); }
    if (!addresses.length) container.textContent = 'No Wi-Fi address found. Connect the laptop to your local network, then reopen connection setup.';
    updateExpiry();
  }
  function updateExpiry() {
    if (!expiresAt) return;
    const remaining = Math.ceil((expiresAt - Date.now()) / 1000);
    document.getElementById('pairingExpiry').textContent = remaining > 0 ? `New connections allowed for ${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')}` : 'Code expired for new connections. Generate a new code to pair again.';
    if (remaining <= 0) document.getElementById('pairingCode').textContent = 'Expired';
  }
  setInterval(updateExpiry, 1000);
  document.getElementById('closeNodeDialog')?.addEventListener('click', () => dialog.close());
  dialog?.addEventListener('close', () => {
    stopPreview(document.getElementById('dialogPreview'));
    expiresAt = null;
    const code = document.getElementById('pairingCode'); if (code) code.textContent = '';
    const pin = document.getElementById('esp32Pin'); if (pin) pin.value = '';
  });
  document.getElementById('scanEsp32Btn')?.addEventListener('click', loadAvailableEsp32);
  document.getElementById('esp32PairForm')?.addEventListener('submit', event => {
    event.preventDefault();
    const id = selectedId;
    const deviceId = document.getElementById('esp32Device').value;
    const pin = document.getElementById('esp32Pin').value;
    action(async () => {
      try {
        await api(`/api/esp32/pair/${encodeURIComponent(id)}`, 'POST', { deviceId, pin });
        if (selectedId === id && dialog.open) {
          document.getElementById('esp32Pin').value = '';
          espMessage('ESP32 paired to this node.');
          message('ESP32 connected to this node.');
        }
      } catch (error) { if (selectedId === id && dialog.open) espMessage(error.message, true); throw error; }
    });
  });
  document.getElementById('muteEsp32Btn')?.addEventListener('click', () => {
    const id = selectedId;
    const node = nodes.find(node => node.nodeId === id);
    if (!node?.audio?.paired) return;
    action(async () => {
      const result = await api(`/api/esp32/nodes/${encodeURIComponent(id)}/mute`, 'PATCH', { muted: !node.audio.muted });
      if (selectedId === id && dialog.open) {
        espMessage(result.muted ? 'Audio mute saved.' : 'Audio unmute saved.');
        message('Audio setting saved; the ESP32 updates on its next heartbeat.');
      }
    });
  });
  document.getElementById('disconnectEsp32Btn')?.addEventListener('click', () => {
    const id = selectedId;
    action(async () => {
      await api(`/api/esp32/nodes/${encodeURIComponent(id)}`, 'DELETE');
      if (selectedId === id && dialog.open) {
        espMessage('ESP32 disconnected. It will show a new PIN when it checks in again.');
        message('ESP32 disconnected; phone camera connection is unchanged.');
      }
    });
  });
  dialog?.addEventListener('click', event => { if (event.target === dialog) {
    const rect = dialog.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
  } });
  createForm?.addEventListener('submit', async event => {
    event.preventDefault();
    const button = createForm.querySelector('button[type=submit]'); button.disabled = true;
    const error = document.getElementById('createNodeError'); error.textContent = '';
    try {
      const result = await api('/api/nodes', 'POST', Object.fromEntries(new FormData(createForm)));
      const id = result.node.nodeId;
      try {
        sessionStorage.setItem(`cp_createdNode:${id}`, JSON.stringify({
          pairing: result.pairing, addresses: result.addresses
        }));
      } catch { /* Continue to CCTV even if this browser blocks tab storage. */ }
      window.location.assign(`/cameras?created=${encodeURIComponent(id)}`);
    } catch (failure) { error.textContent = failure.message; }
    finally { button.disabled = false; }
  });
  editForm?.addEventListener('submit', event => {
    event.preventDefault();
    const id = selectedId;
    const values = Object.fromEntries(new FormData(editForm));
    action(async () => {
      await api(`/api/nodes/${encodeURIComponent(id)}`, 'PUT', values);
      message('Node details saved.');
    });
  });
  document.getElementById('pairNodeBtn')?.addEventListener('click', () => {
    const id = selectedId;
    action(async () => {
      const result = await api(`/api/nodes/${encodeURIComponent(id)}/pairing`, 'POST');
      if (selectedId === id && dialog.open) { showPairing(result.pairing, result.addresses); message('Enter this new code in the phone app and start its camera.'); }
      document.querySelectorAll('.node-viewport').forEach(stopPreview);
    });
  });
  document.getElementById('disconnectNodeBtn')?.addEventListener('click', () => {
    const id = selectedId;
    action(async () => { await api(`/api/nodes/${encodeURIComponent(id)}/disconnect`, 'POST');
      document.getElementById('pairingPanel').hidden = true; expiresAt = null; message('Phone disconnected. Pair again when ready.');
      document.querySelectorAll('.node-viewport').forEach(stopPreview); });
  });
  document.getElementById('deleteNodeBtn')?.addEventListener('click', () => {
    const id = selectedId;
    const node = nodes.find(n => n.nodeId === id);
    if (!window.confirm(`Delete ${title(node)} and disconnect its phone? Recorded incident history will remain.`)) return;
    action(async () => { await api(`/api/nodes/${encodeURIComponent(id)}`, 'DELETE'); nodes = nodes.filter(n => n.nodeId !== id); dialog.close(); renderGrid(); renderList(); window.showToast('Security node deleted', 'success'); });
  });
  document.querySelectorAll('[data-node-filter]').forEach(button => button.addEventListener('click', () => {
    filter = button.dataset.nodeFilter;
    document.querySelectorAll('[data-node-filter]').forEach(item => item.classList.toggle('active', item === button));
    renderGrid();
  }));
  const singlePage = document.getElementById('singleNodePage');
  document.getElementById('manageSelectedNode')?.addEventListener('click', () => openNode(singlePage.dataset.nodeId));
  window.addEventListener('campus:state', ({ detail }) => {
    nodes = detail.nodes; receiver = detail.receiver;
    const banner = document.getElementById('receiverStatus');
    if (banner) {
      if (receiver.ready) {
        banner.innerHTML = '<span class="receiver-dot-live">●</span> Video model ready · Pair ESP32 devices from each node’s Audio section';
      } else {
        const safeMsg = escape(receiver.message || 'Model service unavailable');
        banner.innerHTML = '<span class="receiver-warn-icon">⚠</span> ' + safeMsg.replace(/\b(VIDEO_PYTHON|VIDEO_MODEL_PATH)\b/g, '<code>$1</code>');
      }
      banner.dataset.ready = receiver.ready;
    }
    renderGrid(); renderList(); renderDialog();
    if (createdNodeId && nodes.some(node => node.nodeId === createdNodeId)) {
      openNode(createdNodeId, createdNodePairing?.pairing, createdNodePairing?.addresses);
      message(createdNodePairing?.pairing ? 'Node created. Enter this code in the phone app to connect it.' :
        'Node created. Use Reconnect / Pair Again to generate a pairing code.');
      createdNodeId = null;
      createdNodePairing = null;
      window.history.replaceState(null, '', '/cameras');
    }
    if (singlePage) {
      const node = nodes.find(n => n.nodeId === singlePage.dataset.nodeId);
      updatePreview(document.getElementById('singlePreview'), node);
      details(document.getElementById('singleLiveDetails'), node);
    }
  });
  function offline() {
    document.querySelectorAll('.node-viewport').forEach(stopPreview);
    const banner = document.getElementById('receiverStatus');
    if (banner) { banner.innerHTML = '<span class="receiver-warn-icon">⚠</span> Connection interrupted. Waiting for the laptop website…'; banner.dataset.ready = false; }
  }
  window.addEventListener('campus:offline', offline);
  document.addEventListener('visibilitychange', () => { if (document.hidden) document.querySelectorAll('.node-viewport').forEach(stopPreview); });
  window.addEventListener('pagehide', () => document.querySelectorAll('.node-viewport').forEach(stopPreview));
});
