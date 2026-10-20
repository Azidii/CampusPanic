# Audio CNN Tests & Deployment Benchmark Suite

This directory contains comprehensive testing and benchmarking scripts comparing all three deployment tiers of the Audio CNN model:

1. **Best Model (`best_cnn_model.keras`)**: Full-precision float32 trained Keras checkpoint (~145 MB).
2. **TFLite Model (`audio_cnn_quantized.tflite`)**: Mobile-ready dynamic INT8 quantized FlatBuffer (~12 MB).
3. **TinyML Model (`audio_cnn_int8.tflite`)**: Full integer INT8 quantized model designed for microcontrollers (Arduino, ESP32, STM32) with corresponding C header `audio_cnn_model.h` (~12 MB).

Audio input can be acquired from:
- **Live Voice Input from Microphone** (via `sounddevice` with auto-save to `Audio CNN/Audio Input/`)
- **Audio Files from `Audio CNN/Audio Input/`** (pre-recorded or custom `.wav` files)

---

## Folder Structure

```
Audio CNN/
├── Audio Input/             # Dedicated audio input folder (still in same parent folder)
│   ├── sample_gunshot_ak12.wav
│   ├── sample_non_scream.wav
│   ├── sample_scream.wav
│   └── mic_recording_*.wav  # Automatically saved microphone recordings
│
├── CNN Tests/               # Dedicated testing module
│   ├── model_runners.py     # Core inference engine (Keras + TFLite + TinyML + Preprocessing)
│   ├── test_microphone.py   # Voice input from microphone testing script
│   ├── test_audio_input.py  # Audio Input folder testing & batch benchmark script
│   ├── test_all_models.py   # Master interactive & CLI runner test suite
│   └── README.md            # Documentation and usage guide
│
├── Models/                  # best_cnn_model.keras & classes.json
├── TFLite/                  # audio_cnn_quantized.tflite & audio_cnn_fp32.tflite
└── TinyML/                  # audio_cnn_int8.tflite & audio_cnn_model.h
```

---

## 1. Quick Start (Interactive Menu)

Run the master test suite with no arguments to launch an intuitive terminal selection menu:

```powershell
python "Audio CNN\CNN Tests\test_all_models.py"
```

```text
=================================================================
          AUDIO CNN - MULTI-MODEL TEST BENCHMARK
=================================================================
  [1] Test Voice Input from Microphone (Live Record & Classify)
  [2] Test an Audio File from 'Audio Input' Folder
  [3] Test ALL Audio Files in 'Audio Input' Folder (Batch Mode)
  [4] Model Architectures & Size Summary
  [5] Exit
=================================================================
```

---

## 2. Test Voice Input from Microphone

The script `test_microphone.py` records live voice or sound directly from your default microphone (e.g., headset, desktop mic, or laptop mic), runs DSP silence filtering and Log-Mel-Spectrogram extraction, tests the models, prints side-by-side results, and saves the recording into `Audio CNN/Audio Input/`.

### Run single 2-second voice test:
```powershell
python "Audio CNN\CNN Tests\test_microphone.py"
```

### Options:
- **Customize duration (e.g. 3.0 seconds):**
  ```powershell
  python "Audio CNN\CNN Tests\test_microphone.py" --duration 3.0
  ```
- **Continuous voice testing loop (press Enter to re-record, 'q' to stop):**
  ```powershell
  python "Audio CNN\CNN Tests\test_microphone.py" --loop
  ```
- **Test a specific model only:**
  ```powershell
  python "Audio CNN\CNN Tests\test_microphone.py" --model best     # Only Keras
  python "Audio CNN\CNN Tests\test_microphone.py" --model tflite   # Only TFLite
  python "Audio CNN\CNN Tests\test_microphone.py" --model tinyml   # Only TinyML INT8
  ```
- **Specify a custom filename:**
  ```powershell
  python "Audio CNN\CNN Tests\test_microphone.py" --save_name my_voice_test.wav
  ```

---

## 3. Test Audio Files from `Audio Input/` Folder

The script `test_audio_input.py` evaluates `.wav` audio files stored in `Audio CNN/Audio Input/`.

