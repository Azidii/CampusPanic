import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';

const root = new URL('../../DSP-Website/', import.meta.url);
const requireWebsite = createRequire(new URL('package.json', root));
const express = requireWebsite('express');
const mongoose = requireWebsite('mongoose');
const { MongoMemoryServer } = requireWebsite('mongodb-memory-server');

test('ESP32 manual packets match actual ingest authentication, checksums and deduplication', { timeout: 90000 }, async () => {
  process.env.NODE_ENV = 'test';
  process.env.DEVICE_API_KEY = randomBytes(32).toString('hex');
  process.env.JWT_SECRET = randomBytes(32).toString('hex');
  process.env.ADMIN_PASSWORD = randomBytes(32).toString('hex');
  const memory = await MongoMemoryServer.create();
  let server;
  try {
    await mongoose.connect(memory.getUri('esp32_manual_test'));
    const { default: routes } = await import(new URL('routes/alertRoutes.js', root));
    const { Alert } = await import(new URL('models/Alert.js', root));
    const { User } = await import(new URL('models/User.js', root));
    const { computeAlertChecksum } = await import(new URL('utils/checksum.js', root));
    await Alert.init();
    const app = express();
    app.use(express.json());
    app.use('/api/alerts', routes);
    server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const url = `http://127.0.0.1:${server.address().port}/api/alerts/ingest`;
    const jwt = requireWebsite('jsonwebtoken');
    const users = [];
    for (const role of ['admin', 'user']) {
      const account = await User.create({ name: role, email: `${role}@test.invalid`, role,
        passwordHash: 'isolated-fixture-no-login', isActive: true });
      users.push(jwt.sign({ id: String(account._id) }, process.env.JWT_SECRET));
    }
    const listUrl = url.replace('/ingest', '');
    assert.equal((await fetch(listUrl)).status, 401);
    for (const token of users) {
      const headers = { Authorization: 'Bearer ' + token };
      assert.equal((await fetch(listUrl, { headers })).status, 200);
      // A website user session cannot substitute for the device credential.
      assert.equal((await fetch(url, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: '{}' })).status, 401);
    }
    const send = (packet, key = process.env.DEVICE_API_KEY) => fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...(key ? { 'x-device-api-key': key } : {}) },
      body: JSON.stringify(packet), signal: AbortSignal.timeout(5000)
    });
    const packet = (type, sequenceNumber) => {
      const result = { nodeId: 'ESP32-001', building: 'Test Building', room: 'Room 1',
        emergencyType: type, threatStatus: 'manual_alert', sequenceNumber };
      result.checksum = computeAlertChecksum(result);
      return result;
    };
    assert.equal(packet('fire', 1).checksum, 'b518fef4b90f751d95fb015d247142ae45ef13642eaffb347f454a399d6d0c49');
    assert.equal((await send(packet('fire', 1), '')).status, 401);
    assert.equal((await send(packet('fire', 1), 'wrong')).status, 403);
    for (const [index, type] of ['fire', 'medical', 'gunshot'].entries()) {
      const response = await send(packet(type, index + 1));
      assert.equal(response.status, 201);
      assert.equal((await response.json()).ack, true);
      const saved = await Alert.findOne({ sequenceNumber: index + 1 });
      assert.equal(saved.emergencyType, type);
      assert.equal(saved.threatStatus, 'manual_alert');
      assert.equal(saved.audioConfidence, null);
      assert.equal(saved.firearmConfidence, null);
    }
    const retry = await send(packet('fire', 1));
    assert.equal(retry.status, 200);
    assert.equal((await retry.json()).duplicate, true);
    assert.equal(await Alert.countDocuments(), 3);
    const corrupt = packet('fire', 4);
    corrupt.checksum = 'bad';
    assert.equal((await send(corrupt)).status, 400);
    const sketch = await readFile(new URL('../ESP32.ino', import.meta.url), 'utf8');
    assert.match(sketch, /WEBSITE_TYPES\[\] = \{"fire", "medical", "gunshot"\}/);
    assert.match(sketch, /queuePhysicalAlert\(i, false\)/);
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    await mongoose.disconnect();
    await memory.stop();
  }
});
