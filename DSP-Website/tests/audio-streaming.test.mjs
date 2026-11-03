import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

async function freePort() {
  const socket = net.createServer();
  await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  return port;
}

test('Audio streaming end-to-end integration and load testing', { timeout: 60000 }, async t => {
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = 'test-secret-12345678901234567890';
  process.env.DEVICE_API_KEY = 'test-device-key-123456789012345';
  process.env.ADMIN_PASSWORD = 'TestPassword123!';
  process.env.AUDIO_PYTHON = 'python';
  process.env.AUDIO_WORKER_PORT = String(await freePort());

  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  process.env.AUDIO_MODEL_PATH = path.join(root, 'Audio-CNN', 'Audio CNN', 'Models', 'best_cnn_model.keras');

  const memory = await MongoMemoryServer.create();
  let server, audioService, videoService;

  try {
    await mongoose.connect(memory.getUri('campuspanic_audio_test'));

    const { Node } = await import('../models/Node.js');
    const { Alert } = await import('../models/Alert.js');
    const { hashCode } = await import('../services/nodePairing.js');

    const appModule = await import('../server.js');
    server = appModule.server;
    ({ audioService } = await import('../services/audioService.js'));
    ({ videoService } = await import('../services/videoService.js'));

    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;

    // Start audio worker explicitly
    audioService.start();

    // Wait for audio worker to become ready
    const deadline = Date.now() + 30000;
    while (!audioService.ready && Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 300));
    }
    assert.ok(audioService.ready, 'Audio service failed to start within timeout');

    // Create a paired test node in MongoDB
    const pairingCode = '12345678';
    const testNode = await Node.create({
      nodeId: 'TEST-AUDIO-NODE-01',
      name: 'Security Gate Audio Test',
      building: 'Building A',
      room: '101',
      videoEnabled: true,
      pairingHash: hashCode(pairingCode),
      pairingExpiresAt: new Date(Date.now() + 3600000)
    });

    // Mock videoService session to simulate paired phone
    const sessionId = 'test-session-token-987654321';
    videoService.sessions.set(testNode.nodeId, {
      id: sessionId,
      tokenHash: testNode.pairingHash,
      activity: Date.now(),
      savedAt: 0
    });

    await t.test('Audio worker health and status', async () => {
      const res = await fetch(`${base}/api/health`);
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.workers.audio.ready, true);
    });

    await t.test('Reject unauthorized audio chunks without valid pairing token', async () => {
      const dummyPcm = Buffer.alloc(32000);
      const res = await fetch(`${base}/api/camera/audio`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream',
          'X-Camera-Token': '00000000',
          'X-Camera-Session': sessionId
        },
        body: dummyPcm
      });
      assert.equal(res.status, 401);
    });

    await t.test('Upload 1s PCM chunk and receive downstream classification', async () => {
      // 1-second silence/ambient PCM (32000 bytes)
      const pcm16 = Buffer.alloc(32000);
      const res = await fetch(`${base}/api/camera/audio`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream',
          'X-Camera-Token': pairingCode,
          'X-Camera-Session': sessionId
        },
        body: pcm16
      });

      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.success, true);
      assert.ok(typeof data.class === 'string');
      assert.ok(typeof data.confidence === 'number');
      assert.ok(typeof data.alert === 'boolean');
      assert.ok(typeof data.inferenceMs === 'number');
      assert.equal(data.nodeId, testNode.nodeId);
    });

    await t.test('Load balancing: concurrent audio chunks from multiple virtual nodes', async () => {
      // Create 3 virtual nodes
      const virtualNodes = ['V-NODE-01', 'V-NODE-02', 'V-NODE-03'];
      const requests = [];

      for (let i = 0; i < virtualNodes.length; i++) {
        const vId = virtualNodes[i];
        const vCode = `8765432${i}`;
        const vSession = `v-sess-${i}-${Date.now()}`;

        await Node.create({
          nodeId: vId,
          name: `Virtual Node ${i}`,
          building: 'Hall B',
          room: `20${i}`,
          videoEnabled: true,
          pairingHash: hashCode(vCode),
          pairingExpiresAt: new Date(Date.now() + 3600000)
        });

        videoService.sessions.set(vId, {
          id: vSession,
          tokenHash: hashCode(vCode),
          activity: Date.now(),
          savedAt: 0
        });

        const pcm = Buffer.alloc(32000);
        requests.push(
          fetch(`${base}/api/camera/audio`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/octet-stream',
              'X-Camera-Token': vCode,
              'X-Camera-Session': vSession
            },
            body: pcm
          })
        );
      }

      // Execute all concurrently
      const responses = await Promise.all(requests);
      for (const res of responses) {
        assert.equal(res.status, 200);
        const json = await res.json();
        assert.equal(json.success, true);
      }
    });

  } finally {
    if (audioService) await audioService.stop();
    if (videoService) await videoService.stop();
    if (server) server.close();
    await mongoose.disconnect();
    await memory.stop();
  }
});
