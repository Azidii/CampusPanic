"""
model_runners.py
Core inference and testing engine for Audio CNN.
Provides unified loading, preprocessing, recording, and inference for:
  1. Best Keras Model (.keras)
  2. TFLite Model (Quantized / Float32 .tflite)
  3. TinyML Full INT8 Model (.tflite)
"""

import os
import sys
import time
import json
import wave
import warnings
from pathlib import Path
import numpy as np
import pandas as pd
from scipy.signal import resample

# Suppress noisy TensorFlow startup logs & deprecation warnings
os.environ["TF_CPP_MIN_LOG_LEVEL"] = "2"
warnings.filterwarnings("ignore", category=UserWarning)

import tensorflow as tf

# Optional sounddevice for microphone recording
try:
    import sounddevice as sd
    SOUNDDEVICE_AVAILABLE = True
except ImportError:
    SOUNDDEVICE_AVAILABLE = False


# ── DIRECTORY PATHS ────────────────────────────────────────────────────────────
CNN_TESTS_DIR = Path(__file__).resolve().parent
AUDIO_CNN_DIR = CNN_TESTS_DIR.parent
PROJECT_ROOT  = AUDIO_CNN_DIR.parent

MODELS_DIR      = AUDIO_CNN_DIR / "Models"
TFLITE_DIR      = AUDIO_CNN_DIR / "TFLite"
TINYML_DIR      = AUDIO_CNN_DIR / "TinyML"
AUDIO_INPUT_DIR = AUDIO_CNN_DIR / "Audio Input"
RESULTS_DIR     = AUDIO_CNN_DIR / "Results"

# Default Model Filepaths
CLASSES_PATH      = MODELS_DIR / "classes.json"
BEST_KERAS_PATH   = MODELS_DIR / "best_cnn_model.keras"
TFLITE_QUANT_PATH = TFLITE_DIR / "audio_cnn_quantized.tflite"
TFLITE_FP32_PATH  = TFLITE_DIR / "audio_cnn_fp32.tflite"
TINYML_INT8_PATH  = TINYML_DIR / "audio_cnn_int8.tflite"


# ── DSP PREPROCESSING FUNCTIONS ────────────────────────────────────────────────
def compute_signal_envelope(y: np.ndarray, rate: int = 16000, threshold: float = 0.02):
    """
    Computes signal envelope using a rolling maximum filter
    (50ms window) to identify acoustic activity and remove dead silence.
    """
    s = pd.Series(np.abs(y))
    window_size = max(int(rate / 20), 1)  # 50ms window
    y_env = s.rolling(window=window_size, min_periods=1, center=True).max().to_numpy()
    mask = y_env > threshold
    return mask, y_env


def normalize_audio(audio: np.ndarray, target_peak: float = 0.95, min_noise_floor: float = 0.02) -> np.ndarray:
    """
    Peak-normalizes the audio waveform to `target_peak` if it exceeds `min_noise_floor`.
    Prevents the CNN from relying on raw recording volume to detect gunshots.
    Avoids scaling up low-level ambient room hiss or silence.
    """
    if len(audio) == 0:
        return audio
    max_peak = float(np.max(np.abs(audio)))
    if max_peak >= min_noise_floor:
        return (audio / max_peak) * target_peak
    return audio


def preprocess_audio_buffer(audio: np.ndarray, sr: int = 16000, target_sr: int = 16000,
                            duration: float = 1.0, clean_silence: bool = True,
                            threshold: float = 0.02, normalize: bool = True) -> np.ndarray:
    """
    Standardizes a raw numpy audio array to 16 kHz mono, removes dead silence,
    pads or truncates to exact fixed duration, and peak-normalizes energy.
    """
    # 1. Ensure float32 and mono
    audio = audio.astype(np.float32)
    if audio.ndim > 1:
        audio = audio.mean(axis=1)

    # 2. Resample to target_sr if different
    if sr != target_sr and len(audio) > 0:
        target_len = int(len(audio) * target_sr / sr)
        if target_len > 0:
            audio = resample(audio, target_len).astype(np.float32)

    # 3. Trim dead silence with signal envelope
    if clean_silence and len(audio) > 0:
        mask, _ = compute_signal_envelope(audio, target_sr, threshold=threshold)
        active_audio = audio[mask]
        # Keep active audio if at least 100ms detected; otherwise preserve full audio
        if len(active_audio) >= int(target_sr * 0.1):
            audio = active_audio

    # 4. Truncate or pad with zeros to exact target length
    required_samples = int(target_sr * duration)
    if len(audio) > required_samples:
        audio = audio[:required_samples]
    elif len(audio) < required_samples:
        pad_width = required_samples - len(audio)
        audio = np.pad(audio, (0, pad_width), mode='constant')

    # 5. Peak normalization
    if normalize:
        audio = normalize_audio(audio, target_peak=0.95, min_noise_floor=threshold)

    return audio


