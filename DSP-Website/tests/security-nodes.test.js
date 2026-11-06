import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import '../config/env.js';

async function waitFor(fn, ms = 10000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) { if (await fn()) return; await delay(100); }
  throw new Error('Timed out waiting for model output');
}
async function freePort() {
  const socket = net.createServer(); await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
  const port = socket.address().port; await new Promise(resolve => socket.close(resolve)); return port;
}

test('security-node gateway with real model and isolated test database', { timeout: 90000 }, async t => {
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = 'isolated-integration-test-secret';
  process.env.DEVICE_API_KEY = 'isolated-video-integration-test-device';
  process.env.ADMIN_PASSWORD = 'isolated-video-integration-test-admin';
  process.env.VIDEO_WORKER_PORT = String(await freePort());
  // On another machine use VIDEO_PYTHON/VIDEO_MODEL_PATH as documented in README.md.
  const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  process.env.VIDEO_PYTHON ||= path.join(projectRoot, 'Video-Live/venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  const portableModel = path.join(projectRoot, 'models/gun_model.tflite');
  process.env.VIDEO_MODEL_PATH ||= existsSync(portableModel) ? portableModel : path.join(os.homedir(), 'Desktop/CampusPanic_plan/TFlite/gun_model.tflite');
  const memory = await MongoMemoryServer.create();
  let server, videoService;
  const pumps = [];
  try {
    await mongoose.connect(memory.getUri('security_nodes_integration'));
    const application = await import('../server.js'); server = application.server;
    ({ videoService } = await import('../services/videoService.js'));
    const { User } = await import('../models/User.js');
    const { Node } = await import('../models/Node.js');
    const { Camera } = await import('../models/Camera.js');
    const { Alert } = await import('../models/Alert.js');
    await Node.init();
    const password = 'test-only-password';
    for (const role of ['admin', 'guard']) await User.create({ name: role, email: `${role}@test.local`,
      role: role === 'guard' ? 'user' : role, passwordHash: await User.hashPassword(password), isActive: true });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    async function request(route, { cookie, phone, method = 'GET', body, raw, headers = {} } = {}) {
      const response = await fetch(base + route, { method, redirect: 'manual',
        headers: { ...headers, ...(cookie ? { Cookie: cookie } : {}),
          ...(phone ? { 'X-Camera-Token': phone.code, 'X-Camera-Session': phone.sessionId || '' } : {}),
          ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: raw || (body ? JSON.stringify(body) : undefined), signal: AbortSignal.timeout(10000) });
      return response;
    }
    async function login(role) {
      const response = await request('/api/auth/login', { method: 'POST', body: { email: `${role}@test.local`, password } });
      assert.equal(response.status, 200); return response.headers.get('set-cookie').split(';')[0];
    }
    const admin = await login('admin'), guard = await login('guard');
    let a, b, phoneA, phoneB;
    const jpeg = await readFile(new URL('./fixtures/blank.jpg', import.meta.url));
    await t.test('login and protected pages render; removed demo and socket endpoints are absent', async () => {
      const loginPage = await (await request('/login')).text();
      assert.doesNotMatch(loginPage, /Quick Demo Login|demoAdminBtn|socket.io/);
      assert.equal((await request('/media/nodes/unknown/frame.jpg')).status, 401);
      assert.equal((await request('/api/nodes')).status, 401);
      assert.equal((await request('/socket.io/socket.io.js')).status, 404);
      const redirect = await request('/streamer', { cookie: admin });
      assert.equal(redirect.status, 302); assert.equal(redirect.headers.get('location'), '/security-nodes');
      for (const page of ['/', '/security-nodes', '/cameras', '/cam-view', '/map', '/active-nodes-map']) {
        const response = await request(page, { cookie: admin }); assert.equal(response.status, 200, page);
        const html = await response.text(); assert.doesNotMatch(html, /socket.io|simulated bounding/i);
      }
      const guardPage = await (await request('/cameras', { cookie: guard })).text();
      assert.doesNotMatch(guardPage, /id="deleteNodeBtn"|id="editNodeForm"/);
    });
    await t.test('admin creates persistent named nodes, optional coordinates and unique expiring codes', async () => {
      assert.equal((await request('/api/nodes', { cookie: guard, method: 'POST', body: { name: 'forbidden', building: 'A', room: '1' } })).status, 403);
      assert.equal((await request('/api/nodes', { cookie: admin, method: 'POST', body: { name: '', building: 'A', room: '1' } })).status, 400);
      for (const [name, room] of [['Entrance', 'Hallway'], ['Library', 'Reading room']]) {
        const response = await request('/api/nodes', { cookie: admin, method: 'POST', body: { name, room, building: 'RSY' } });
        assert.equal(response.status, 201);
        const result = await response.json(); assert.match(result.pairing.code, /^\d{8}$/);
        assert.equal(result.node.lat, null); assert.equal(result.node.video.live, false);
        if (!a) a = result; else b = result;
      }
      assert.notEqual(a.pairing.code, b.pairing.code);
      assert.equal(await Node.countDocuments(), 2); assert.equal(await Camera.countDocuments(), 2);
      const list = await (await request('/api/nodes', { cookie: admin })).text();
      assert.doesNotMatch(list, /pairingHash/); assert.ok(!list.includes(a.pairing.code));
      assert.equal((await request('/api/camera/connect', { method: 'POST', phone: { code: 'wrong' } })).status, 401);
      assert.equal((await request('/api/cameras/arbitrary/frame', { method: 'POST', body: { image: 'anything' } })).status, 410);
    });
    videoService.start();
    await waitFor(() => videoService.ready, 25000);
    async function connect(result) {
      const phone = { code: result.pairing.code };
      const response = await request('/api/camera/connect', { method: 'POST', phone });
      assert.equal(response.status, 201); return { ...phone, ...(await response.json()) };
    }
    async function upload(phone, image = jpeg) {
      return request('/api/camera/frame', { method: 'POST', phone, raw: image, headers: { 'Content-Type': 'image/jpeg' } });
    }
    function pump(phone) {
      const state = { active: true, promise: null };
      state.promise = (async () => { while (state.active) { await upload(phone); await delay(180); } })();
      pumps.push(state); return state;
    }
    let pumpA, pumpB;
    await t.test('two phones produce independent real-model video; authenticated JPEG viewing works', async () => {
      phoneA = await connect(a); phoneB = await connect(b);
      assert.notEqual(phoneA.sessionId, phoneB.sessionId);
      assert.equal((await connectConflict(a)).status, 409);
      assert.equal((await upload({ ...phoneA, sessionId: phoneB.sessionId })).status, 401);
      assert.equal((await upload(phoneA, Buffer.from('invalid'))).status, 400);
      pumpA = pump(phoneA); pumpB = pump(phoneB);
      await waitFor(async () => {
        const data = await (await request('/api/live', { cookie: admin })).json();
        return data.nodes.length === 2 && data.nodes.every(node => node.video.live && node.video.inferenceMs != null);
      });
      const data = await (await request('/api/live', { cookie: admin })).json();
      for (const node of data.nodes) {
        assert.equal(node.video.width, 640); assert.equal(node.video.height, 480);
        assert.equal(typeof node.video.inferenceMs, 'number');
        const frame = await request(`/media/nodes/${node.nodeId}/frame.jpg`, { cookie: admin });
        assert.equal(frame.status, 200); assert.match(frame.headers.get('content-type'), /image\/jpeg/);
        assert.ok((await frame.arrayBuffer()).byteLength > 1000);
      }
      assert.equal(await Alert.countDocuments(), 0, 'video detections do not invent incidents');
    });
    async function connectConflict(result) {
      return request('/api/camera/connect', { method: 'POST', phone: { code: result.pairing.code } });
    }
    await t.test('metadata edits are allowed only to admins and cannot overwrite protected fields', async () => {
      const values = { name: '<script>New name</script>', building: 'RG Birrey', room: 'Room 2', lat: 0, lng: 0,
        nodeId: 'OVERRIDE', status: 'active', pairingHash: 'injected' };
      assert.equal((await request(`/api/nodes/${a.node.nodeId}`, { cookie: guard, method: 'PUT', body: values })).status, 403);
      assert.equal((await request(`/api/nodes/${a.node.nodeId}`, { cookie: admin, method: 'PUT', body: values })).status, 200);
      const node = await Node.findOne({ nodeId: a.node.nodeId }).select('+pairingHash');
      assert.equal(node.lat, 0); assert.equal(node.lng, 0); assert.notEqual(node.pairingHash, 'injected'); assert.notEqual(node.status, 'active');
      const map = await (await request('/map', { cookie: admin })).text();
      assert.ok(!map.includes('<script>New name</script>'));
    });
    await t.test('re-pair revokes old uploads and preserves the other node', async () => {
      pumpA.active = false; await pumpA.promise;
      const response = await request(`/api/nodes/${a.node.nodeId}/pairing`, { cookie: admin, method: 'POST' });
      assert.equal(response.status, 200); const result = await response.json();
      assert.notEqual(result.pairing.code, a.pairing.code);
      assert.equal((await upload(phoneA)).status, 409);
      assert.equal((await connectConflict(a)).status, 401);
      assert.equal((await upload(phoneB)).status, 202);
      phoneA = await connect({ pairing: result.pairing }); pumpA = pump(phoneA);
      await waitFor(async () => (await videoService.states())[a.node.nodeId]?.live);
    });
    await t.test('stale video disappears, expires its session and reconnects using a still-valid code', async () => {
      pumpA.active = false; await pumpA.promise; await delay(5100);
      const response = await request(`/media/nodes/${a.node.nodeId}/frame.jpg`, { cookie: admin }); assert.equal(response.status, 503);
      assert.equal((await upload(phoneA)).status, 409);
      const response2 = await request('/api/camera/connect', { method: 'POST', phone: { code: phoneA.code } });
      assert.equal(response2.status, 201);
      phoneA = { ...phoneA, ...(await response2.json()) }; pumpA = pump(phoneA);
    });
    await t.test('expired codes reject new pairing; delete removes node/camera but preserves incidents', async () => {
      const incident = await Alert.create({ nodeId: b.node.nodeId, building: 'Test', room: 'Room',
        emergencyType: 'panic', threatStatus: 'manual_alert', priority: 2, sequenceNumber: 1, checksum: 'test', status: 'new' });
      pumpB.active = false; await pumpB.promise;
      await Node.updateOne({ nodeId: b.node.nodeId }, { pairingExpiresAt: new Date(0) });
      assert.equal((await connectConflict(b)).status, 401);
      assert.equal((await request(`/api/nodes/${b.node.nodeId}`, { cookie: guard, method: 'DELETE' })).status, 403);
      assert.equal((await request(`/api/nodes/${b.node.nodeId}`, { cookie: admin, method: 'DELETE' })).status, 200);
      assert.equal(await Node.countDocuments({ nodeId: b.node.nodeId }), 0);
      assert.equal(await Camera.countDocuments({ nodeId: b.node.nodeId }), 0);
      assert.ok(await Alert.findById(incident._id));
      assert.equal((await upload(phoneB)).status, 409);
      assert.equal((await request('/cam-view?alertId=' + incident._id, { cookie: admin })).status, 200);
    });
  } finally {
    pumps.forEach(pump => pump.active = false);
    await Promise.allSettled(pumps.map(pump => pump.promise));
    await videoService?.stop();
    if (server?.listening) await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
    await mongoose.disconnect(); await memory.stop();
  }
});
