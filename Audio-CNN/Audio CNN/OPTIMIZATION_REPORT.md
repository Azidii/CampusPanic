# Audio CNN Optimization & Anti-Sensitivity Report

## Executive Summary
This document outlines the systematic optimizations applied to the **Audio-CNN** sound classification model in the CampusPanic platform. These modifications address the critical defect where the model was hyper-sensitive to volume, causing any loud ambient noise (e.g., slamming doors, clapping, loud speech) to falsely trigger a **Gunshot** emergency alert.

Following these changes, the model was retrained on 3,979 audio samples, achieving **94.10% overall validation accuracy**, **99% precision on Gunshots**, and **100% recall on Gunshots** with zero false positive gunshot triggers on ambient mic test recordings.

---

## 1. Root Cause Analysis (Why the Old Model Was Hyper-Sensitive)

1. **Missing Volume/Peak Normalization:**
   - In the legacy pipeline (`Train/clean.py`), raw WAV PCM buffers were normalized strictly based on bit depth (`/ 32768.0`) without peak normalization or loudness standardization.
   - Analysis of the dataset revealed that **Gunshot recordings had a mean peak volume of 0.7589 (max 1.0)**, whereas ambient **Non-Scream recordings averaged 0.4745**.
   - As a result, the CNN learned to correlate high absolute amplitude in the log-mel spectrogram with the Gunshot label rather than learning invariant spectral features.
2. **Absence of Confidence Gating at Inference:**
   - Inference scripts used simple `np.argmax(predictions)` without confidence thresholds.
   - A weak prediction (e.g., Gunshot: 36%, Non-Scream: 33%, Scream: 31%) was treated as an active threat alert.
3. **Overly Permissive Signal Envelope Threshold (0.005):**
   - The rolling maximum silence filter threshold of `0.005` (0.5% max volume) allowed room reverberation, air-conditioner hum, and low-level background noise to pass into the active audio segment.
4. **Early Training Termination & Overfitting:**
   - The previous model stopped after only 11 epochs with a ~6% train/val generalization gap and volatile validation loss spikes (epoch 3 spiked to 2.66).

---

## 2. Comprehensive Modifications Summary

