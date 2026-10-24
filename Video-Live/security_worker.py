"""Private multi-node inference service. The Express gateway authenticates phones.

One interpreter, a latest-frame slot per node, and round-robin scheduling keep
memory bounded and prevent one fast sender from monopolizing inference.
"""
import argparse
import hmac
import os
import threading
import time
from collections import OrderedDict
from datetime import datetime, timezone
from pathlib import Path

import cv2
import numpy as np
from flask import Flask, Response, jsonify, request
from waitress import serve

from detector import Detector, annotate


def utc_now():
    return datetime.now(timezone.utc).isoformat()


class NodePipeline:
    def __init__(self, detector, stale_seconds=3, max_nodes=8):
        self.detector = detector
        self.stale_seconds = stale_seconds
        self.max_nodes = max_nodes
        self.nodes = OrderedDict()
        self.changed = threading.Condition()
        self.stopped = False
        self.thread = None

    def start(self):
        self.thread = threading.Thread(target=self._infer, daemon=True)
        self.thread.start()

    def stop(self):
        with self.changed:
            self.stopped = True
            self.changed.notify_all()
        if self.thread:
            self.thread.join(timeout=5)

    def open(self, node_id, session):
        with self.changed:
            if node_id not in self.nodes and len(self.nodes) >= self.max_nodes:
                # Inactive sessions can be reclaimed without retaining old frames.
                for key in list(self.nodes):
                    if time.monotonic() - self.nodes[key]['activity'] > self.stale_seconds:
                        del self.nodes[key]
            if node_id not in self.nodes and len(self.nodes) >= self.max_nodes:
                return False
            self.nodes[node_id] = dict(session=session, activity=time.monotonic(),
                                       latest=None, result=None, sequence=0, processed=0, error=None)
            self.changed.notify_all()
            return True

    def close(self, node_id, session):
        with self.changed:
            state = self.nodes.get(node_id)
            if state and state['session'] == session:
                del self.nodes[node_id]
                self.changed.notify_all()

    def accept(self, node_id, session, frame):
        with self.changed:
            state = self.nodes.get(node_id)
            if not state or state['session'] != session:
                return None
            now = time.monotonic()
            if now - state['activity'] >= self.stale_seconds:
                del self.nodes[node_id]
                return None
            state['sequence'] += 1
            state['activity'] = now
            state['latest'] = (state['sequence'], now, utc_now(), frame)
            self.changed.notify_all()
            return state['sequence']

    def _infer(self):
        while True:
            with self.changed:
                self.changed.wait_for(lambda: self.stopped or any(
                    s['latest'] is not None for s in self.nodes.values()), timeout=.25)
                if self.stopped:
                    return
                candidate = next(((k, s) for k, s in self.nodes.items() if s['latest'] is not None), None)
                if candidate is None:
                    continue
                node_id, state = candidate
                item = state['latest']
                state['latest'] = None
                self.nodes.move_to_end(node_id)
            sequence, arrival, arrived_at, frame = item
            if time.monotonic() - arrival >= self.stale_seconds:
                continue
            try:
                detections, inference_ms, processing_ms = self.detector.predict(frame)
                ok, encoded = cv2.imencode('.jpg', annotate(frame, detections, inference_ms),
                                            [cv2.IMWRITE_JPEG_QUALITY, 80])
                if not ok:
                    raise ValueError('JPEG encoding failed')
                with self.changed:
                    # Identity fences off work that finished after delete/re-pair.
                    if self.nodes.get(node_id) is state and time.monotonic() - arrival < self.stale_seconds:
                        state['result'] = dict(sequence=sequence, arrival=arrival, arrivedAt=arrived_at,
                            predictedAt=utc_now(), jpeg=encoded.tobytes(), detections=detections,
                            inferenceMs=round(inference_ms, 1), processingMs=round(processing_ms, 1),
                            width=frame.shape[1], height=frame.shape[0])
                        state['processed'] += 1
                        state['error'] = None
                        self.changed.notify_all()
            except Exception:
                with self.changed:
                    if self.nodes.get(node_id) is state:
                        state['result'] = None
                        state['error'] = 'Model processing failed'

    def snapshot(self, node_id):
        with self.changed:
            state = self.nodes.get(node_id)
            now = time.monotonic()
            connected = bool(state and now - state['activity'] < self.stale_seconds)
            result = state['result'] if connected else None
            live = bool(result and now - result['arrival'] < self.stale_seconds)
            status = 'live' if live else ('error' if connected and state['error'] else
                                         'processing' if connected else 'offline')
            data = dict(nodeId=node_id, live=live, cameraConnected=connected, status=status,
                        detections=[], framesProcessed=state['processed'] if state else 0,
                        confidenceThreshold=self.detector.threshold, audioStatus='not_configured')
            if live:
                data.update({k: v for k, v in result.items() if k not in ('jpeg', 'arrival')})
                data['frameAgeMs'] = round((now - result['arrival']) * 1000)
            if connected and state['error']:
                data['error'] = state['error']
            return data, result['jpeg'] if live else None


