import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

test('Android CCTV, HUD telemetry, manual ESP32 reporting and detection incidents', { timeout: 90000 }, async t => {
  process.env.NODE_ENV = 'test';
  for (const name of ['JWT_SECRET', 'DEVICE_API_KEY', 'ADMIN_PASSWORD']) process.env[name] = randomBytes(32).toString('hex');
  const memory = await MongoMemoryServer.create();
  process.env.MONGODB_URI = memory.getUri('threat_response');
  await mongoose.connect(process.env.MONGODB_URI);
  const { app } = await import('../server.js');
  const { Node } = await import('../models/Node.js');
  const { User } = await import('../models/User.js');
  const { Alert } = await import('../models/Alert.js');
  const { EspDevice } = await import('../models/EspDevice.js');
  const { videoService } = await import('../services/videoService.js');
  const { audioService } = await import('../services/audioService.js');
  const { hashCode } = await import('../services/nodePairing.js');
  const { default: http } = await import('node:http');
  await Promise.all([Node.init(), Alert.init(), EspDevice.init()]);
  const admin = await User.create({ name: 'Test operator', email: 'response@test.invalid',
    passwordHash: 'test-fixture', role: 'admin', isActive: true });
  const cookie = 'token=' + jwt.sign({ id: String(admin._id) }, process.env.JWT_SECRET);
  const cameraCode = '12345678';
  await Node.create([
    { nodeId: 'NODE-A', name: 'Entrance', building: 'Lab', room: '101', lat: 14.5, lng: 121,
      videoEnabled: true, pairingHash: hashCode(cameraCode), pairingExpiresAt: new Date(Date.now() + 60000) },
    { nodeId: 'NODE-B', name: 'Library', building: 'Lab', room: '102', videoEnabled: false }
  ]);
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (path, { method = 'GET', body, headers = {}, auth = false, raw } = {}) => fetch(base + path, {
    method, headers: { ...(auth ? { Cookie: cookie } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: raw || (body ? JSON.stringify(body) : undefined), signal: AbortSignal.timeout(10000)
  });
  const token = randomBytes(32).toString('hex');
  const deviceId = 'ESP-001122334455';
  const deviceHeaders = { 'X-ESP32-Token': token };
  const physical = event => request('/api/esp32/alert', { method: 'POST', headers: deviceHeaders,
    body: { deviceId, nodeId: 'NODE-A', ...event } });
  const live = async () => (await (await request('/api/live', { auth: true })).json()).nodes;
  let phoneHeaders;
  try {
    await t.test('existing pairing is retained and no incoming ESP32 command endpoint exists', async () => {
      assert.equal((await physical({ emergencyType: 'fire', sequenceNumber: 1 })).status, 401);
      assert.equal((await request('/api/esp32/register', { method: 'POST', headers: deviceHeaders,
        body: { deviceId, pinHash: createHash('sha256').update('87654321').digest('hex') } })).status, 200);
      assert.equal((await request('/api/esp32/pair/NODE-A', { auth: true, method: 'POST', body: { deviceId, pin: '87654321' } })).status, 200);
      assert.equal((await request('/api/esp32/control/sync', { method: 'POST', headers: deviceHeaders,
        body: { deviceId, nodeId: 'NODE-A' } })).status, 404);
      const a = (await live()).find(node => node.nodeId === 'NODE-A');
      assert.equal(a.hud.hardware.connected, true);
      assert.equal(a.hud.threats.fire, false);
      assert.equal(a.hud.threats.smoke, null, 'unobserved smoke must not claim clear');
      assert.equal(a.hud.batteryPercentage, null);
    });
    await t.test('all three manual button events and smoke events appear on their assigned website node', async () => {
      for (const [i, emergencyType] of ['fire', 'medical', 'gunshot'].entries()) {
        assert.equal((await physical({ emergencyType, source: 'manual_button', sequenceNumber: i + 1 })).status, 200);
      }
      let a = (await live()).find(node => node.nodeId === 'NODE-A');
      assert.deepEqual(a.hud.threats, { smoke: null, fire: true, medical: true, shooting: true });
      assert.equal((await physical({ emergencyType: 'fire', source: 'smoke_sensor', sequenceNumber: 4 })).status, 200);
      const nodes = await live();
      a = nodes.find(node => node.nodeId === 'NODE-A');
      assert.equal(a.hud.threats.smoke, true);
      assert.deepEqual(nodes.find(node => node.nodeId === 'NODE-B').hud.threats,
        { smoke: null, fire: false, medical: false, shooting: false });
    });
    await t.test('paired Android frames reach authenticated CCTV without a model worker', async () => {
      assert.equal(videoService.ready, false);
      const connected = await request('/api/camera/connect', { method: 'POST', headers: { 'X-Camera-Token': cameraCode } });
      assert.equal(connected.status, 201);
      const sessionId = (await connected.json()).sessionId;
      phoneHeaders = { 'X-Camera-Token': cameraCode, 'X-Camera-Session': sessionId };
      const jpeg = await readFile(new URL('fixtures/blank.jpg', import.meta.url));
      const response = await request('/api/camera/frame', { method: 'POST', raw: jpeg,
        headers: { ...phoneHeaders, 'Content-Type': 'image/jpeg', 'X-Camera-Battery': '73', 'X-Camera-Network': 'wifi' } });
      assert.equal(response.status, 200);
      const data = await response.json();
      assert.equal(data.hud.batteryPercentage, 73);
      assert.equal(data.hud.network, 'wifi');
      assert.equal(data.hud.threats.medical, true);
      assert.equal(data.inferenceAvailable, false);
      assert.equal((await request('/media/nodes/NODE-A/frame.jpg')).status, 401);
      const frame = await request('/media/nodes/NODE-A/frame.jpg', { auth: true });
      assert.equal(frame.status, 200);
      assert.deepEqual(Buffer.from(await frame.arrayBuffer()), jpeg);
      const a = (await live()).find(node => node.nodeId === 'NODE-A');
      assert.equal(a.video.live, true);
      assert.equal(a.hud.batteryPercentage, 73);
    });
    await t.test('gun detections create one active website incident without controlling ESP32 LEDs', async () => {
      const manualGun = await Alert.findOne({ emergencyType: 'gunshot', triggerSource: 'manual_button' });
      await request('/api/alerts/' + manualGun._id, { auth: true, method: 'PATCH', body: { action: 'resolve' } });
      const payload = { detections: [{ label: 'gun', confidence: 0.87, box: [0.1, 0.2, 0.5, 0.6] }], inferenceMs: 20 };
      const detected = await Promise.all([1, 2, 3].map(() => request('/api/camera/detection', { method: 'POST', headers: phoneHeaders, body: payload })));
      assert.ok(detected.every(response => response.status === 200));
      assert.equal(await Alert.countDocuments({ triggerSource: 'camera_detection', status: { $ne: 'resolved' } }), 1);
      assert.equal((await live()).find(node => node.nodeId === 'NODE-A').hud.threats.shooting, true);
      assert.equal((await live()).find(node => node.nodeId === 'NODE-B').hud.threats.shooting, false);
      assert.equal((await request('/api/camera/detection', { method: 'POST', headers: phoneHeaders,
        body: { detections: [{ label: 'person', confidence: 0.99, box: [1, 2, 3, 4] }] } })).status, 200);
      assert.equal(videoService.sessions.get('NODE-A').clientDetections.detections.length, 0);
      const alert = await Alert.findOne({ triggerSource: 'camera_detection', status: 'new' });
      assert.equal((await request('/api/alerts/' + alert._id, { auth: true, method: 'PATCH', body: { action: 'resolve' } })).status, 200);
      assert.equal((await live()).find(node => node.nodeId === 'NODE-A').hud.threats.shooting, false);
      assert.equal((await request('/api/camera/detection', { method: 'POST', headers: phoneHeaders, body: payload })).status, 200);
      assert.equal(await Alert.countDocuments({ triggerSource: 'camera_detection' }), 2, 'new incident after resolution');
    });
    await t.test('laptop-model detections create map incidents without requiring an open map', async () => {
      const previous = await Alert.findOne({ triggerSource: 'camera_detection', status: 'new' });
      await request('/api/alerts/' + previous._id, { auth: true, method: 'PATCH', body: { action: 'resolve' } });
      const session = videoService.sessions.get('NODE-A');
      session.workerConnected = true;
      session.activity = Date.now();
      const detection = { label: 'gun', confidence: 0.9, box: [10, 20, 100, 200] };
      await videoService.recordWorkerThreats({ 'NODE-A': { live: true, frameAgeMs: 4000, detections: [detection] } });
      assert.equal((await live()).find(node => node.nodeId === 'NODE-A').hud.threats.shooting, false, 'stale model results cannot create incidents');
      await videoService.recordWorkerThreats({ 'NODE-A': { live: true, frameAgeMs: 50, detections: [detection] } });
      assert.equal((await live()).find(node => node.nodeId === 'NODE-A').hud.threats.shooting, true);
      session.workerConnected = false;
    });
    await t.test('audio gunshots persist valid confidence values and appear on the website', async () => {
      await audioService.recordResult('NODE-A', { class: 'Gunshot', confidence: 0.88, alert: true, timestamp: Date.now() });
      await audioService.recordResult('NODE-A', { class: 'Gunshot', confidence: 0.9, alert: true, timestamp: Date.now() });
      const alerts = await Alert.find({ triggerSource: 'audio_detection', emergencyType: 'gunshot' });
      assert.equal(alerts.length, 1);
      assert.equal(alerts[0].audioConfidence, 0.88);
      assert.equal((await live()).find(node => node.nodeId === 'NODE-A').hud.threats.shooting, true);
    });
    await t.test('navigation renders requested categories and preserves Security Nodes pairing controls', async () => {
      const html = await (await request('/active-threats-map', { auth: true })).text();
      for (const label of ['Main Items', 'Dashboard', 'Cam View', 'All Cams (CCTV)', 'CAMPUS GEOMETRY', 'Campus Map',
        'Active Threats Map', 'LIVE', 'GATEWAY TOOLS', 'Security Nodes', 'SYSTEM &amp; ACCOUNT', 'Profile', 'Settings', 'ADMINISTRATION', 'User Management']) {
        assert.ok(html.includes(label), label);
      }
      assert.equal((await request('/active-nodes-map', { auth: true })).status, 200);
      const nodes = await (await request('/security-nodes', { auth: true })).text();
      assert.match(nodes, /id="createNodeForm"/);
      assert.match(nodes, /id="esp32PairForm"/);
      assert.match(nodes, /\/js\/camera-hud.js/);
    });
    await t.test('older unresolved threats remain in the active map snapshot beyond the feed limit', async () => {
      await Alert.insertMany(Array.from({ length: 105 }, (_, i) => ({ nodeId: 'NODE-B', building: 'Lab', room: '102',
        emergencyType: 'medical', threatStatus: 'manual_alert', priority: 2, sequenceNumber: i + 1,
        checksum: 'isolated-test', status: 'resolved', timestamp: new Date(Date.now() + i + 1000) })));
      const data = await (await request('/api/live', { auth: true })).json();
      assert.equal(data.alerts.length, 100);
      assert.ok(data.activeAlerts.some(alert => alert.nodeId === 'NODE-A' && alert.triggerSource === 'smoke_sensor'));
      assert.ok(data.activeAlerts.every(alert => alert.status !== 'resolved'));
    });
    await t.test('unpairing revokes physical alert access and stale battery data is unavailable', async () => {
      videoService.sessions.get('NODE-A').telemetry.receivedAt -= 6000;
      const a = (await live()).find(node => node.nodeId === 'NODE-A');
      assert.equal(a.hud.batteryPercentage, null);
      assert.equal(a.hud.network, 'offline');
      assert.equal((await request('/api/esp32/nodes/NODE-A', { method: 'DELETE', auth: true })).status, 200);
      assert.equal((await physical({ emergencyType: 'fire', sequenceNumber: 5 })).status, 409);
      assert.equal((await live()).find(node => node.nodeId === 'NODE-A').hud.hardware.connected, false);
    });
  } finally {
    await videoService.stop();
    await new Promise(resolve => server.close(resolve));
    await mongoose.disconnect();
    await memory.stop();
  }
});
