"""Decoder checks and synthetic LAN-stream plumbing checks, not model accuracy tests."""
import json
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from types import SimpleNamespace

import cv2
import numpy as np

from detector import Detector, decode, letterbox
from live_video import DEFAULT_MODEL, Pipeline, create_app, local_stream_url


def private_test_host():
    return '.'.join(map(str, [192, 168, 1, 2]))


def wait_until(predicate, seconds=10):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        if predicate():
            return True
        time.sleep(0.05)
    return False


class DecoderChecks(unittest.TestCase):
    def test_letterbox_and_inverse_boxes_with_nms(self):
        image, ratio, left, top = letterbox(np.zeros((480, 640, 3), np.uint8))
        self.assertEqual(image.shape, (640, 640, 3))
        self.assertEqual((ratio, left, top), (1.0, 0, 80))
        output = np.zeros((1, 5, 8400), np.float32)
        output[0, :, 0] = [.5, .5, .5, .375, .9]
        output[0, :, 1] = [.5, .5, .5, .375, .8]
        output[0, :, 2] = [.2, .2, .1, .1, .2]
        results = decode(output, (480, 640, 3), ratio, left, top, .5)
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0]['box'], [160, 120, 480, 360])
        self.assertAlmostEqual(results[0]['confidence'], .9, places=5)

    def test_portrait_mapping(self):
        _, ratio, left, top = letterbox(np.zeros((1280, 720, 3), np.uint8))
        output = np.zeros((1, 5, 8400), np.float32)
        output[0, :, 0] = [.5, .5, .25, .5, .75]
        results = decode(output, (1280, 720, 3), ratio, left, top, .5)
        self.assertEqual(results[0]['box'], [200, 320, 520, 960])

    def test_invalid_and_empty_predictions(self):
        output = np.zeros((1, 5, 8400), np.float32)
        output[0, :, 0] = [np.nan, .5, .5, .5, .9]
        self.assertEqual(decode(output, (480, 640, 3), 1, 0, 80, .5), [])

    def test_local_urls_only(self):
        self.assertEqual(local_stream_url(f'http://{private_test_host()}:8080'), f'http://{private_test_host()}:8080/video')
        with self.assertRaises(ValueError):
            local_stream_url('http://' + '.'.join(map(str, [8] * 4)) + '/video')
        with self.assertRaises(ValueError):
            local_stream_url('https://localhost/video')


class LivePlumbingCheck(unittest.TestCase):
    def test_actual_model_synthetic_stream_disconnect_and_reconnect(self):
        available = threading.Event()
        available.set()
        shutdown = threading.Event()
        _, encoded = cv2.imencode('.jpg', np.zeros((480, 640, 3), np.uint8))
        jpeg = encoded.tobytes()

        class CameraHandler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def do_GET(self):
                if not available.is_set():
                    self.send_error(503)
                    return
                self.send_response(200)
                self.send_header('Content-Type', 'multipart/x-mixed-replace; boundary=frame')
                self.end_headers()
                try:
                    while available.is_set() and not shutdown.is_set():
                        self.wfile.write(b'--frame\r\nContent-Type: image/jpeg\r\n\r\n' + jpeg + b'\r\n')
                        self.wfile.flush()
                        shutdown.wait(.02)
                except (ConnectionError, OSError):
                    pass

        camera = ThreadingHTTPServer(('localhost', 0), CameraHandler)
        camera_thread = threading.Thread(target=camera.serve_forever, daemon=True)
        camera_thread.start()
        detector = Detector(DEFAULT_MODEL)
        pipeline = Pipeline(detector, f'http://localhost:{camera.server_port}/video', stale_seconds=1)
        app = create_app(pipeline)
        client = app.test_client()
        try:
            self.assertEqual(client.get('/frame.jpg').status_code, 503)
            pipeline.start()
            self.assertTrue(wait_until(lambda: pipeline.snapshot()[0]['live']), 'No inferred synthetic frame')
            data = client.get('/api/status').get_json()
            self.assertEqual(data['status'], 'live')
            self.assertEqual((data['width'], data['height']), (640, 480))
            frame = client.get('/frame.jpg')
            self.assertEqual(frame.status_code, 200)
            self.assertIsNotNone(cv2.imdecode(np.frombuffer(frame.data, np.uint8), cv2.IMREAD_COLOR))
            stream = client.get('/video.mjpg', buffered=False)
            self.assertIn(b'Content-Type: image/jpeg', next(stream.response))
            stream.close()
            self.assertTrue(wait_until(lambda: pipeline.frames_processed >= 4))
            print('\nSYNTHETIC stream metrics:', json.dumps(pipeline.snapshot()[0]))
            available.clear()
            self.assertTrue(wait_until(lambda: pipeline.snapshot()[0]['status'] == 'disconnected'))
            self.assertFalse(client.get('/api/status').get_json()['live'])
            self.assertEqual(client.get('/api/status').get_json()['detections'], [])
            self.assertEqual(client.get('/frame.jpg').status_code, 503)
            available.set()
            self.assertTrue(wait_until(lambda: pipeline.snapshot()[0]['live']), 'Reconnect failed')
        finally:
            shutdown.set()
            pipeline.stop()
            camera.shutdown()
            camera.server_close()


class FreshnessChecks(unittest.TestCase):
    def test_stale_output_hides_old_detections_and_jpeg(self):
        pipeline = Pipeline(SimpleNamespace(threshold=.5), 'http://localhost/video')
        old = time.monotonic() - 10
        pipeline.camera_connected = True
        pipeline.camera_error = None
        pipeline.latest = (1, old, 'example', None)
        pipeline.result = {'sequence': 1, 'arrival': old, 'jpeg': b'old jpeg',
                           'detections': [{'label': 'gun', 'confidence': .9, 'box': [0, 0, 10, 10]}]}
        status, jpeg = pipeline.snapshot()
        self.assertEqual(status['status'], 'stale')
        self.assertEqual(status['detections'], [])
        self.assertIsNone(jpeg)
        client = create_app(pipeline).test_client()
        self.assertEqual(client.get('/frame.jpg').status_code, 503)


if __name__ == '__main__':
    unittest.main(verbosity=2)
