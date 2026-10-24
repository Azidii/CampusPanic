"""Android wire-protocol tests using generated JPEGs; no real-phone claim."""
import secrets
import unittest
from types import SimpleNamespace

import cv2
import numpy as np

from detector import Detector
from live_video import DEFAULT_MODEL, Pipeline, create_app
from test_video import wait_until

CODE = f'{secrets.randbelow(100_000_000):08d}'
AUTH = {'X-Camera-Token': CODE}


class UploadProtocolChecks(unittest.TestCase):
    def setUp(self):
        self.pipeline = Pipeline(SimpleNamespace(threshold=.5), None)
        self.app = create_app(self.pipeline, CODE)
        self.client = self.app.test_client()
        _, image = cv2.imencode('.jpg', np.zeros((480, 640, 3), np.uint8))
        self.jpeg = image.tobytes()

    def connect(self):
        response = self.client.post('/api/camera/connect', headers=AUTH)
        self.assertEqual(response.status_code, 201)
        return {**AUTH, 'X-Camera-Session': response.get_json()['sessionId']}

    def test_pairing_content_and_session_validation(self):
        self.assertEqual(self.client.post('/api/camera/connect').status_code, 401)
        headers = self.connect()
        self.assertEqual(self.client.post('/api/camera/connect', headers=AUTH).status_code, 409)
        self.assertEqual(self.client.post('/api/camera/frame', headers=AUTH,
                                         data=self.jpeg, content_type='image/jpeg').status_code, 409)
        self.assertEqual(self.client.post('/api/camera/frame', headers=headers,
                                         data=b'garbage', content_type='image/jpeg').status_code, 400)
        self.assertEqual(self.client.post('/api/camera/frame', headers=headers,
                                         data=self.jpeg, content_type='application/octet-stream').status_code, 415)
        self.assertEqual(self.client.post('/api/camera/frame', headers=headers,
                                         data=b'x' * (2 * 1024 * 1024 + 1), content_type='image/jpeg').status_code, 413)
        response = self.client.post('/api/camera/frame', headers=headers, data=self.jpeg, content_type='image/jpeg')
        self.assertEqual(response.status_code, 202)
        self.assertEqual(response.get_json()['sequence'], 1)
        self.client.post('/api/camera/disconnect', headers=headers)
        self.assertFalse(self.pipeline.snapshot()[0]['cameraConnected'])

    def test_old_session_cannot_stop_or_feed_new_session(self):
        old_headers = self.connect()
        self.client.post('/api/camera/disconnect', headers=old_headers)
        new_headers = self.connect()
        self.client.post('/api/camera/disconnect', headers=old_headers)
        self.assertEqual(self.client.post('/api/camera/frame', headers=old_headers,
                                         data=self.jpeg, content_type='image/jpeg').status_code, 409)
        self.assertEqual(self.client.post('/api/camera/frame', headers=new_headers,
                                         data=self.jpeg, content_type='image/jpeg').status_code, 202)


class UploadInferenceCheck(unittest.TestCase):
    def test_actual_model_upload_freshness_and_reconnect(self):
        pipeline = Pipeline(Detector(DEFAULT_MODEL), None, stale_seconds=.6)
        client = create_app(pipeline, CODE).test_client()
        _, image = cv2.imencode('.jpg', np.zeros((480, 640, 3), np.uint8))
        try:
            pipeline.start()
            session = client.post('/api/camera/connect', headers=AUTH).get_json()['sessionId']
            headers = {**AUTH, 'X-Camera-Session': session}
            response = client.post('/api/camera/frame', headers=headers, data=image.tobytes(), content_type='image/jpeg')
            self.assertEqual(response.status_code, 202)
            # Model cold start can exceed this test's short stale window. Keep
            # sending fresh frames, as the real app does, rather than timing
            # model initialization against a single upload's expiry.
            def feed_until_live():
                upload = client.post('/api/camera/frame', headers=headers,
                                     data=image.tobytes(), content_type='image/jpeg')
                self.assertEqual(upload.status_code, 202)
                return pipeline.snapshot()[0]['live']
            self.assertTrue(wait_until(feed_until_live))
            data = client.get('/api/status').get_json()
            self.assertEqual(data['inputMode'], 'android-app')
            self.assertEqual((data['width'], data['height']), (640, 480))
            self.assertEqual(client.get('/frame.jpg').status_code, 200)
            self.assertTrue(wait_until(lambda: pipeline.snapshot()[0]['status'] == 'disconnected'))
            self.assertEqual(client.get('/frame.jpg').status_code, 503)
            self.assertEqual(client.get('/api/status').get_json()['detections'], [])
            self.assertEqual(client.post('/api/camera/frame', headers=headers,
                                         data=image.tobytes(), content_type='image/jpeg').status_code, 409)
            new_session = client.post('/api/camera/connect', headers=AUTH).get_json()['sessionId']
            headers = {**AUTH, 'X-Camera-Session': new_session}
            client.post('/api/camera/frame', headers=headers,
                        data=image.tobytes(), content_type='image/jpeg')
            self.assertTrue(wait_until(feed_until_live))
        finally:
            pipeline.stop()


if __name__ == '__main__':
    unittest.main(verbosity=2)