def read_audio_file(file_path: Path) -> tuple[np.ndarray, int]:
    """Reads standard WAV file into normalized float32 numpy array and sample rate."""
    file_path = Path(file_path)
    if not file_path.exists():
        raise FileNotFoundError(f"Audio file not found: {file_path}")

    with wave.open(str(file_path), "rb") as wf:
        sr = wf.getframerate()
        n_ch = wf.getnchannels()
        sampwidth = wf.getsampwidth()
        frames = wf.readframes(wf.getnframes())

        if sampwidth == 2:      # 16-bit PCM
            data = np.frombuffer(frames, dtype=np.int16).astype(np.float32) / 32768.0
        elif sampwidth == 4:    # 32-bit PCM
            data = np.frombuffer(frames, dtype=np.int32).astype(np.float32) / 2147483648.0
        elif sampwidth == 1:    # 8-bit unsigned
            data = (np.frombuffer(frames, dtype=np.uint8).astype(np.float32) - 128.0) / 128.0
        else:
            data = np.frombuffer(frames, dtype=np.int16).astype(np.float32) / 32768.0

        if n_ch > 1:
            data = data.reshape(-1, n_ch).mean(axis=1)

    return data, sr


def extract_mel_spectrogram(audio_signal: np.ndarray, rate: int = 16000, n_mels: int = 128) -> np.ndarray:
    """
    Computes 128-band Log-Mel-Spectrogram using TensorFlow DSP operations.
    Output shape: (97, 128, 1)
    """
    signal_tensor = tf.convert_to_tensor(audio_signal, dtype=tf.float32)
    stfts = tf.signal.stft(signal_tensor, frame_length=512, frame_step=160, fft_length=512)
    spectrograms = tf.abs(stfts)
    num_spectrogram_bins = stfts.shape[-1]

    mel_weight_matrix = tf.signal.linear_to_mel_weight_matrix(
        num_mel_bins=n_mels,
        num_spectrogram_bins=num_spectrogram_bins,
        sample_rate=rate,
        lower_edge_hertz=20.0,
        upper_edge_hertz=8000.0
    )
    mel_spec = tf.tensordot(spectrograms, mel_weight_matrix, 1)
    log_mel = tf.math.log(mel_spec + 1e-6)
    log_mel = tf.expand_dims(log_mel, axis=-1)
    return log_mel.numpy()


def audio_to_input_tensor(audio_source, clean_silence: bool = True) -> tuple[np.ndarray, np.ndarray]:
    """
    Converts either a file path or a raw numpy audio array into:
      1. Preprocessed 1D audio waveform (16000 samples)
      2. 4D Model Input Tensor with shape (1, 97, 128, 1)
    """
    if isinstance(audio_source, (str, Path)):
        raw_audio, sr = read_audio_file(Path(audio_source))
    elif isinstance(audio_source, np.ndarray):
        raw_audio = audio_source
        sr = 16000
    else:
        raise TypeError(f"Unsupported audio source type: {type(audio_source)}")

    clean_audio = preprocess_audio_buffer(raw_audio, sr=sr, target_sr=16000,
                                          duration=1.0, clean_silence=clean_silence)
    mel_spec = extract_mel_spectrogram(clean_audio, rate=16000)
    input_tensor = np.expand_dims(mel_spec, axis=0).astype(np.float32)
    return clean_audio, input_tensor


