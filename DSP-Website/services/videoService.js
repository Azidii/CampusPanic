import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config/config.js';
import { describeAudio } from './espDevices.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const videoDir = path.join(root, 'Video-Live');
const key = randomBytes(32).toString('hex');
const workerPort = Number(process.env.VIDEO_WORKER_PORT || 5056);
if (!Number.isInteger(workerPort) || workerPort < 1 || workerPort > 65535) throw new Error('Invalid VIDEO_WORKER_PORT');
const workerUrl = `http://127.0.0.1:${workerPort}`;

export const videoService = {
  ready: false,
  message: 'Model service is starting',
  sessions: new Map(),
  pending: new Set(),
  child: null,
  stopping: false,
  async request(route, options = {}) {
    return fetch(workerUrl + route, { ...options,
      headers: { ...options.headers, 'X-Worker-Key': key },
      signal: options.signal || AbortSignal.timeout(3000) });
  },
  start() {
    if (this.child || this.stopping) return;
    const python = process.env.VIDEO_PYTHON || path.join(videoDir, 'venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
    const portableModel = path.join(root, 'models/gun_model.tflite');
    const model = process.env.VIDEO_MODEL_PATH || (existsSync(portableModel) ? portableModel : path.join(os.homedir(), 'Desktop/CampusPanic_plan/TFlite/gun_model.tflite'));
    if (!existsSync(python) || !existsSync(model)) {
      this.message = 'Video setup required: configure VIDEO_PYTHON and VIDEO_MODEL_PATH. See README.';
      console.warn('[Video] ' + this.message);
      return;
    }
    this.child = spawn(python, [path.join(videoDir, 'security_worker.py'), '--model', model,
      '--port', String(workerPort), '--confidence', String(process.env.VIDEO_CONFIDENCE || .5),
      '--max-nodes', String(process.env.VIDEO_MAX_NODES || 8)], {
      cwd: videoDir, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'],
      env: { ...process.env, CAMPUSPANIC_WORKER_KEY: key }
    });
    // Only diagnostics go to the console; tokens and camera frames are never logged.
    this.child.stderr.on('data', () => {});
    const lost = () => {
      this.ready = false;
      this.sessions.clear();
      this.child = null;
      this.message = 'Model service unavailable. Check the Python environment, model path and worker port.';
      if (!this.stopping) console.warn('[Video] ' + this.message);
    };
    this.child.once('error', lost);
    this.child.once('exit', lost);
    this.healthTimer = setInterval(async () => {
      if (!this.child || this.checking) return;
      this.checking = true;
      try {
        const response = await this.request('/health');
        this.ready = response.ok;
        if (this.ready) this.message = 'Model service ready';
      } catch { this.ready = false; } finally { this.checking = false; }
    }, 1000);
    this.healthTimer.unref();
  },
  async stop() {
    this.stopping = true;
    clearInterval(this.healthTimer);
    this.sessions.clear();
    if (this.child) {
      const child = this.child;
      await new Promise(resolve => { child.once('exit', resolve); child.kill(); setTimeout(resolve, 3000).unref(); });
    }
  },
  async revoke(nodeId) {
    const session = this.sessions.get(nodeId);
    this.sessions.delete(nodeId);
    if (session) {
      try { await this.request(`/nodes/${encodeURIComponent(nodeId)}/session`, { method: 'DELETE',
        headers: { 'X-Camera-Session': session.id } }); } catch { /* Gateway has already revoked it. */ }
    }
  },
  async states() {
    if (!this.ready) return {};
    try {
      const response = await this.request('/status');
      if (!response.ok) return {};
      return (await response.json()).nodes;
    } catch { return {}; }
  },
  async describe(nodes) {
    const states = await this.states();
    return describeAudio(nodes.map(document => {
      const node = document.toObject ? document.toObject() : { ...document };
      delete node.pairingHash;
      const state = states[node.nodeId];
      const session = this.sessions.get(node.nodeId);
      // A revoked session can never make a deleted/re-paired node look live.
      node.video = session && state ? state : { live: false, cameraConnected: false,
        status: 'offline', detections: [], audioStatus: 'not_configured' };
      node.connectionStatus = node.video.status;
      if (node.videoEnabled && node.status !== 'active') node.status = node.video.cameraConnected ? 'online' : 'offline';
      return node;
    }));
  },
  addresses() {
    const addresses = Object.values(os.networkInterfaces()).flat().filter(network => network &&
      network.family === 'IPv4' && !network.internal && /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.)/.test(network.address))
      .map(network => `${network.address}:${config.port}`);
    return [...new Set(addresses)];
  }
};
