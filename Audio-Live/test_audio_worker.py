"""Unit and integration test for Audio-Live worker."""
import unittest
import numpy as np
import sys
from pathlib import Path

root = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(root / "Audio-CNN" / "Audio CNN" / "Train"))
from clean import preprocess_audio
from audio_worker import AudioPipeline, create_app

TEST_KEY = "campuspanic_test_audio_secret_key_123456789012345"

class AudioWorkerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        model_path = root / "Audio-CNN" / "Audio CNN" / "Models" / "best_cnn_model.keras"
        classes_path = root / "Audio-CNN" / "Audio CNN" / "Models" / "classes.json"
        
        cls.pipeline = AudioPipeline(model_path, classes_path, threshold=0.55, max_nodes=4)
        cls.app = create_app(cls.pipeline, TEST_KEY)
        cls.client = cls.app.test_client()
        cls.headers = {"X-Worker-Key": TEST_KEY}
        cls.gunshot_wav = root / "Audio-CNN" / "Audio CNN" / "Audio Input" / "sample_gunshot_ak12.wav"
        cls.scream_wav = root / "Audio-CNN" / "Audio CNN" / "Audio Input" / "sample_scream.wav"

    def test_health_check(self):
        res = self.client.get("/health", headers=self.headers)
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json["status"], "healthy")

    def test_unauthorized_access(self):
        res = self.client.get("/health")
        self.assertEqual(res.status_code, 401)

    def test_session_lifecycle(self):
        # Open session
        res = self.client.post("/nodes/node-test-1/session", headers=self.headers, json={"sessionId": "sess-123"})
        self.assertEqual(res.status_code, 201)
        self.assertTrue(res.json["ready"])

        # Check status
        res = self.client.get("/nodes/node-test-1/status", headers=self.headers)
        self.assertEqual(res.status_code, 200)

        # Close session
        res = self.client.delete("/nodes/node-test-1/session", headers={**self.headers, "X-Camera-Session": "sess-123"})
        self.assertEqual(res.status_code, 204)

    def test_pcm_audio_inference_gunshot(self):
        # 16kHz mono audio as phone produces
        audio = preprocess_audio(self.gunshot_wav, target_sr=16000, duration=1.0, clean_silence=True)
        pcm_bytes = (audio * 32767.0).astype(np.int16).tobytes()

        # Open session
        self.client.post("/nodes/node-gunshot/session", headers=self.headers, json={"sessionId": "sess-gun"})

        # Upload 1s PCM
        res = self.client.post(
            "/nodes/node-gunshot/audio",
            headers={**self.headers, "X-Camera-Session": "sess-gun"},
            data=pcm_bytes,
            content_type="application/octet-stream"
        )
        self.assertEqual(res.status_code, 200)
        data = res.json
        self.assertEqual(data["class"], "Gunshot")
        self.assertTrue(data["alert"])
        self.assertEqual(data["threatType"], "gunshot")
        self.assertGreater(data["confidence"], 0.85)
        print(f"Gunshot test passed: class={data['class']}, confidence={data['confidence']}, ms={data['inferenceMs']}")

        # Clean up
        self.client.delete("/nodes/node-gunshot/session", headers={**self.headers, "X-Camera-Session": "sess-gun"})

    def test_pcm_audio_inference_scream(self):
        audio = preprocess_audio(self.scream_wav, target_sr=16000, duration=1.0, clean_silence=True)
        pcm_bytes = (audio * 32767.0).astype(np.int16).tobytes()

        self.client.post("/nodes/node-scream/session", headers=self.headers, json={"sessionId": "sess-scream"})

        res = self.client.post(
            "/nodes/node-scream/audio",
            headers={**self.headers, "X-Camera-Session": "sess-scream"},
            data=pcm_bytes,
            content_type="application/octet-stream"
        )
        self.assertEqual(res.status_code, 200)
        data = res.json
        self.assertEqual(data["class"], "Scream")
        self.assertTrue(data["alert"])
        self.assertEqual(data["threatType"], "scream")
        self.assertGreater(data["confidence"], 0.85)
        print(f"Scream test passed: class={data['class']}, confidence={data['confidence']}, ms={data['inferenceMs']}")

        self.client.delete("/nodes/node-scream/session", headers={**self.headers, "X-Camera-Session": "sess-scream"})

if __name__ == "__main__":
    unittest.main()