# ── AUDIO RECORDING UTILITIES ──────────────────────────────────────────────────
def record_from_microphone(duration: float = 2.0, sample_rate: int = 16000,
                           save_to_folder: Path = AUDIO_INPUT_DIR,
                           filename: str = None, countdown: bool = True) -> tuple[np.ndarray, Path]:
    """
    Captures live audio from the microphone using sounddevice.
    Saves the recorded audio to Audio Input/ and returns (audio_array, saved_path).
    """
    if not SOUNDDEVICE_AVAILABLE:
        raise RuntimeError("sounddevice is not installed. Please run: pip install sounddevice")

    save_to_folder = Path(save_to_folder)
    save_to_folder.mkdir(parents=True, exist_ok=True)

    if filename is None:
        timestamp = time.strftime("%Y%m%d_%H%M%S")
        filename = f"mic_recording_{timestamp}.wav"
    elif not filename.endswith(".wav"):
        filename += ".wav"

    save_path = save_to_folder / filename

    if countdown:
        print("\n" + "="*50)
        print("          MICROPHONE RECORDING SETUP")
        print("="*50)
        default_dev = sd.query_devices(kind='input')
        print(f"Device   : {default_dev.get('name', 'Default Microphone')}")
        print(f"Duration : {duration:.1f} seconds | Rate: {sample_rate} Hz Mono")
        print("Prepare to make a sound, shout, or speak...")
        for sec in range(3, 0, -1):
            print(f"  Starting in {sec}...", end="\r", flush=True)
            time.sleep(1.0)
        print("  RECORDING NOW! ---> Make your sound! <---   ", flush=True)

    # Record audio
    num_samples = int(duration * sample_rate)
    recording = sd.rec(num_samples, samplerate=sample_rate, channels=1, dtype='float32')
    sd.wait()
    audio = recording.flatten()

    if countdown:
        print("  Finished recording! Processing audio...\n")

    # Audio amplitude check
    max_amp = float(np.max(np.abs(audio)))
    if max_amp < 0.01:
        print("[!] Note: Recorded audio level is very low (max amp: {:.4f}).".format(max_amp))
        print("    Check your microphone input volume / mute status if prediction is unexpected.\n")

    # Save to WAV file
    int16_data = np.clip(audio * 32767.0, -32768.0, 32767.0).astype(np.int16)
    with wave.open(str(save_path), "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
        wf.writeframes(int16_data.tobytes())

    return audio, save_path


# ── UNIFIED MODEL TESTER CLASS ─────────────────────────────────────────────────
class UnifiedModelTester:
    """
    Loads and runs inferences on:
      1. Best Keras Model (.keras)
      2. TFLite Model (.tflite)
      3. TinyML Model (Full INT8 .tflite)
    """
    def __init__(self, keras_path=BEST_KERAS_PATH, tflite_path=TFLITE_QUANT_PATH,
                 tinyml_path=TINYML_INT8_PATH, classes_path=CLASSES_PATH,
                 confidence_threshold: float = 0.70):
        self.keras_path   = Path(keras_path)
        self.tflite_path  = Path(tflite_path)
        self.tinyml_path  = Path(tinyml_path)
        self.classes_path = Path(classes_path)
        self.confidence_threshold = float(confidence_threshold)

        # Load classes
        if not self.classes_path.exists():
            raise FileNotFoundError(f"Classes mapping not found at '{self.classes_path}'")
        with open(self.classes_path, "r") as f:
            self.classes = json.load(f)

        self.keras_model        = None
        self.tflite_interpreter = None
        self.tinyml_interpreter = None

    # Lazy loaders
    def load_keras(self):
        if self.keras_model is None:
            if not self.keras_path.exists():
                raise FileNotFoundError(f"Keras model not found at '{self.keras_path}'")
            self.keras_model = tf.keras.models.load_model(str(self.keras_path))
        return self.keras_model

    def load_tflite(self):
        if self.tflite_interpreter is None:
            if not self.tflite_path.exists():
                raise FileNotFoundError(f"TFLite model not found at '{self.tflite_path}'")
            self.tflite_interpreter = tf.lite.Interpreter(model_path=str(self.tflite_path))
            self.tflite_interpreter.allocate_tensors()
            self.tflite_inp = self.tflite_interpreter.get_input_details()[0]
            self.tflite_out = self.tflite_interpreter.get_output_details()[0]
        return self.tflite_interpreter

    def load_tinyml(self):
        if self.tinyml_interpreter is None:
            if not self.tinyml_path.exists():
                raise FileNotFoundError(f"TinyML INT8 model not found at '{self.tinyml_path}'")
            self.tinyml_interpreter = tf.lite.Interpreter(model_path=str(self.tinyml_path))
            self.tinyml_interpreter.allocate_tensors()
            self.tinyml_inp = self.tinyml_interpreter.get_input_details()[0]
            self.tinyml_out = self.tinyml_interpreter.get_output_details()[0]
        return self.tinyml_interpreter

    def load_all_models(self):
        """Pre-warms all three models into memory."""
        self.load_keras()
        self.load_tflite()
        self.load_tinyml()

    def _package_prediction(self, model_type: str, model_file: str, fmt: str,
                            size_mb: float, preds: np.ndarray, latency_ms: float) -> dict:
        top_idx = int(np.argmax(preds))
        predicted_label = self.classes[top_idx]
        confidence = float(preds[top_idx])
        is_confident = confidence >= self.confidence_threshold
        status_label = predicted_label if is_confident else f"Uncertain ({predicted_label}?)"
        is_alert = (predicted_label in ["Gunshot", "Scream"]) and is_confident

        return {
            "model_type": model_type,
            "model_file": model_file,
            "format": fmt,
            "size_mb": size_mb,
            "predicted_label": predicted_label,
            "confidence": confidence,
            "confidence_threshold": self.confidence_threshold,
            "is_confident": is_confident,
            "status_label": status_label,
            "alert": is_alert,
            "latency_ms": latency_ms,
            "probabilities": {cls_name: float(p) for cls_name, p in zip(self.classes, preds)}
        }

    # 1. Best Model (Keras) Inference
    def predict_keras(self, input_tensor: np.ndarray) -> dict:
        model = self.load_keras()
        t0 = time.perf_counter()
        preds = model.predict(input_tensor, verbose=0)[0]
        latency_ms = (time.perf_counter() - t0) * 1000
        size_mb = os.path.getsize(self.keras_path) / (1024**2)

        return self._package_prediction(
            "Best Model (Keras)", self.keras_path.name,
            "Keras (.keras, Float32)", size_mb, preds, latency_ms
        )

    # 2. TFLite Model Inference
    def predict_tflite(self, input_tensor: np.ndarray) -> dict:
        interp = self.load_tflite()
        interp.set_tensor(self.tflite_inp["index"], input_tensor.astype(np.float32))

        t0 = time.perf_counter()
        interp.invoke()
        latency_ms = (time.perf_counter() - t0) * 1000

        preds = interp.get_tensor(self.tflite_out["index"])[0]
        size_mb = os.path.getsize(self.tflite_path) / (1024**2)

        return self._package_prediction(
            "TFLite Model", self.tflite_path.name,
            "TFLite (Dynamic INT8 / FP32)", size_mb, preds, latency_ms
        )

    # 3. TinyML Full INT8 Inference
    def predict_tinyml(self, input_tensor: np.ndarray) -> dict:
        interp = self.load_tinyml()
        in_scale, in_zp = self.tinyml_inp["quantization"]
        int8_input = np.clip(np.round(input_tensor / in_scale) + in_zp, -128, 127).astype(np.int8)
        interp.set_tensor(self.tinyml_inp["index"], int8_input)

        t0 = time.perf_counter()
        interp.invoke()
        latency_ms = (time.perf_counter() - t0) * 1000

        raw_out = interp.get_tensor(self.tinyml_out["index"])[0]
        out_scale, out_zp = self.tinyml_out["quantization"]
        dequant = (raw_out.astype(np.float32) - out_zp) * out_scale
        total_p = np.sum(dequant)
        probs = (dequant / total_p) if total_p > 0 else dequant
        size_mb = os.path.getsize(self.tinyml_path) / (1024**2)

        return self._package_prediction(
            "TinyML (Full INT8)", self.tinyml_path.name,
            "TFLite Micro (INT8 In/Out)", size_mb, probs, latency_ms
        )

    # Run all three
    def predict_all(self, audio_source, clean_silence: bool = True) -> dict:
        clean_audio, input_tensor = audio_to_input_tensor(audio_source, clean_silence=clean_silence)

        k_res = self.predict_keras(input_tensor)
        tf_res = self.predict_tflite(input_tensor)
        tiny_res = self.predict_tinyml(input_tensor)

        predictions = [k_res["predicted_label"], tf_res["predicted_label"], tiny_res["predicted_label"]]
        all_agree = (predictions[0] == predictions[1] == predictions[2])

        source_name = Path(audio_source).name if isinstance(audio_source, (str, Path)) else "Microphone Live Input"
        confirmed_alert = any(res.get("alert", False) for res in [k_res, tf_res, tiny_res])

        return {
            "source": source_name,
            "all_agree": all_agree,
            "consensus": predictions[0] if all_agree else "Divergent",
            "alert": confirmed_alert,
            "confidence_threshold": self.confidence_threshold,
            "models": {
                "keras": k_res,
                "tflite": tf_res,
                "tinyml": tiny_res
            }
        }


# ── VISUAL FORMATTING & REPORTING ──────────────────────────────────────────────
def format_results_table(results: dict, classes: list = None) -> str:
    """
    Formats the side-by-side comparison results into an ASCII table and
    probability distribution breakdown.
    """
    if classes is None:
        classes = ["Gunshot", "Non-Scream", "Scream"]

    source_name = results.get("source", "Audio")
    models = results["models"]
    conf_thresh = results.get("confidence_threshold", 0.70)

    lines = []
    lines.append("\n" + "=" * 82)
    lines.append(f"   AUDIO CNN INFERENCE BENCHMARK: {source_name}")
    lines.append("=" * 82)

    # Header
    col_w = [23, 23, 9, 13, 8, 8, 10]
    header = (
        f"{'Model':<{col_w[0]}} | "
        f"{'Format':<{col_w[1]}} | "
        f"{'Size':<{col_w[2]}} | "
        f"{'Predicted':<{col_w[3]}} | "
        f"{'Conf.':<{col_w[4]}} | "
        f"{'Alert?':<{col_w[5]}} | "
        f"{'Latency':<{col_w[6]}}"
    )
    separator = "-" * len(header)
    lines.append(header)
    lines.append(separator)

    for m_key in ["keras", "tflite", "tinyml"]:
        m = models[m_key]
        size_str = f"{m['size_mb']:.1f} MB"
        conf_str = f"{m['confidence']*100:.1f}%"
        alert_str = "YES [!]" if m.get("alert", False) else "NO [-]"
        lat_str  = f"{m['latency_ms']:.2f} ms"
        pred_display = m['predicted_label'] if m.get("is_confident", True) else f"{m['predicted_label']} (?)"
        row = (
            f"{m['model_type']:<{col_w[0]}} | "
            f"{m['format']:<{col_w[1]}} | "
            f"{size_str:<{col_w[2]}} | "
            f"{pred_display:<{col_w[3]}} | "
            f"{conf_str:<{col_w[4]}} | "
            f"{alert_str:<{col_w[5]}} | "
            f"{lat_str:<{col_w[6]}}"
        )
        lines.append(row)

    lines.append(separator)

    # Consensus Status & Alert Status
    if results["all_agree"]:
        lines.append(f"  --> CONSENSUS: [MATCH] All 3 models agree on -> {results['consensus'].upper()} <--")
    else:
        k_p = models["keras"]["predicted_label"]
        tf_p = models["tflite"]["predicted_label"]
        ti_p = models["tinyml"]["predicted_label"]
        lines.append(f"  --> NOTICE: [DIVERGENCE] Keras: {k_p} | TFLite: {tf_p} | TinyML: {ti_p} <--")

    if not results.get("alert", False):
        lines.append(f"  --> STATUS: NORMAL / NO VERIFIED THREAT (Confidence threshold: {conf_thresh*100:.0f}%)")
    else:
        lines.append(f"  --> STATUS: [ALERT TRIGGERED] High-confidence threat verified!")

    lines.append("-" * len(header))
    lines.append("  Detailed Class Probabilities:")
    for m_key in ["keras", "tflite", "tinyml"]:
        m = models[m_key]
        lines.append(f"    [{m['model_type']}]:")
        for cls_name in classes:
            prob = m["probabilities"].get(cls_name, 0.0)
            bar_len = int(prob * 20)
            bar = "#" * bar_len + "-" * (20 - bar_len)
            marker = " *" if cls_name == m["predicted_label"] else ""
            lines.append(f"       {cls_name:<11}: {prob*100:6.2f}% | [{bar}]{marker}")

    lines.append("=" * 78 + "\n")
    return "\n".join(lines)
