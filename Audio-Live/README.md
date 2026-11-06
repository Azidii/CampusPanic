# Live phone audio

The Android app collects camera frames and microphone audio. DSP-Website pairs
the phone, authenticates both streams, and forwards microphone PCM to this
private worker. The worker runs the trained Keras audio CNN and returns
classifications to the phone and the website's live node feed. Gunshot and
scream detections create website incidents.

## Run with the website

1. Run `./Setup-Audio.ps1` once from this directory. It creates `venv` and installs
   `requirements.txt` using native 64-bit Windows Python.
2. Start DSP-Website with `npm start`. It selects `Audio-Live/venv/Scripts/python.exe`
   automatically and starts this worker on loopback port 5057 with a private key.
3. Check `http://localhost:5000/api/health`. Wait for `workers.audio.ready: true`.
4. Pair the updated Android app to a website node on port 5000, allow camera and
   microphone access, and keep it in the foreground on the same Wi-Fi.

The phone sends one second of signed little-endian PCM: 16,000 samples,
16 bits per sample, one channel, 32,000 bytes. The worker applies the training
pipeline's silence filter and 97 × 128 log-mel spectrogram before inference.
Uploads and results use the same session as video. Results expire after five
seconds; disconnected sessions cannot replace newer results.

`Start-Audio.ps1` is for standalone diagnostics. Do not run it alongside the
website: it uses a separate key and the same default port. The phone always
connects to DSP-Website, never directly to the worker.

If audio is unavailable, inspect the website terminal for Python import, model
load, or port errors. Verify `Audio-CNN/Audio CNN/Models/best_cnn_model.keras`
and `classes.json` exist. `AUDIO_PYTHON` can override the interpreter and
`AUDIO_MODEL_PATH` can override the model. Restart the website after setup.

## Verify

```powershell
./venv/Scripts/python.exe -m unittest discover -s . -p test_audio_worker.py
cd ../DSP-Website
node --test tests/audio-connection.test.mjs tests/audio-streaming.test.mjs tests/audio-python.test.mjs
```

These checks exercise actual model inference, sample gunshot/scream audio,
session recovery, stale results, authentication, and concurrent nodes. A real
phone is still needed to verify microphone hardware and Wi-Fi behavior.
