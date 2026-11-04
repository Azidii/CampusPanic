import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Alert } from '../models/Alert.js';
import { Node } from '../models/Node.js';
import { recordAudioThreat } from './threatState.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const audioLiveDir = path.join(root, 'Audio-Live');
const audioCnnDir = path.join(root, 'Audio-CNN', 'Audio CNN');
const key = randomBytes(32).toString('hex');

const workerPort = Number(process.env.AUDIO_WORKER_PORT || 5057);
if (!Number.isInteger(workerPort) || workerPort < 1 || workerPort > 65535) {
  throw new Error('Invalid AUDIO_WORKER_PORT');
}
const workerUrl = `http://127.0.0.1:${workerPort}`;

export const resolveAudioPython = ({ env = process.env, projectRoot = root, platform = process.platform, fileExists = existsSync } = {}) => {
  const configured = env.AUDIO_PYTHON?.trim();
  if (configured) return configured;
  const executable = platform === 'win32' ? 'Scripts/python.exe' : 'bin/python';
  const candidates = [
    path.join(projectRoot, 'Audio-Live', 'venv', executable),
    path.join(projectRoot, '.venv', executable)
  ];
  return candidates.find(candidate => fileExists(candidate)) || 'python';
};

// Active audio incidents are deduplicated by node and event type.

export const audioService = {
  ready: false,
  message: 'Audio CNN model service is starting',
  child: null,
  stopping: false,
  nodeAudioStates: new Map(), // nodeId -> latest result

  async request(route, options = {}) {
    return fetch(workerUrl + route, {
      ...options,
      headers: { ...options.headers, 'X-Worker-Key': key },
      signal: options.signal || AbortSignal.timeout(3000)
    });
  },

  start() {
    if (this.child || this.stopping) return;

    // Prefer an explicitly configured interpreter, then the prepared local venv.
    const python = resolveAudioPython();

    const modelPath = process.env.AUDIO_MODEL_PATH || path.join(audioCnnDir, 'Models', 'best_cnn_model.keras');
    const classesPath = path.join(audioCnnDir, 'Models', 'classes.json');
    const scriptPath = path.join(audioLiveDir, 'audio_worker.py');

    if (!existsSync(modelPath) || !existsSync(classesPath) || !existsSync(scriptPath)) {
      this.message = 'Audio setup required: verify best_cnn_model.keras, classes.json and audio_worker.py exist.';
      console.warn('[Audio] ' + this.message);
      return;
    }

    console.log(`[Audio] Spawning audio CNN worker on port ${workerPort} with ${python}...`);
    this.child = spawn(
      python,
      [
        scriptPath,
        '--model', modelPath,
        '--classes', classesPath,
        '--port', String(workerPort),
        '--threads', String(process.env.AUDIO_THREADS || 8),
        '--threshold', String(process.env.AUDIO_ALERT_THRESHOLD || 0.55),
        '--max-nodes', String(process.env.AUDIO_MAX_NODES || 16)
      ],
      {
        cwd: audioLiveDir,
        windowsHide: true,
        stdio: ['ignore', 'inherit', 'inherit'],
        env: { ...process.env, CAMPUSPANIC_AUDIO_KEY: key }
      }
    );

    const lost = () => {
      this.ready = false;
      this.child = null;
      this.message = 'Audio model service unavailable. Check the Python environment and worker port.';
      if (!this.stopping) console.warn('[Audio] ' + this.message);
    };

    this.child.once('error', lost);
    this.child.once('exit', lost);

    this.healthTimer = setInterval(async () => {
      if (!this.child || this.checking) return;
      this.checking = true;
      try {
        const response = await this.request('/health');
        this.ready = response.ok;
        if (this.ready) this.message = 'Audio CNN service ready';
      } catch {
        this.ready = false;
      } finally {
        this.checking = false;
      }
    }, 1000);
    this.healthTimer.unref();
  },

  async stop() {
    this.stopping = true;
    clearInterval(this.healthTimer);
    if (this.child) {
      const child = this.child;
      await new Promise(resolve => {
        child.once('exit', resolve);
        child.kill();
        setTimeout(resolve, 3000).unref();
      });
    }
  },

  async openSession(nodeId, sessionId) {
    if (!this.ready) return false;
    try {
      const res = await this.request(`/nodes/${encodeURIComponent(nodeId)}/session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId })
      });
      return res.ok;
    } catch {
      return false;
    }
  },

  async closeSession(nodeId, sessionId) {
    if (!this.ready) return;
    try {
      await this.request(`/nodes/${encodeURIComponent(nodeId)}/session`, {
        method: 'DELETE',
        headers: { 'X-Camera-Session': sessionId }
      });
    } catch {
      /* ignore */
    }
    this.nodeAudioStates.delete(nodeId);
  },

  async recordResult(nodeId, result) {
    this.nodeAudioStates.set(nodeId, result);

    if (result.alert && (result.class === 'Gunshot' || result.class === 'Scream')) {
      await this.handleThreatAlert(nodeId, result);
    }
  },

  async handleThreatAlert(nodeId, result) {
    try { await recordAudioThreat(nodeId, result); }
    catch { console.error('[Audio Threat] Could not record incident; next classification will retry.'); }
  },

  getNodeAudio(nodeId) {
    const state = this.nodeAudioStates.get(nodeId);
    if (!state) {
      return {
        configured: true,
        class: 'Idle',
        confidence: 0.0,
        alert: false,
        threatType: null,
        status: 'clear'
      };
    }
    return {
      configured: true,
      class: state.class,
      confidence: state.confidence,
      alert: state.alert,
      threatType: state.threatType,
      probabilities: state.probabilities,
      inferenceMs: state.inferenceMs,
      timestamp: state.timestamp,
      status: state.alert ? 'alert' : 'clear'
    };
  }
};
