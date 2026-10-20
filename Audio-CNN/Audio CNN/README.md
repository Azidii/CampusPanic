# Audio Classification CNN (Based on Seth Adams' Tutorial Series)

## [Dataset Repository Link](https://drive.google.com/drive/folders/1pCUtilMXdc-z-3LmDl-1BTnqLj2kgiXk?usp=sharing)

This project implements an end-to-end Audio Classification Convolutional Neural Network (CNN) following **Seth Adams'** tutorial series: [Deep Learning for Audio Classification](https://www.youtube.com/watch?v=Z7YM-HAz-IY&list=PLhA3b2k8R3t2Ng1WW_7MiXeh1pfQJQi_P).

---

## Folder Structure

The **`Audio CNN`** directory is structured into dedicated modules:

```
Audio CNN/
├── Audio Input/             # Dedicated audio input folder (mic recordings & custom WAVs)
│   ├── sample_gunshot_ak12.wav
│   ├── sample_non_scream.wav
│   └── sample_scream.wav
│
├── CNN Tests/               # Unified multi-model testing & benchmarking suite
│   ├── model_runners.py     # Unified inference engine (Keras + TFLite + TinyML + Preprocessing)
│   ├── test_microphone.py   # Live voice/sound input testing via microphone
│   ├── test_audio_input.py  # Single & batch testing for files in Audio Input/
│   ├── test_all_models.py   # Master interactive & CLI test runner
│   └── README.md            # Detailed CNN Tests guide
│
├── Data_Prep/               # Dataset indexing, EDA, and random folder generator
│   ├── create_sound_index.py       # Scans Datasets/ and outputs dataset_index.csv
│   ├── dataset_index.csv           # Master dataset metadata index
│   ├── dsp_eda.py                  # Generates waveform, envelope, FFT, and spectrogram plots
│   ├── prepare_random_dataset.py   # Populates Datasets/random with manifest
│   └── random_manifest.csv         # Ground-truth mapping for random files
│
├── Train/                   # Training pipeline and model definitions
│   ├── clean.py                    # Audio cleaning & rolling window Signal Envelope
│   ├── models.py                   # Seth Adams 2D CNN (Conv2D) & 1D CNN architectures
│   ├── data_generator.py           # Mel-Spectrogram extraction & Keras DataGenerator
│   └── train.py                    # Training script with class weighting & callbacks
│
├── Models/                  # Saved weights, caches, and label encoders
│   ├── best_cnn_model.keras        # Top trained model checkpoint (145 MB)
│   ├── classes.json                # Target label mapping (Gunshot, Scream, Non-Scream)
│   └── features_cache.npz          # Precomputed Mel-Spectrogram cache
│
├── Test/                    # Inference and testing scripts
│   ├── test_random.py              # Tests random audio files from Datasets/random & tracks accuracy
│   ├── predict.py                  # Classifies arbitrary audio files with confidence scores
│   └── evaluate_test.py            # Evaluates full test split (confusion matrix, reports)
│
├── Results/                 # Generated plots, evaluation matrices, and run logs
│   ├── training_history.png        # Training & validation loss/accuracy learning curves
│   ├── confusion_matrix.png        # Training validation confusion matrix
│   ├── eval_confusion_matrix.png   # Detailed test evaluation confusion matrix
│   ├── eval_subcategories.png      # Per-weapon / subcategory accuracy chart
│   ├── dsp_exploration.png         # Waveform, envelope, FFT, and Mel-Spectrogram visualizer
│   ├── training_log.csv            # Per-epoch training log
│   ├── test_evaluation_results.csv # Predictions for all test split files
│   └── random_test_history.csv     # Cumulative log of all random test runs
│
├── TFLite/                  # Edge & mobile deployment (.tflite models)
│   ├── audio_cnn_fp32.tflite       # Full precision Float32 model (48 MB, 93.5% accuracy)
│   ├── audio_cnn_quantized.tflite  # INT8 quantized model (12 MB, ~3ms latency)
│   ├── convert_to_tflite.py        # Conversion pipeline script
│   ├── predict_tflite.py           # TFLite inference script with latency benchmark
│   └── test_tflite_accuracy.py     # Verification script benchmarking test split
│
├── TinyML/                  # Microcontroller deployment (Full INT8 & C Header)
│   ├── audio_cnn_int8.tflite       # Full INT8 model with integer input/output
│   ├── audio_cnn_model.h           # C Header array for microcontroller firmware
│   ├── convert_to_tinyml.py        # INT8 calibration and C-array export pipeline
│   └── test_tinyml_tflite.py       # INT8 accuracy and latency benchmarking
│
└── README.md
```

