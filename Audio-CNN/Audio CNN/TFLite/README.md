# TensorFlow Lite (TFLite) Deployment

This directory contains the converted and optimized **TensorFlow Lite (.tflite)** models for the Audio CNN classifier, designed for embedded systems, mobile applications, and edge DSP devices (e.g., Raspberry Pi, Android, iOS).

---

## Generated Models

| Model File | Precision | File Size | Reduction | Recommended Use Case |
| :--- | :---: | :---: | :---: | :--- |
| **`audio_cnn_fp32.tflite`** | 32-bit Float | **48.41 MB** | 66.7% | High accuracy desktop & server inference |
| **`audio_cnn_quantized.tflite`** | INT8 Dynamic Range | **12.12 MB** | **91.7%** | Ultra-fast edge & mobile deployment (~3 ms/sample) |

*Original Keras model: 145.31 MB*

---

## Scripts & Usage

### 1. Classify Audio with TFLite (`predict_tflite.py`)
Run inference on any WAV audio file using the TFLite runtime:
```powershell
# Using quantized model (default, 12 MB):
python "Audio CNN\TFLite\predict_tflite.py" --audio "Datasets\Gunshots\AK-47\1 (1).wav"

# Using Float32 model:
python "Audio CNN\TFLite\predict_tflite.py" --audio "Datasets\Gunshots\AK-47\1 (1).wav" --fp32
```
*Outputs:* Predicted class, confidence percentage, probability distribution bar chart, and exact inference latency in milliseconds.

---

### 2. Full Test Split Benchmark (`test_tflite_accuracy.py`)
Evaluates the TFLite model across all 796 test audio samples and measures throughput:
```powershell
python "Audio CNN\TFLite\test_tflite_accuracy.py"
```

---

### 3. Re-converting from Keras (`convert_to_tflite.py`)
If you retrain the model in `Audio CNN/Train/train.py`, regenerate the TFLite files by running:
```powershell
python "Audio CNN\TFLite\convert_to_tflite.py"
```
