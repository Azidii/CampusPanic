"""Multi-node isolation, bounded scheduling and stale-output checks with synthetic frames."""
import threading
import time
import unittest
from types import SimpleNamespace

import cv2
import numpy as np

from security_worker import NodePipeline, create_app, jpeg_dimensions

KEY = 'private-test-worker-key-12345678901234567890'


class FakeDetector:
    threshold = .5

    def predict(self, frame):
        time.sleep(.01)
        return [], 10, 10


def wait_for(predicate, timeout=3):
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        if predicate():
            return True
        time.sleep(.01)
    return False


class SecurityWorkerChecks(unittest.TestCase):
    def setUp(self):
        self.pipeline = NodePipeline(FakeDetector(), stale_seconds=.3, max_nodes=2)
        self.pipeline.start()
        self.client = create_app(self.pipeline, KEY).test_client()
        _, encoded = cv2.imencode('.jpg', np.zeros((120, 160, 3), np.uint8))
        self.jpeg = encoded.tobytes()
        self.headers = {'X-Worker-Key': KEY}

    def tearDown(self):
        self.pipeline.stop()

    def open(self, node, session):
        return self.client.post(f'/nodes/{node}/session', headers=self.headers, json={'sessionId': session})

    def upload(self, node, session, data=None):
        return self.client.post(f'/nodes/{node}/frame', headers={**self.headers, 'X-Camera-Session': session},
                                data=data if data is not None else self.jpeg, content_type='image/jpeg')

    def test_private_auth_and_jpeg_validation(self):
        self.assertEqual(self.client.get('/health').status_code, 401)
        self.assertEqual(self.client.get('/health', headers=self.headers).status_code, 200)
        self.assertEqual(jpeg_dimensions(self.jpeg), (160, 120))
        self.open('A', 'session-a')
        self.assertEqual(self.upload('A', 'session-a', b'bad').status_code, 400)
        self.assertEqual(self.upload('A', 'session-a', b'x' * (2 * 1024 * 1024 + 1)).status_code, 413)
        self.assertEqual(self.upload('A', 'wrong').status_code, 409)

    def test_two_nodes_are_independent_and_capacity_is_bounded(self):
        self.assertEqual(self.open('A', 'a').status_code, 201)
        self.assertEqual(self.open('B', 'b').status_code, 201)
        self.assertEqual(self.open('C', 'c').status_code, 409)
        self.assertEqual(self.upload('A', 'a').status_code, 202)
        self.assertEqual(self.upload('B', 'b').status_code, 202)
        self.assertTrue(wait_for(lambda: all(self.pipeline.snapshot(n)[0]['live'] for n in ('A', 'B'))))
        self.pipeline.close('A', 'a')
        self.assertFalse(self.pipeline.snapshot('A')[0]['live'])
        self.assertTrue(self.pipeline.snapshot('B')[0]['live'])
        self.assertEqual(self.upload('A', 'a').status_code, 409)
        self.assertEqual(self.open('C', 'c').status_code, 201)

    def test_stale_output_is_hidden_and_old_session_cannot_close_replacement(self):
        self.open('A', 'old')
        self.upload('A', 'old')
        self.assertTrue(wait_for(lambda: self.pipeline.snapshot('A')[0]['live']))
        self.assertTrue(wait_for(lambda: not self.pipeline.snapshot('A')[0]['live']))
        self.assertEqual(self.client.get('/nodes/A/frame.jpg', headers=self.headers).status_code, 503)
        self.open('A', 'new')
        self.pipeline.close('A', 'old')
        self.assertEqual(self.upload('A', 'old').status_code, 409)
        self.assertEqual(self.upload('A', 'new').status_code, 202)

    def test_inflight_inference_is_discarded_after_session_replacement(self):
        entered, release = threading.Event(), threading.Event()
        class BlockingDetector:
            threshold = .5
            def predict(self, frame):
                entered.set()
                release.wait(2)
                return [], 0, 0
        self.pipeline.detector = BlockingDetector()
        self.open('A', 'old')
        self.upload('A', 'old')
        self.assertTrue(entered.wait(1))
        self.open('A', 'new')
        release.set()
        time.sleep(.04)
        self.assertIsNone(self.pipeline.snapshot('A')[1])
        self.assertEqual(self.pipeline.snapshot('A')[0]['framesProcessed'], 0)


if __name__ == '__main__':
    unittest.main()
