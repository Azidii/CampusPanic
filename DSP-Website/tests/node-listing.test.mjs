import test from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

// Node lists must work before a phone is paired or a model worker is available.
test('saved offline and legacy nodes remain visible without camera/model sessions', { timeout: 60000 }, async t => {
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = 'isolated-node-listing-test-secret';
  process.env.DEVICE_API_KEY = 'isolated-node-listing-device-secret';
  process.env.ADMIN_PASSWORD = 'isolated-node-listing-admin-password';
  const memory = await MongoMemoryServer.create();
  process.env.MONGODB_URI = memory.getUri('node_listing_regression');
  let server;
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    ({ server } = await import('../server.js'));
    const { Node } = await import('../models/Node.js');
    const { User } = await import('../models/User.js');
    const { Camera } = await import('../models/Camera.js');
    const { videoService } = await import('../services/videoService.js');
    await Node.init();
    await Node.create([
      { nodeId: 'NODE-UNPAIRED', name: 'Unused library node', building: 'Library', room: 'Entrance',
        videoEnabled: true, status: 'offline', lat: 14.5, lng: 120.9,
        pairingHash: 'test-only-hidden-pairing-hash', pairingExpiresAt: new Date(0) },
      { nodeId: 'NODE-SENSOR', name: 'Unpaired sensor node', building: 'Engineering', room: 'Lab',
        videoEnabled: false, status: 'offline', lat: null, lng: null }
    ]);
    // Old saved nodes predate name/videoEnabled and may never have had a Camera.
    await Node.collection.insertOne({ nodeId: 'NODE-LEGACY', building: 'Archive', room: 'Hall',
      status: 'offline', lat: 14.51, lng: 120.91 });
    assert.equal(await Camera.countDocuments(), 0);
    assert.equal(videoService.ready, false);
    assert.equal(videoService.sessions.size, 0);
    const user = await User.create({ name: 'Listing Operator', email: 'listing@test.invalid',
      passwordHash: 'fixture-only', role: 'admin', isActive: true });
    const token = jwt.sign({ id: String(user._id) }, process.env.JWT_SECRET);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const request = (route, authenticated = true) => fetch(base + route, {
      headers: authenticated ? { Cookie: `token=${token}` } : {},
      redirect: 'manual', signal: AbortSignal.timeout(10000)
    });
    const expectedIds = ['NODE-LEGACY', 'NODE-SENSOR', 'NODE-UNPAIRED'];

    await t.test('both authenticated list APIs include every saved offline node', async () => {
      for (const route of ['/api/nodes', '/api/nodes?status=offline', '/api/live']) {
        const response = await request(route);
        assert.equal(response.status, 200, route);
        const raw = await response.text();
        assert.doesNotMatch(raw, /pairingHash|test-only-hidden-pairing-hash/);
        const data = JSON.parse(raw);
        assert.deepEqual(data.nodes.map(node => node.nodeId).sort(), expectedIds, route);
        assert.ok(data.nodes.every(node => node.status === 'offline' && !node.video.live));
        const legacy = data.nodes.find(node => node.nodeId === 'NODE-LEGACY');
        assert.equal(legacy.videoEnabled, false);
      }
      const response = await request('/api/nodes?building=Library');
      const data = await response.json();
      assert.deepEqual(data.nodes.map(node => node.nodeId), ['NODE-UNPAIRED']);
    });

    await t.test('node pages render and the map retains unpaired node coordinates', async () => {
      for (const route of ['/security-nodes', '/cameras', '/cam-view?nodeId=NODE-LEGACY']) {
        const response = await request(route);
        assert.equal(response.status, 200, route);
        const html = await response.text();
        assert.match(html, /\/js\/nodes-ui\.js/);
        if (route.startsWith('/cam-view')) assert.match(html, /data-node-id="NODE-LEGACY"/);
      }
      const map = await (await request('/map')).text();
      const payload = map.match(/<script id="nodesData" type="application\/json">([\s\S]*?)<\/script>/);
      assert.ok(payload, 'map includes its initial node data');
      const nodes = JSON.parse(payload[1]);
      assert.deepEqual(nodes.map(node => node.nodeId).sort(), expectedIds);
      assert.equal(nodes.find(node => node.nodeId === 'NODE-UNPAIRED').lat, 14.5);
    });

    await t.test('list access stays authenticated and reading never recreates camera records', async () => {
      for (const route of ['/api/nodes', '/api/live']) assert.equal((await request(route, false)).status, 401);
      assert.equal((await request('/cameras', false)).status, 302);
      assert.equal(await Camera.countDocuments(), 0);
      assert.equal(await Node.countDocuments(), expectedIds.length);
    });
  } finally {
    if (server?.listening) await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
    await mongoose.disconnect();
    await memory.stop();
  }
});