def jpeg_dimensions(encoded):
    """Read JPEG SOF before decoding, so a tiny compressed image cannot expand unchecked."""
    if not encoded.startswith(b'\xff\xd8'):
        return None
    offset = 2
    while offset + 4 <= len(encoded):
        if encoded[offset] != 255:
            return None
        while offset < len(encoded) and encoded[offset] == 255:
            offset += 1
        if offset >= len(encoded):
            return None
        marker = encoded[offset]
        offset += 1
        if marker in (0xD9, 0xDA):
            return None
        if marker in (0xD8, 0x01) or 0xD0 <= marker <= 0xD7:
            continue
        if offset + 2 > len(encoded):
            return None
        length = int.from_bytes(encoded[offset:offset + 2], 'big')
        if length < 2 or offset + length > len(encoded):
            return None
        if marker in (0xC0, 0xC1, 0xC2):
            if length < 8:
                return None
            return (int.from_bytes(encoded[offset + 5:offset + 7], 'big'),
                    int.from_bytes(encoded[offset + 3:offset + 5], 'big'))
        offset += length
    return None


def create_app(pipeline, worker_key):
    app = Flask(__name__)
    app.config['MAX_CONTENT_LENGTH'] = 2 * 1024 * 1024

    @app.before_request
    def authorize():
        if not worker_key or not hmac.compare_digest(request.headers.get('X-Worker-Key', ''), worker_key):
            return jsonify(error='Unauthorized'), 401

    @app.after_request
    def no_store(response):
        response.headers['Cache-Control'] = 'no-store'
        return response

    @app.get('/health')
    def health():
        return jsonify(ready=True, maxNodes=pipeline.max_nodes)

    @app.get('/status')
    def statuses():
        with pipeline.changed:
            keys = list(pipeline.nodes)
        return jsonify(nodes={key: pipeline.snapshot(key)[0] for key in keys})

    @app.post('/nodes/<node_id>/session')
    def connect(node_id):
        session = (request.get_json(silent=True) or {}).get('sessionId')
        if not isinstance(session, str) or len(session) > 100 or not session:
            return jsonify(error='Session required'), 400
        if not pipeline.open(node_id, session):
            return jsonify(error='Maximum concurrent nodes reached'), 409
        return jsonify(ready=True), 201

    @app.delete('/nodes/<node_id>/session')
    def disconnect(node_id):
        pipeline.close(node_id, request.headers.get('X-Camera-Session'))
        return '', 204

    @app.post('/nodes/<node_id>/frame')
    def upload(node_id):
        if request.mimetype != 'image/jpeg':
            return jsonify(error='Expected image/jpeg'), 415
        encoded = request.get_data()
        size = jpeg_dimensions(encoded)
        if not size or min(size) < 1 or max(size) > 1920:
            return jsonify(error='Expected a JPEG at most 1920 pixels per side'), 400
        frame = cv2.imdecode(np.frombuffer(encoded, np.uint8), cv2.IMREAD_COLOR)
        if frame is None:
            return jsonify(error='Invalid JPEG'), 400
        sequence = pipeline.accept(node_id, request.headers.get('X-Camera-Session'), frame)
        if sequence is None:
            return jsonify(error='Camera session expired; reconnect'), 409
        return jsonify(accepted=True, sequence=sequence), 202

    @app.get('/nodes/<node_id>/status')
    def status(node_id):
        return jsonify(pipeline.snapshot(node_id)[0])

    @app.get('/nodes/<node_id>/frame.jpg')
    def frame(node_id):
        data, jpeg = pipeline.snapshot(node_id)
        return Response(jpeg, mimetype='image/jpeg') if jpeg else (jsonify(data), 503)

    return app


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--model', required=True, type=Path)
    parser.add_argument('--port', type=int, default=5056)
    parser.add_argument('--confidence', type=float, default=.5)
    parser.add_argument('--threads', type=int, default=4)
    parser.add_argument('--max-nodes', type=int, default=8)
    args = parser.parse_args()
    key = os.environ.get('CAMPUSPANIC_WORKER_KEY', '')
    if len(key) < 32 or not 0 < args.confidence <= 1 or args.threads < 1 or args.max_nodes < 1:
        parser.error('Worker key and valid inference settings are required')
    pipeline = NodePipeline(Detector(args.model, args.confidence, args.threads), max_nodes=args.max_nodes)
    pipeline.start()
    try:
        serve(create_app(pipeline, key), host='127.0.0.1', port=args.port, threads=8)
    finally:
        pipeline.stop()


if __name__ == '__main__':
    main()
