import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import audioRoutes from '../routes/audioRoutes.js';
import { audioService } from '../services/audioService.js';
import { videoService } from '../services/videoService.js';
import { hashCode } from '../services/nodePairing.js';

test('live phone audio validates uploads, retries workers and rejects revoked results', async t => {
  const original = { ready: audioService.ready, request: audioService.request };
  const app = express();
  app.use('/audio', audioRoutes);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const result = { class: 'Non-Scream', confidence: 0.97, alert: false, threatType: null, inferenceMs: 1 };
  let session;
  let calls;
  function reset() {
    session = { id: 'phone-session', tokenHash: hashCode('12345678'), activity: Date.now() };
    videoService.sessions.set('AUDIO-TEST', session);
    audioService.nodeAudioStates.clear();
    audioService.ready = true;
    calls = [];
    audioService.request = async (route, options) => {
      calls.push({ route, options });
      return Response.json(route.endsWith('/session') ? { ready: true } : result);
    };
  }
  const upload = (body = Buffer.alloc(32000), headers = {}) => fetch(base + '/audio', {
    method: 'POST', headers: { 'Content-Type': 'application/octet-stream',
      'X-Camera-Token': '12345678', 'X-Camera-Session': session.id, ...headers }, body
  });
  try {
    await t.test('forwards PCM and records a live classification using the phone session', async () => {
      reset();
      const response = await upload();
      assert.equal(response.status, 200);
      assert.equal((await response.json()).class, result.class);
      assert.equal(calls.length, 2);
      assert.equal(calls[1].options.body.length, 32000);
      assert.equal(calls[1].options.headers['X-Camera-Session'], session.id);
      assert.equal(audioService.getNodeAudio('AUDIO-TEST', session.id).connected, true);
      assert.equal(audioService.getNodeAudio('AUDIO-TEST', 'replacement').connected, false);
      assert.equal(session.audioUploading, false);
    });
    await t.test('rejects invalid tokens, odd samples, oversized PCM and wrong media types', async () => {
      reset();
      assert.equal((await upload(undefined, { 'X-Camera-Token': '87654321' })).status, 401);
      for (const length of [0, 999, 32001, 100002]) assert.equal((await upload(Buffer.alloc(length))).status, 400);
      assert.equal((await upload(Buffer.alloc(32000), { 'Content-Type': 'text/plain' })).status, 415);
      assert.equal(calls.length, 0);
    });
    await t.test('reports worker unavailability and recovers on the next chunk', async () => {
      reset();
      audioService.ready = false;
      assert.equal((await upload()).status, 503);
      assert.equal(audioService.getNodeAudio('AUDIO-TEST').status, 'unavailable');
      audioService.ready = true;
      const working = audioService.request;
      audioService.request = async () => Response.json({ error: 'busy' }, { status: 409 });
      assert.equal((await upload()).status, 503);
      assert.equal(session.audioUploading, false);
      audioService.request = working;
      assert.equal((await upload()).status, 200);
    });
    await t.test('audio activity keeps the shared session alive', async () => {
      reset();
      const before = Date.now() - 4000;
      session.activity = before;
      assert.equal((await upload()).status, 200);
      assert.ok(session.activity > before);
      session.activity = Date.now() - 6000;
      assert.equal((await upload()).status, 409);
    });
    await t.test('limits concurrent uploads and discards inference after session revocation', async () => {
      reset();
      let finish, entered;
      const started = new Promise(resolve => { entered = resolve; });
      audioService.request = async route => {
        if (route.endsWith('/session')) return Response.json({ ready: true });
        entered();
        return new Promise(resolve => { finish = () => resolve(Response.json(result)); });
      };
      const pending = upload();
      await started;
      assert.equal((await upload()).status, 429);
      videoService.sessions.delete('AUDIO-TEST');
      finish();
      assert.equal((await pending).status, 409);
      assert.equal(audioService.nodeAudioStates.has('AUDIO-TEST'), false);
    });
    await t.test('stale results stop showing live and close clears state while worker is down', async () => {
      reset();
      await upload();
      audioService.nodeAudioStates.get('AUDIO-TEST').receivedAt = Date.now() - 6000;
      const stale = audioService.getNodeAudio('AUDIO-TEST', session.id);
      assert.equal(stale.connected, false);
      assert.equal(stale.class, 'Idle');
      assert.equal(stale.alert, false);
      assert.equal(stale.status, 'offline');
      audioService.ready = false;
      await audioService.closeSession('AUDIO-TEST', session.id);
      assert.equal(audioService.nodeAudioStates.has('AUDIO-TEST'), false);
    });
    await t.test('audio status requires a signed-in website operator', async () => {
      assert.equal((await fetch(base + '/audio/status/AUDIO-TEST')).status, 401);
    });
  } finally {
    Object.assign(audioService, original);
    audioService.nodeAudioStates.clear();
    videoService.sessions.clear();
    await new Promise(resolve => server.close(resolve));
  }
});
