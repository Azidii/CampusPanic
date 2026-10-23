"""Android LAN MJPEG -> one laptop inference worker -> annotated local preview."""
import argparse
import ipaddress
import logging
import secrets
import socket
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit
from urllib.request import HTTPRedirectHandler, ProxyHandler, Request, build_opener

import cv2
import numpy as np
from flask import Flask, Response, jsonify, request, send_file
from waitress import serve

from detector import Detector, annotate

ROOT = Path(__file__).resolve().parent
DEFAULT_MODEL = Path.home() / 'Desktop/CampusPanic_plan/TFlite/gun_model.tflite'
LOG = logging.getLogger('campuspanic.video')


class NoRedirects(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ValueError('Use the direct local camera MJPEG URL (no redirects).')


def local_stream_url(value):
    parts = urlsplit(value)
    if parts.scheme != 'http' or not parts.hostname or parts.username or parts.password:
        raise ValueError('Use an HTTP MJPEG URL on the local network, without embedded credentials.')
    addresses = socket.getaddrinfo(parts.hostname, parts.port or 80, type=socket.SOCK_STREAM)
    if not addresses or any(not (ipaddress.ip_address(a[4][0]).is_private
                                 or ipaddress.ip_address(a[4][0]).is_loopback) for a in addresses):
        raise ValueError('The camera address must be on the local network.')
    path = parts.path if parts.path not in ('', '/') else '/video'
    return urlunsplit((parts.scheme, parts.netloc, path, parts.query, ''))


def utc_now():
    return datetime.now(timezone.utc).isoformat()


class Pipeline:
    def __init__(self, detector, stream_url, stale_seconds=3.0):
        self.detector, self.stream_url = detector, stream_url
        self.stale_seconds = stale_seconds
        self.stop_event = threading.Event()
        self.changed = threading.Condition()
        self.latest = None  # One-slot mailbox: capture continually replaces this frame.
        self.capture_seq = 0
        self.connection_generation = 0
        self.result = None
        self.camera_connected = False
        self.camera_error = 'Waiting for Android camera app' if stream_url is None else 'Waiting for phone stream'
        self.push_session = None
        self.push_activity = None
        self.inference_error = None
        self.frames_processed = 0
        self.dropped_frames = 0
        self.threads = []

    def start(self):
        for target in ((self._capture if self.stream_url else self._watch_push), self._infer):
            thread = threading.Thread(target=target, daemon=True)
            thread.start()
            self.threads.append(thread)

    def stop(self):
        self.stop_event.set()
        with self.changed:
            self.changed.notify_all()
        for thread in self.threads:
            thread.join(timeout=4)

    def _disconnect_push(self, message):
        # Called only while holding self.changed.
        self.push_session = None
        self.camera_connected = False
        self.camera_error = message
        self.latest = None
        self.result = None
        self.connection_generation += 1
        self.changed.notify_all()

    def open_push_session(self):
        with self.changed:
            if self.push_session and time.monotonic() - self.push_activity < self.stale_seconds:
                return None
            self._disconnect_push('Waiting for camera frames')
            self.push_session = secrets.token_hex(16)
            self.push_activity = time.monotonic()
            return self.push_session

    def accept_push_frame(self, session, frame):
        with self.changed:
            if not session or session != self.push_session:
                return None
            now = time.monotonic()
            self.capture_seq += 1
            self.latest = (self.capture_seq, now, utc_now(), frame)
            self.push_activity = now
            self.camera_connected = True
            self.camera_error = None
            self.changed.notify_all()
            return self.capture_seq

    def close_push_session(self, session):
        with self.changed:
            if session and session == self.push_session:
                self._disconnect_push('Android camera stopped')
                return True
            return False

    def _watch_push(self):
        while not self.stop_event.wait(.25):
            with self.changed:
                if self.push_session and time.monotonic() - self.push_activity >= self.stale_seconds:
                    self._disconnect_push('Android camera disconnected: no fresh frames')

    def _capture(self):
        # No system proxy: phone video stays on the local network.
        opener = build_opener(ProxyHandler({}), NoRedirects())
        while not self.stop_event.is_set():
            try:
                request = Request(self.stream_url, headers={'User-Agent': 'CampusPanic-LAN/1.0'})
                with opener.open(request, timeout=2) as response:
                    if response.geturl() != self.stream_url:
                        raise ValueError('Use the direct camera MJPEG URL (no redirects).')
                    content_type = response.headers.get('Content-Type', '').lower()
                    if 'multipart/' not in content_type:
                        raise ValueError('Expected an MJPEG stream. For IP Webcam use the address ending /video.')
                    buffer = b''
                    while not self.stop_event.is_set():
                        chunk = response.read1(65536)
                        if not chunk:
                            raise ConnectionError('Phone stream ended')
                        buffer += chunk
                        # Consume complete JPEGs and retain only the newest decoded image.
                        newest = None
                        while True:
                            begin = buffer.find(b'\xff\xd8')
                            end = buffer.find(b'\xff\xd9', max(begin, 0))
                            if begin < 0 or end < 0:
                                break
                            newest = buffer[begin:end + 2]
                            buffer = buffer[end + 2:]
                        if len(buffer) > 8 * 1024 * 1024:
                            raise ValueError('Invalid or oversized MJPEG frame')
                        if newest:
                            frame = cv2.imdecode(np.frombuffer(newest, np.uint8), cv2.IMREAD_COLOR)
                            if frame is None:
                                continue
                            with self.changed:
                                self.capture_seq += 1
                                self.latest = (self.capture_seq, time.monotonic(), utc_now(), frame)
                                self.camera_connected = True
                                self.camera_error = None
                                self.changed.notify_all()
            except Exception as exc:
                LOG.warning('Camera unavailable: %s', exc)
                with self.changed:
                    self.camera_connected = False
                    self.camera_error = str(exc)
                    self.latest = None
                    self.result = None
                    self.connection_generation += 1
                    self.changed.notify_all()
                self.stop_event.wait(1)

    def _infer(self):
        last_seq = 0
        while not self.stop_event.is_set():
            with self.changed:
                self.changed.wait_for(lambda: self.stop_event.is_set() or
                                      (self.latest is not None and self.latest[0] > last_seq), timeout=0.5)
                if self.stop_event.is_set():
                    return
                if self.latest is None or self.latest[0] <= last_seq:
                    continue
                seq, arrival, arrived_at, frame = self.latest
                generation = self.connection_generation
            if time.monotonic() - arrival > self.stale_seconds:
                last_seq = seq
                continue
            try:
                detections, inference_ms, processing_ms = self.detector.predict(frame)
                image = annotate(frame, detections, inference_ms)
                ok, jpeg = cv2.imencode('.jpg', image, [cv2.IMWRITE_JPEG_QUALITY, 85])
                if not ok:
                    raise ValueError('JPEG encoding failed')
                with self.changed:
                    # Never republish an inference that completed after a disconnect.
                    if (self.camera_connected and self.latest is not None
                            and generation == self.connection_generation):
                        self.result = {'sequence': seq, 'arrival': arrival, 'arrivedAt': arrived_at,
                                       'predictedAt': utc_now(), 'jpeg': jpeg.tobytes(),
                                       'detections': detections, 'inferenceMs': inference_ms,
                                       'processingMs': processing_ms,
                                       'width': frame.shape[1], 'height': frame.shape[0]}
                        self.frames_processed += 1
                        self.dropped_frames += max(0, seq - last_seq - 1)
                        self.inference_error = None
                        self.changed.notify_all()
            except Exception as exc:
                LOG.exception('Inference failed')
                with self.changed:
                    self.result = None
                    self.inference_error = str(exc)
            last_seq = seq

    def snapshot(self):
        with self.changed:
            now = time.monotonic()
            result = self.result
            capture_age = now - self.latest[1] if self.latest else None
            result_age = now - result['arrival'] if result else None
            live = bool(self.camera_connected and not self.inference_error and result
                        and capture_age is not None and capture_age < self.stale_seconds
                        and result_age < self.stale_seconds)
            status = ('live' if live else 'error' if self.inference_error else
                      'disconnected' if not self.camera_connected else
                      'stale' if capture_age is not None and capture_age >= self.stale_seconds else
                      'processing')
            public = {k: v for k, v in (result or {}).items() if k not in ('jpeg', 'arrival', 'detections')}
            public.update(status=status, live=live, cameraConnected=self.camera_connected,
                          inputMode='android-app' if self.stream_url is None else 'mjpeg-camera',
                          frameAgeMs=round(result_age * 1000) if result_age is not None else None,
                          detections=result['detections'] if live else [],
                          framesProcessed=self.frames_processed, droppedFrames=self.dropped_frames,
                          confidenceThreshold=self.detector.threshold,
                          error=self.inference_error or self.camera_error,
                          timingNote='Laptop frame arrival and inference timing; phone capture time is unavailable.')
            return public, result['jpeg'] if live else None


def create_app(pipeline, pair_code=None):
    app = Flask(__name__)
    app.config['MAX_CONTENT_LENGTH'] = 2 * 1024 * 1024

    @app.before_request
    def authenticate_camera():
        if request.path.startswith('/api/camera/'):
            if pipeline.stream_url is not None or pair_code is None:
                return jsonify(error='Android upload mode is not enabled'), 404
            supplied = request.headers.get('X-Camera-Token', '')
            if not secrets.compare_digest(supplied, pair_code):
                return jsonify(error='Pairing code does not match the laptop'), 401

    @app.post('/api/camera/connect')
    def connect_camera():
        session = pipeline.open_push_session()
        if session is None:
            return jsonify(error='A camera is already connected; stop it or wait three seconds'), 409
        return jsonify(sessionId=session), 201

    @app.post('/api/camera/frame')
    def receive_frame():
        if request.mimetype != 'image/jpeg':
            return jsonify(error='Expected image/jpeg'), 415
        # Check session before JPEG decoding to reject old senders cheaply.
        session = request.headers.get('X-Camera-Session')
        with pipeline.changed:
            if not session or session != pipeline.push_session:
                return jsonify(error='Camera session expired; reconnect'), 409
        encoded = request.get_data()
        if not encoded.startswith(b'\xff\xd8') or len(encoded) < 4:
            return jsonify(error='Invalid JPEG'), 400
        frame = cv2.imdecode(np.frombuffer(encoded, np.uint8), cv2.IMREAD_COLOR)
        if frame is None or max(frame.shape[:2]) > 1920:
            return jsonify(error='Expected a valid camera JPEG, at most 1920 pixels per side'), 400
        sequence = pipeline.accept_push_frame(session, frame)
        if sequence is None:
            return jsonify(error='Camera session expired; reconnect'), 409
        return jsonify(accepted=True, sequence=sequence), 202

    @app.post('/api/camera/disconnect')
    def disconnect_camera():
        pipeline.close_push_session(request.headers.get('X-Camera-Session'))
        return '', 204

    @app.after_request
    def no_cache(response):
        response.headers['Cache-Control'] = 'no-store'
        return response

    @app.get('/')
    def preview():
        return send_file(ROOT / 'preview.html')

    @app.get('/download/camera.apk')
    def download_camera():
        apk = ROOT.parent / 'Android-Camera/releases/CampusPanicCamera-debug.apk'
        if not apk.is_file():
            return jsonify(error='The Android APK has not been built on this laptop yet'), 404
        return send_file(apk, mimetype='application/vnd.android.package-archive',
                         as_attachment=True, download_name='CampusPanicCamera-debug.apk')

    @app.get('/api/status')
    def status():
        return jsonify(pipeline.snapshot()[0])

    @app.get('/frame.jpg')
    def frame():
        status, jpeg = pipeline.snapshot()
        if jpeg is None:
            return jsonify(status), 503
        return Response(jpeg, mimetype='image/jpeg')

    @app.get('/video.mjpg')
    def video():
        def frames():
            sequence = None
            while not pipeline.stop_event.is_set():
                status, jpeg = pipeline.snapshot()
                if jpeg is None:
                    # End the response on stale/disconnect so consumers can show offline.
                    return
                if sequence != status['sequence']:
                    sequence = status['sequence']
                    yield (b'--frame\r\nContent-Type: image/jpeg\r\nContent-Length: '
                           + str(len(jpeg)).encode() + b'\r\n\r\n' + jpeg + b'\r\n')
                with pipeline.changed:
                    pipeline.changed.wait(timeout=0.25)
        return Response(frames(), mimetype='multipart/x-mixed-replace; boundary=frame')

    return app


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--stream-url', help='Optional external HTTP MJPEG camera URL')
    mode.add_argument('--phone-app', action='store_true', help='Receive video from the Campus Panic Android app')
    parser.add_argument('--pair-code', help='Optional 8-digit pairing code; generated if omitted')
    parser.add_argument('--model', type=Path, default=DEFAULT_MODEL)
    parser.add_argument('--confidence', type=float, default=0.5)
    parser.add_argument('--threads', type=int, default=4)
    parser.add_argument('--share-on-lan', action='store_true', help='Listen on the local network instead of localhost')
    parser.add_argument('--port', type=int, default=5055)
    args = parser.parse_args()
    if not 0 < args.confidence <= 1 or args.threads < 1:
        parser.error('Confidence must be > 0 and <= 1; threads must be positive.')
    logging.basicConfig(level=logging.INFO, format='%(asctime)s %(message)s')
    try:
        stream_url = local_stream_url(args.stream_url) if args.stream_url else None
    except (ValueError, OSError) as exc:
        parser.error(str(exc))
    detector = Detector(args.model, args.confidence, args.threads)
    pair_code = args.pair_code or f'{secrets.randbelow(100_000_000):08d}'
    if len(pair_code) != 8 or not pair_code.isascii() or not pair_code.isdigit():
        parser.error('Pairing code must contain exactly eight digits.')
    pipeline = Pipeline(detector, stream_url)
    pipeline.start()
    LOG.info('Preview: http://localhost:%s | Waiting for real phone frames', args.port)
    if args.phone_app:
        LOG.info('Android app pairing code: %s | Enter the laptop Wi-Fi IP and port %s in the app', pair_code, args.port)
    try:
        serve(create_app(pipeline, pair_code if args.phone_app else None), host=socket.inet_ntoa(bytes(4)) if args.share_on_lan else 'localhost', port=args.port, threads=8)
    except KeyboardInterrupt:
        pass
    finally:
        pipeline.stop()


if __name__ == '__main__':
    main()