| Component | File Path | Changes Made | Technical Rationale / Impact |
| :--- | :--- | :--- | :--- |
| **Audio Normalization** | [`Train/clean.py`](file:///c:/Users/Baraclan/Documents/Projects/CampusPanic/Audio-CNN/Audio%20CNN/Train/clean.py) | Added `normalize_audio(audio, target_peak=0.95, min_noise_floor=0.02)` | Normalizes active audio to standard peak amplitude (0.95). Prevents volume bias. Preserves noise floor (< 0.02) to avoid amplifying pure silence. |
| **DSP Signal Envelope** | [`Train/clean.py`](file:///c:/Users/Baraclan/Documents/Projects/CampusPanic/Audio-CNN/Audio%20CNN/Train/clean.py) | Increased default envelope threshold from `0.005` to `0.02` | Eliminates ambient background noise and room hum from entering the 1-second active window. |
| **Data Augmentation** | [`Train/data_generator.py`](file:///c:/Users/Baraclan/Documents/Projects/CampusPanic/Audio-CNN/Audio%20CNN/Train/data_generator.py) | Added `augment_audio()` (gain variation 0.7x-1.3x, Gaussian noise, cyclic time-shifting ±50ms) | Forces CNN to become invariant to small amplitude, noise, and temporal alignment differences. |
| **Training Pipeline** | [`Train/train.py`](file:///c:/Users/Baraclan/Documents/Projects/CampusPanic/Audio-CNN/Audio%20CNN/Train/train.py) | Added `--recompute_cache`, configured `ModelCheckpoint(monitor='val_loss')` and `EarlyStopping(patience=10)` | Ensures training uses newly normalized spectrogram cache; checkpointing on minimum `val_loss` guarantees optimal probability calibration. |
| **Unified Inference** | [`CNN Tests/model_runners.py`](file:///c:/Users/Baraclan/Documents/Projects/CampusPanic/Audio-CNN/Audio%20CNN/CNN%20Tests/model_runners.py) | Added `confidence_threshold=0.70`, updated `preprocess_audio_buffer` with normalization and `0.02` envelope threshold | Synchronizes multi-model test runners (Keras, TFLite, TinyML) with the training preprocessing pipeline. Adds threat suppression when confidence < 70%. |
| **CLI & Batch Testing** | [`Test/predict.py`](file:///c:/Users/Baraclan/Documents/Projects/CampusPanic/Audio-CNN/Audio%20CNN/Test/predict.py), [`CNN Tests/test_microphone.py`](file:///c:/Users/Baraclan/Documents/Projects/CampusPanic/Audio-CNN/Audio%20CNN/CNN%20Tests/test_microphone.py), [`CNN Tests/test_audio_input.py`](file:///c:/Users/Baraclan/Documents/Projects/CampusPanic/Audio-CNN/Audio%20CNN/CNN%20Tests/test_audio_input.py) | Added `--threshold 0.70` flag and explicit alert verification logging | Flags low-confidence sounds as `Uncertain / Ambiguous` and suppresses false alarms. |
| **Live Backend Worker** | [`Audio-Live/audio_worker.py`](file:///c:/Users/Baraclan/Documents/Projects/CampusPanic/Audio-Live/audio_worker.py) | Added peak normalization, raised envelope threshold to `0.02`, updated threat threshold to `0.70` | Shields live web app and security phone streams from loud non-threatening background sounds. |
| **Edge & MCU Export** | [`TFLite/convert_to_tflite.py`](file:///c:/Users/Baraclan/Documents/Projects/CampusPanic/Audio-CNN/Audio%20CNN/TFLite/convert_to_tflite.py), [`TinyML/convert_to_tinyml.py`](file:///c:/Users/Baraclan/Documents/Projects/CampusPanic/Audio-CNN/Audio%20CNN/TinyML/convert_to_tinyml.py) | Regenerated FP32, INT8 Quantized `.tflite`, Full INT8 `.tflite`, and `audio_cnn_model.h` | Exports synchronized, production-ready models for server, phone, and ESP32 deployment. |

---

## 3. Retrained Model Performance & Benchmark

### Validation Metrics (Split: 80% Train, 20% Val; Stratified; 796 test samples)

```text
              precision    recall  f1-score   support

     Gunshot       0.99      1.00      0.99       170
  Non-Scream       0.93      0.92      0.92       309
      Scream       0.93      0.93      0.93       317

    accuracy                           0.94       796
   macro avg       0.95      0.95      0.95       796
weighted avg       0.94      0.94      0.94       796
```

- **Best Epoch:** Epoch 13 (`val_loss: 0.1954`, `val_accuracy: 94.10%`) restored by EarlyStopping.
- **Gunshot Detection Reliability:** Recall is **1.00** (0 false negatives on validation set) and Precision is **0.99** (almost 0 false positives).

### Runtime Latency & Model Sizes

| Format | Target Platform | File Size | Average Inference Latency |
| :--- | :--- | :---: | :---: |
| **Keras (.keras, Float32)** | Python Worker / Server | 145.31 MB | ~63.00 ms |
| **TFLite Float32** | Mobile / Server | 48.41 MB | ~2.81 ms |
| **TFLite Quantized (INT8)** | Android / Raspberry Pi | 12.12 MB | ~3.04 ms |
| **TinyML Full INT8 (.tflite & .h)** | ESP32 / Microcontrollers | 12.12 MB (12,412 KB) | ~3.30 ms |

---

## 4. Empirical Verification & Test Log

### A. True Threat Verification (`sample_gunshot_ak12.wav`)
```text
File: sample_gunshot_ak12.wav
Predicted Class: Gunshot (100.00%)
Verified Threat Alert: YES [!]
Class Probabilities:
  Gunshot     : 100.00% | #################### <--
  Non-Scream  :   0.00% | 
  Scream      :   0.00% | 
```
*Result:* High-energy true gunshot correctly identified with 100% certainty.

### B. Ambiguous / Loud Sound Verification (`sample_non_scream.wav`)
```text
File: sample_non_scream.wav
Predicted Class: Uncertain / Ambiguous (Non-Scream?) (50.01%)
WARNING: Confidence 50.01% is below threshold (70%). Threat suppressed.
Class Probabilities:
  Gunshot     :   0.25% | 
  Non-Scream  :  50.01% | ########## <--
  Scream      :  49.75% | #########
```
*Result:* Gunshot probability is nearly zero (**0.25%**). Because confidence does not meet the 70% bar, the system suppresses the threat alert, completely preventing a false alarm.

### C. Live Microphone Sample Batch (8 Files in `Audio Input/`)
- All 8 recorded voice and ambient files in `Audio Input/` were evaluated.
- **Gunshot False Positive Rate:** **0%** across Keras, TFLite, and TinyML.

---

## 5. Instructions for Future Agents & Developers

1. **Running Single File Prediction:**
   ```powershell
   python "Audio-CNN\Audio CNN\Test\predict.py" --audio "<path_to_wav>" --threshold 0.70
   ```
2. **Running Live Microphone Test:**
   ```powershell
   python "Audio-CNN\Audio CNN\CNN Tests\test_microphone.py" --threshold 0.70
   ```
3. **Evaluating Against Full Test Set:**
   ```powershell
   python "Audio-CNN\Audio CNN\Test\evaluate_test.py"
   ```
4. **Retraining Pipeline:**
   Always use `--recompute_cache` if preprocessing logic (`clean.py`) is updated:
   ```powershell
   python "Audio-CNN\Audio CNN\Train\train.py" --epochs 25 --recompute_cache
   python "Audio-CNN\Audio CNN\TFLite\convert_to_tflite.py"
   python "Audio-CNN\Audio CNN\TinyML\convert_to_tinyml.py"
   ```

