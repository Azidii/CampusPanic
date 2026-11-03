"""Private multi-node Audio CNN inference service for CampusPanic.

Receives 1-second raw PCM audio chunks from security phones, computes FFT/Log-Mel
spectrograms matching the Audio-CNN training pipeline, and evaluates them with
the trained .keras model to detect gunshots and screams in real time.
"""
import argparse
import hmac
import json
import os
import threading
import time
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd
import tensorflow as tf
from flask import Flask, jsonify, request
from waitress import serve

# Disable oneDNN warning noise and GPU check logs
os.environ['TF_ENABLE_ONEDNN_OPTS'] = '0'
os.environ['TF_CPP_MIN_LOG_LEVEL'] = '2'


def utc_now():
    return datetime.now(timezone.utc).isoformat()


class AudioPipeline:
    def __init__(self, model_path, classes_path, threshold=0.55, max_nodes=16):
        self.threshold = threshold
        self.max_nodes = max_nodes
        self.lock = threading.Lock()
        self.nodes = {}  # nodeId -> { sessionId, lastActivity, latestResult }

        # Load classes mapping
        with open(classes_path, 'r', encoding='utf-8') as f:
            self.classes = json.load(f)

        # Load trained Keras model
        print(f"[AudioWorker] Loading Keras model from {model_path}...")
        self.model = tf.keras.models.load_model(str(model_path))
        print(f"[AudioWorker] Model loaded. Classes: {self.classes}")

        # Precompute Mel weight matrix for 16kHz
        self.sample_rate = 16000
        self.frame_length = 512
        self.frame_step = 160
        self.fft_length = 512
        self.n_mels = 128
        self.num_spectrogram_bins = (self.fft_length // 2) + 1
        self.mel_weights = tf.signal.linear_to_mel_weight_matrix(
            num_mel_bins=self.n_mels,
            num_spectrogram_bins=self.num_spectrogram_bins,
            sample_rate=self.sample_rate,
            lower_edge_hertz=20.0,
            upper_edge_hertz=8000.0
        )

        # Warm up graph execution with dummy input
        dummy = np.zeros((1, 97, 128, 1), dtype=np.float32)
        _ = self.model(dummy, training=False)
        print("[AudioWorker] Warm-up inference complete. Worker ready.")

    def open_session(self, node_id, session_id):
        with self.lock:
            if node_id not in self.nodes and len(self.nodes) >= self.max_nodes:
                return False
            self.nodes[node_id] = {
                'sessionId': session_id,
                'lastActivity': time.monotonic(),
                'latestResult': {
                    'class': 'Non-Scream',
                    'confidence': 1.0,
                    'alert': False,
                    'threatType': None,
                    'probabilities': {'Gunshot': 0.0, 'Non-Scream': 1.0, 'Scream': 0.0},
                    'inferenceMs': 0.0,
                    'timestamp': utc_now()
                }
            }
            return True

    def close_session(self, node_id, session_id):
        with self.lock:
            node = self.nodes.get(node_id)
            if node and (not session_id or node['sessionId'] == session_id):
                self.nodes.pop(node_id, None)

    def extract_mel_spectrogram(self, audio_signal):
        signal_tensor = tf.convert_to_tensor(audio_signal, dtype=tf.float32)
        stfts = tf.signal.stft(
            signal_tensor,
            frame_length=self.frame_length,
            frame_step=self.frame_step,
            fft_length=self.fft_length
        )
        spectrograms = tf.abs(stfts)
        mel_spec = tf.tensordot(spectrograms, self.mel_weights, 1)
        log_mel = tf.math.log(mel_spec + 1e-6)
        log_mel = tf.expand_dims(log_mel, axis=-1)
        return tf.expand_dims(log_mel, axis=0)

    def preprocess_pcm(self, raw_bytes):
        # 16-bit signed PCM mono
        audio = np.frombuffer(raw_bytes, dtype=np.int16).astype(np.float32) / 32768.0

        # Silence trimming using signal envelope (Seth Adams approach)
        if len(audio) > 0:
            s = pd.Series(np.abs(audio))
            window_size = max(int(self.sample_rate / 20), 1)  # 50ms window
            y_env = s.rolling(window=window_size, min_periods=1, center=True).max().to_numpy()
            mask = y_env > 0.005
            active = audio[mask]
            if len(active) >= int(self.sample_rate * 0.1):  # at least 100ms
                audio = active

        # Fix duration to exactly 16000 samples (1.0 second)
        target_len = self.sample_rate
        if len(audio) > target_len:
            audio = audio[:target_len]
        elif len(audio) < target_len:
            pad_width = target_len - len(audio)
            audio = np.pad(audio, (0, pad_width), mode='constant')

        return audio

    def infer(self, node_id, session_id, raw_pcm_bytes):
        with self.lock:
            node = self.nodes.get(node_id)
            if not node or node['sessionId'] != session_id:
                return None, 'invalid_session'
            node['lastActivity'] = time.monotonic()

        t0 = time.perf_counter()
        try:
            audio = self.preprocess_pcm(raw_pcm_bytes)
            inp = self.extract_mel_spectrogram(audio)

            # Direct callable inference is faster and thread-safe in Keras 3
            preds = self.model(inp, training=False).numpy()[0]
            best_idx = int(np.argmax(preds))
            best_class = self.classes[best_idx]
            confidence = float(preds[best_idx])
            inference_ms = (time.perf_counter() - t0) * 1000

            # Threat determination
            is_threat = (best_class in ('Gunshot', 'Scream')) and (confidence >= self.threshold)
            threat_type = best_class.lower() if is_threat else None

            prob_dict = {cls_name: round(float(prob), 4) for cls_name, prob in zip(self.classes, preds)}

            result = {
                'nodeId': node_id,
                'class': best_class,
                'confidence': round(confidence, 4),
                'alert': is_threat,
                'threatType': threat_type,
                'probabilities': prob_dict,
                'inferenceMs': round(inference_ms, 1),
                'timestamp': utc_now()
            }

            with self.lock:
                if node_id in self.nodes:
                    self.nodes[node_id]['latestResult'] = result

            return result, None

        except Exception as e:
            return None, str(e)

    def snapshot(self, node_id):
        with self.lock:
            node = self.nodes.get(node_id)
            if not node:
                return None
            stale = (time.monotonic() - node['lastActivity']) > 5.0
            res = dict(node['latestResult'])
            res['stale'] = stale
            return res

    def all_states(self):
        with self.lock:
            now = time.monotonic()
            res = {}
            for nid, n in self.nodes.items():
                stale = (now - n['lastActivity']) > 5.0
                r = dict(n['latestResult'])
                r['stale'] = stale
                res[nid] = r
            return res


def create_app(pipeline, worker_key):
    app = Flask(__name__)

    @app.before_request
    def authenticate():
        incoming_key = request.headers.get('X-Worker-Key', '')
        if not hmac.compare_digest(incoming_key, worker_key):
            return jsonify(error='Unauthorized worker key'), 401

    @app.get('/health')
    def health():
        return jsonify(status='healthy', timestamp=utc_now(), service='CampusPanic Audio Worker')

    @app.get('/status')
    def status():
        return jsonify(nodes=pipeline.all_states(), timestamp=utc_now())

    @app.post('/nodes/<node_id>/session')
    def connect(node_id):
        session = (request.get_json(silent=True) or {}).get('sessionId')
        if not isinstance(session, str) or not session or len(session) > 100:
            return jsonify(error='Valid sessionId required'), 400
        if not pipeline.open_session(node_id, session):
            return jsonify(error='Maximum concurrent audio nodes reached'), 409
        return jsonify(ready=True, nodeId=node_id), 201

    @app.delete('/nodes/<node_id>/session')
    def disconnect(node_id):
        session = request.headers.get('X-Camera-Session')
        pipeline.close_session(node_id, session)
        return '', 204

    @app.post('/nodes/<node_id>/audio')
    def upload_audio(node_id):
        session = request.headers.get('X-Camera-Session')
        if not session:
            return jsonify(error='X-Camera-Session required'), 401

        raw_pcm = request.get_data()
        # 16kHz 16-bit mono = 32000 bytes per second.
        # Allow +/- 20% tolerance in buffer size (25,000 to 45,000 bytes).
        if len(raw_pcm) < 1000 or len(raw_pcm) > 100000:
            return jsonify(error=f'Invalid PCM size: {len(raw_pcm)} bytes. Expected ~32000 bytes (1s).'), 400

        result, err = pipeline.infer(node_id, session, raw_pcm)
        if err == 'invalid_session':
            return jsonify(error='Audio session expired or not found; reconnect'), 409
        elif err:
            return jsonify(error=f'Inference failed: {err}'), 500

        return jsonify(result), 200

    @app.get('/nodes/<node_id>/status')
    def node_status(node_id):
        state = pipeline.snapshot(node_id)
        if not state:
            return jsonify(error='Node not active'), 404
        return jsonify(state), 200

    return app


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--model', required=True, type=Path, help='Path to best_cnn_model.keras')
    parser.add_argument('--classes', required=True, type=Path, help='Path to classes.json')
    parser.add_argument('--port', type=int, default=5057, help='Worker port (default: 5057)')
    parser.add_argument('--threshold', type=float, default=0.55, help='Threat confidence threshold')
    parser.add_argument('--threads', type=int, default=8, help='Worker server threads')
    parser.add_argument('--max-nodes', type=int, default=16, help='Max concurrent nodes')
    args = parser.parse_args()

    key = os.environ.get('CAMPUSPANIC_AUDIO_KEY', '')
    if len(key) < 32:
        raise ValueError('Worker key CAMPUSPANIC_AUDIO_KEY must be at least 32 characters.')

    pipeline = AudioPipeline(
        model_path=args.model,
        classes_path=args.classes,
        threshold=args.threshold,
        max_nodes=args.max_nodes
    )

    app = create_app(pipeline, key)
    print(f"[AudioWorker] Serving on 127.0.0.1:{args.port} with {args.threads} threads...")
    serve(app, host='127.0.0.1', port=args.port, threads=args.threads)


if __name__ == '__main__':
    main()

