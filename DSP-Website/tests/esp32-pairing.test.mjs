import assert from 'node:assert/strict';
import { randomBytes, createHash } from 'node:crypto';
import http from 'node:http';
import express from 'express';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

const digest = value => createHash('sha256').update(value).digest('hex');
async function setup() {
  process.env.NODE_ENV = 'test';
  for (const name of ['JWT_SECRET', 'DEVICE_API_KEY', 'ADMIN_PASSWORD']) process.env[name] = randomBytes(32).toString('hex');
  const memory = await MongoMemoryServer.create();
  process.env.MONGODB_URI = memory.getUri('esp32_pairing');
  await mongoose.connect(process.env.MONGODB_URI);
  const { app } = await import('../server.js');
  const { User } = await import('../models/User.js');
  const { Node } = await import('../models/Node.js');
  const { EspDevice } = await import('../models/EspDevice.js');
  const { Alert } = await import('../models/Alert.js');
  await Promise.all([Node.init(), EspDevice.init(), Alert.init()]);
  const tokens = {};
  for (const role of ['admin', 'user']) {
    const user = await User.create({ name: role === 'admin' ? 'Lab Administrator' : 'Campus Guard',
      email: `${role}@test.invalid`, role, passwordHash: 'test-only-fixture', isActive: true });
    tokens[role] = jwt.sign({ id: String(user._id) }, process.env.JWT_SECRET);
  }
  await Node.create([{ nodeId: 'NODE-TEST-A', name: 'Engineering lab', building: 'Engineering', room: 'Lab 101', videoEnabled: false },
    { nodeId: 'NODE-TEST-B', name: 'Library entrance', building: 'Library', room: 'Entrance', videoEnabled: false }]);
  const wrapper = express();
  if (process.env.ESP_PREVIEW === '1') wrapper.get('/__ui', async (req, res) => {
    if (req.query.reset === '1') {
      await EspDevice.updateMany({}, { nodeId: null, pinAttempts: 0, pinExpiresAt: new Date(Date.now() + 300000) });
      await Node.updateMany({}, { audioMuted: false });
    }
    res.cookie('token', tokens.admin, { httpOnly: true, sameSite: 'lax' }); res.redirect('/security-nodes');
  });
  wrapper.use(app);
  const server = http.createServer(wrapper);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (route, { role, token, method = 'GET', body, headers = {} } = {}) => fetch(base + route, {
    method, headers: { ...headers, ...(role ? { Authorization: 'Bearer ' + tokens[role], Cookie: 'token=' + tokens[role] } : {}),
      ...(token ? { 'X-ESP32-Token': token } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(10000)
  });
  const deviceA = { deviceId: 'ESP-001122334455', token: randomBytes(32).toString('hex'), pin: '12345678' };
  const deviceB = { deviceId: 'ESP-001122334466', token: randomBytes(32).toString('hex'), pin: '87654321' };
  const register = device => request('/api/esp32/register', { method: 'POST', token: device.token,
    body: { deviceId: device.deviceId, pinHash: digest(device.pin) } });
  await register(deviceA); await register(deviceB);
  return { request, register, deviceA, deviceB, Node, EspDevice, Alert, base,
    close: async () => { await new Promise(resolve => server.close(resolve)); await mongoose.disconnect(); await memory.stop(); } };
}

if (process.env.ESP_PREVIEW === '1') {
  const fixture = await setup();
  const heartbeat = setInterval(() => Promise.all([fixture.register(fixture.deviceA), fixture.register(fixture.deviceB)]).catch(() => {}), 5000);
  // Preview remains local and isolated. No real credentials, incidents or devices are used.
  console.log('ISOLATED_PREVIEW ' + fixture.base + '/__ui');
  const close = async () => { clearInterval(heartbeat); await fixture.close(); process.exit(0); };
  process.once('SIGTERM', close); process.once('SIGINT', close);
} else {
  const { default: test } = await import('node:test');
  test('ESP32 discovery, PIN binding, mute, device isolation and physical alerts', { timeout: 90000 }, async () => {
    const f = await setup();
    const { request, register, deviceA: a, deviceB: b, EspDevice, Node, Alert } = f;
    const pair = (nodeId, device, pin = device.pin, role = 'admin') => request('/api/esp32/pair/' + nodeId,
      { method: 'POST', role, body: { deviceId: device.deviceId, pin } });
    try {
      assert.equal((await request('/api/esp32/available')).status, 401);
      assert.equal((await request('/api/esp32/available', { role: 'user' })).status, 403);
      const available = await (await request('/api/esp32/available', { role: 'admin' })).json();
      assert.equal(available.devices.length, 2);
      const serialized = JSON.stringify(available);
      for (const secret of [a.pin, a.token, digest(a.pin), digest(a.token)]) assert.ok(!serialized.includes(secret));
      assert.equal((await pair('NODE-TEST-A', a, a.pin, 'user')).status, 403);
      assert.equal((await pair('NODE-TEST-A', a, '00000000')).status, 400);
      assert.equal((await pair('NODE-TEST-A', a)).status, 200);
      assert.equal((await pair('NODE-TEST-B', a)).status, 409);
      assert.equal((await pair('NODE-TEST-A', b)).status, 409);
      const state = await register(a);
      assert.equal(state.headers.get('x-node-id'), 'NODE-TEST-A');
      assert.equal((await pair('NODE-TEST-B', b)).status, 200);
      const protectedBody = { deviceId: a.deviceId, nodeId: 'NODE-TEST-A', emergencyType: 'fire', sequenceNumber: 1 };
      assert.equal((await request('/api/esp32/alert', { method: 'POST', token: b.token, body: protectedBody })).status, 401);
      assert.equal((await request('/api/esp32/alert', { method: 'POST', token: a.token, body: { ...protectedBody, nodeId: 'NODE-TEST-B' } })).status, 409);
      const muteRoute = '/api/esp32/nodes/NODE-TEST-A/mute';
      assert.equal((await request(muteRoute, { method: 'PATCH', role: 'user', body: { muted: true } })).status, 403);
      assert.equal((await request(muteRoute, { method: 'PATCH', role: 'admin', body: { muted: 'true' } })).status, 400);
      assert.equal((await request(muteRoute, { method: 'PATCH', role: 'admin', body: { muted: true }, headers: { Origin: 'https://untrusted.invalid' } })).status, 403);
      assert.equal((await request(muteRoute, { method: 'PATCH', role: 'admin', body: { muted: true } })).status, 200);
      assert.equal((await register(a)).headers.get('x-audio-muted'), 'true');
      const nodes = await (await request('/api/nodes', { role: 'user' })).json();
      assert.equal(nodes.nodes.find(node => node.nodeId === 'NODE-TEST-A').audio.status, 'muted');
      assert.ok(!JSON.stringify(nodes).includes(a.token));
      // Client-supplied location and AI claims cannot override the node's database record.
      await Node.updateOne({ nodeId: 'NODE-TEST-A' }, { room: 'Lab 202' });
      const alert = { ...protectedBody, building: 'FORGED', room: 'FORGED', threatStatus: 'verified_threat', audioConfidence: 1 };
      for (let index = 0; index < 2; index++) assert.equal((await request('/api/esp32/alert', { method: 'POST', token: a.token, body: alert })).status, 200);
      assert.equal(await Alert.countDocuments(), 1);
      const saved = await Alert.findOne();
      assert.equal(saved.building, 'Engineering'); assert.equal(saved.room, 'Lab 202');
      assert.equal(saved.threatStatus, 'manual_alert'); assert.equal(saved.audioConfidence, null);
      assert.equal((await request('/api/esp32/alert', { method: 'POST', token: a.token,
        body: { ...protectedBody, sequenceNumber: 2, source: 'smoke_sensor' } })).status, 200);
      assert.equal((await Alert.findOne({ sequenceNumber: 2 })).triggerSource, 'smoke_sensor');
      const html = await (await request('/security-nodes', { role: 'admin' })).text();
      assert.ok(html.includes('esp32PairForm') && html.includes('muteEsp32Btn'));
      const guardHtml = await (await request('/security-nodes', { role: 'user' })).text();
      assert.ok(!guardHtml.includes('id="muteEsp32Btn"'));
      assert.equal((await request('/api/esp32/nodes/NODE-TEST-A', { method: 'DELETE', role: 'admin' })).status, 200);
      assert.equal((await request('/api/esp32/alert', { method: 'POST', token: a.token, body: protectedBody })).status, 409);
      assert.equal((await pair('NODE-TEST-A', a)).status, 409); // Consumed PIN cannot be reused.
      a.pin = '31415926'; await register(a);
      for (let i = 0; i < 5; i++) assert.equal((await pair('NODE-TEST-A', a, '00000000')).status, 400);
      assert.equal((await pair('NODE-TEST-A', a)).status, 409);
      a.pin = '27182818'; await register(a);
      await EspDevice.updateOne({ deviceId: a.deviceId }, { pinExpiresAt: new Date(0) });
      assert.equal((await pair('NODE-TEST-A', a)).status, 409);
      const scan = await (await request('/api/esp32/available', { role: 'admin' })).json();
      assert.equal(scan.devices.length, 0);
      // A replacement device may start at sequence 1 without losing its new incident.
      await request('/api/esp32/nodes/NODE-TEST-B', { method: 'DELETE', role: 'admin' });
      b.pin = '16180339'; await register(b);
      assert.equal((await pair('NODE-TEST-A', b)).status, 200);
      assert.equal((await request('/api/esp32/alert', { method: 'POST', token: b.token,
        body: { ...protectedBody, deviceId: b.deviceId, emergencyType: 'medical' } })).status, 200);
      assert.equal(await Alert.countDocuments({ nodeId: 'NODE-TEST-A' }), 3);
      assert.equal((await Alert.findOne({ deviceId: b.deviceId })).deviceSequence, 1);
      const duplicate = { ...protectedBody, deviceId: b.deviceId, emergencyType: 'medical', sequenceNumber: 2 };
      const concurrent = await Promise.all([request('/api/esp32/alert', { method: 'POST', token: b.token, body: duplicate }),
        request('/api/esp32/alert', { method: 'POST', token: b.token, body: duplicate })]);
      assert.ok(concurrent.every(response => response.status === 200));
      assert.equal(await Alert.countDocuments({ deviceId: b.deviceId, deviceSequence: 2 }), 1);
    } finally { await f.close(); }
  });
}