---

## How to Run Each Module

### 1. Data Preparation & Exploration (`Data_Prep/`)
- **Regenerate Master Dataset Index:**
  ```powershell
  python "Audio CNN\Data_Prep\create_sound_index.py"
  ```
- **Run DSP Exploratory Visualizer (Waveform, Envelope, FFT, Mel-Spectrogram):**
  ```powershell
  python "Audio CNN\Data_Prep\dsp_eda.py"
  ```
  *Output:* Saved to `Audio CNN/Results/dsp_exploration.png`.

- **Repopulate `Datasets/random`:**
  ```powershell
  python "Audio CNN\Data_Prep\prepare_random_dataset.py"
  ```

---

### 2. Model Training (`Train/`)
Train the 2D CNN classifier with class weight balancing, feature caching, and checkpointing:
```powershell
python "Audio CNN\Train\train.py" --epochs 15 --batch_size 32
```
*Outputs:*
- Best weights saved to `Audio CNN/Models/best_cnn_model.keras`
- Training history saved to `Audio CNN/Results/training_history.png` and `training_log.csv`

---

### 3. Testing & Evaluation (`Test/`)

#### A. Test Random WAV Files in `Datasets/random`
```powershell
# Test 1 random file:
python "Audio CNN\Test\test_random.py"

# Test 10 random files:
python "Audio CNN\Test\test_random.py" --n 10

# Test 50 random files:
python "Audio CNN\Test\test_random.py" --n 50

# Test random files filtered by class (Gunshot, Scream, Non-Scream):
python "Audio CNN\Test\test_random.py" --n 10 --class_filter Gunshot

# Test a specific file by name:
python "Audio CNN\Test\test_random.py" --file "Gunshots_MG-42_7 (11).wav"
```
*All random test runs are logged to:* `Audio CNN/Results/random_test_history.csv`.

#### B. Classify Any WAV File (`predict.py`)
```powershell
python "Audio CNN\Test\predict.py" --audio "Datasets\Gunshots\AK-47\1 (1).wav"
```

#### C. Comprehensive Test Split Evaluation (`evaluate_test.py`)
```powershell
python "Audio CNN\Test\evaluate_test.py"
```
*Outputs:* Saves `eval_confusion_matrix.png`, `eval_subcategories.png`, and `test_evaluation_results.csv` into `Audio CNN/Results/`.

---

### 4. Multi-Model Tests & Live Benchmarks (`CNN Tests/`)
Compare **Best Model (Keras)**, **TFLite (Dynamic INT8)**, and **TinyML (Full INT8)** side-by-side using live microphone voice input or files from `Audio CNN/Audio Input/`.

#### A. Interactive Master Benchmark Menu
```powershell
python "Audio CNN\CNN Tests\test_all_models.py"
```

#### B. Live Voice Input from Microphone
Records voice/sound directly from your microphone with a 3-second countdown, runs DSP silence filtering and Log-Mel-Spectrogram extraction, tests all models, and auto-saves the recording to `Audio CNN/Audio Input/`:
```powershell
# Default 2-second microphone recording:
python "Audio CNN\CNN Tests\test_microphone.py"

# Continuous voice testing loop:
python "Audio CNN\CNN Tests\test_microphone.py" --loop

# Customize recording duration:
python "Audio CNN\CNN Tests\test_microphone.py" --duration 3.0
```

#### C. Test Audio Files from `Audio CNN/Audio Input/`
```powershell
# Interactive file selection menu:
python "Audio CNN\CNN Tests\test_audio_input.py"

# Test a specific file in Audio Input/:
python "Audio CNN\CNN Tests\test_audio_input.py" --file sample_gunshot_ak12.wav

# Batch benchmark all files in Audio Input/ with CSV export:
python "Audio CNN\CNN Tests\test_audio_input.py" --all --export-csv
```