### Interactive file picker:
```powershell
python "Audio CNN\CNN Tests\test_audio_input.py"
```

### Test a specific file in `Audio Input/`:
```powershell
python "Audio CNN\CNN Tests\test_audio_input.py" --file sample_gunshot_ak12.wav
```
*(You can pass either the filename inside `Audio Input/` or any valid path).*

### Run batch benchmark across all files in `Audio Input/`:
```powershell
python "Audio CNN\CNN Tests\test_audio_input.py" --all
```

### Export batch evaluation report to CSV:
```powershell
python "Audio CNN\CNN Tests\test_audio_input.py" --all --export-csv
```
*(Saved to `Audio CNN/Results/audio_input_batch_results.csv`).*

---

## 4. Master Command-Line Options (`test_all_models.py`)

| Command | Description |
|---|---|
| `python "Audio CNN\CNN Tests\test_all_models.py"` | Interactive menu |
| `python "Audio CNN\CNN Tests\test_all_models.py" --source mic` | Direct microphone test |
| `python "Audio CNN\CNN Tests\test_all_models.py" --source folder` | Batch test all files in `Audio Input/` |
| `python "Audio CNN\CNN Tests\test_all_models.py" --file <path>` | Test a specific audio file |
| `python "Audio CNN\CNN Tests\test_all_models.py" --summary` | Display model architecture & size comparison |

---

## 5. Model Comparison & Quantization Overview

| Metric | Best Keras Model | TFLite Model | TinyML Model |
|---|---|---|---|
| **File** | `best_cnn_model.keras` | `audio_cnn_quantized.tflite` | `audio_cnn_int8.tflite` |
| **Precision** | Float32 | Dynamic Range INT8 | Full INT8 (In & Out) |
| **Disk Size** | ~145.3 MB | ~12.1 MB (**-91.7%**) | ~12.1 MB (**-91.7%**) |
| **C Header (.h)** | N/A | N/A | `audio_cnn_model.h` (Ready for C++) |
| **Target Hardware** | Desktop / Cloud Server | Android, iOS, Pi | STM32, ESP32, Arduino Nano 33 BLE |
| **Input Shape** | `(1, 97, 128, 1)` Float32 | `(1, 97, 128, 1)` Float32 | `(1, 97, 128, 1)` INT8 quantized |
| **Typical Latency** | ~15 - 25 ms | ~2 - 4 ms | ~1 - 3 ms |
| **DSP Pipeline** | 16 kHz Mono $\rightarrow$ 50ms Envelope Silence Trim $\rightarrow$ 128-Mel Log Spectrogram |

---

## 6. Sample Output

```text
==============================================================================
   AUDIO CNN INFERENCE BENCHMARK: sample_gunshot_ak12.wav
==============================================================================
Model                     | Format                  | Size       | Predicted      | Conf.      | Latency    
--------------------------------------------------------------------------------------------------------------
Best Model (Keras)        | Keras (.keras, Float32) | 145.3 MB   | Gunshot        | 99.3%      | 19.42 ms   
TFLite Model              | TFLite (Dynamic INT8)   | 12.1 MB    | Gunshot        | 79.9%      | 2.15 ms    
TinyML (Full INT8)        | TFLite Micro (INT8)     | 12.1 MB    | Gunshot        | 80.9%      | 1.83 ms    
--------------------------------------------------------------------------------------------------------------
  --> CONSENSUS: [MATCH] All 3 models agree on -> GUNSHOT <--
--------------------------------------------------------------------------------------------------------------
  Detailed Class Probabilities:
    [Best Model (Keras)]:
       Gunshot    :  99.27% | [###################-] *
       Non-Scream :   0.59% | [--------------------]
       Scream     :   0.14% | [--------------------]
    [TFLite Model]:
       Gunshot    :  79.86% | [###############-----] *
       Non-Scream :  16.07% | [###-----------------]
       Scream     :   4.07% | [--------------------]
    [TinyML (Full INT8)]:
       Gunshot    :  80.86% | [################----] *
       Non-Scream :  15.23% | [###-----------------]
       Scream     :   3.91% | [--------------------]
==============================================================================
```
