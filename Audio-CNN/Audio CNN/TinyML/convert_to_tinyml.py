"""
convert_to_tinyml.py
Converts best_cnn_model.keras → fully INT8 quantized TFLite → C header file
for deployment on microcontrollers (Arduino, ESP32, STM32, etc.)
"""

import os
import numpy as np
from pathlib import Path
import tensorflow as tf

# ── Paths ──────────────────────────────────────────────────────────────────────
SCRIPT_DIR   = Path(__file__).resolve().parent
AUDIO_CNN    = SCRIPT_DIR.parent
MODELS_DIR   = AUDIO_CNN / "Models"
TFLITE_DIR   = AUDIO_CNN / "TFLite"
CACHE_PATH   = MODELS_DIR / "features_cache.npz"
KERAS_PATH   = MODELS_DIR / "best_cnn_model.keras"
INT8_PATH    = TFLITE_DIR / "audio_cnn_int8.tflite"
HEADER_PATH  = TFLITE_DIR / "audio_cnn_model.h"

# ── 1. Load representative data from your cache ────────────────────────────────
print("Loading feature cache for representative dataset...")
cache = np.load(CACHE_PATH)
X_rep = cache["X"].astype(np.float32)          # shape: (N, 97, 128, 1)

# Use ~200 samples as representative dataset (enough for calibration)
rep_samples = X_rep[:200]

def representative_dataset():
    for sample in rep_samples:
        yield [sample[np.newaxis, ...]]          # shape: (1, 97, 128, 1)

# ── 2. Load Keras model ────────────────────────────────────────────────────────
print(f"Loading model from: {KERAS_PATH}")
model = tf.keras.models.load_model(str(KERAS_PATH))

# ── 3. Full INT8 Quantization ──────────────────────────────────────────────────
print("Converting to Full INT8 TFLite...")
converter = tf.lite.TFLiteConverter.from_keras_model(model)
converter.optimizations = [tf.lite.Optimize.DEFAULT]
converter.representative_dataset = representative_dataset
converter.target_spec.supported_ops = [tf.lite.OpsSet.TFLITE_BUILTINS_INT8]
converter.inference_input_type  = tf.int8   # input tensor is INT8
converter.inference_output_type = tf.int8   # output tensor is INT8

tflite_int8_model = converter.convert()

with open(INT8_PATH, "wb") as f:
    f.write(tflite_int8_model)

size_kb = len(tflite_int8_model) / 1024
print(f"Saved: {INT8_PATH.name}  ({size_kb:.1f} KB)")

# ── 4. Convert .tflite → C Header (.h) ────────────────────────────────────────
print(f"Generating C header: {HEADER_PATH.name}")

def tflite_to_c_header(tflite_bytes: bytes, var_name: str = "audio_cnn_model") -> str:
    hex_array = ", ".join(f"0x{b:02x}" for b in tflite_bytes)
    # Wrap at 12 bytes per line for readability
    byte_list  = [f"0x{b:02x}" for b in tflite_bytes]
    lines      = [", ".join(byte_list[i:i+12]) for i in range(0, len(byte_list), 12)]
    hex_block  = ",\n  ".join(lines)
    
    header = f"""\
// AUTO-GENERATED — DO NOT EDIT
// Model: audio_cnn_int8.tflite
// Size : {len(tflite_bytes):,} bytes  ({len(tflite_bytes)/1024:.1f} KB)

#ifndef AUDIO_CNN_MODEL_H
#define AUDIO_CNN_MODEL_H

#include <stdint.h>

// Total model size in bytes
const unsigned int {var_name}_len = {len(tflite_bytes)};

// Model data array (INT8 quantized, TFLite FlatBuffer)
alignas(8) const uint8_t {var_name}[] = {{
  {hex_block}
}};

#endif // AUDIO_CNN_MODEL_H
"""
    return header

header_str = tflite_to_c_header(tflite_int8_model)
with open(HEADER_PATH, "w") as f:
    f.write(header_str)

print(f"Saved: {HEADER_PATH.name}")

# ── 5. Summary ────────────────────────────────────────────────────────────────
keras_mb = os.path.getsize(KERAS_PATH) / (1024**2)
fp32_mb  = os.path.getsize(TFLITE_DIR / "audio_cnn_fp32.tflite") / (1024**2)
quant_mb = os.path.getsize(TFLITE_DIR / "audio_cnn_quantized.tflite") / (1024**2)
int8_kb  = len(tflite_int8_model) / 1024

print("\n" + "="*55)
print("              TINYML CONVERSION SUMMARY")
print("="*55)
print(f"  Original Keras model     : {keras_mb:8.2f} MB")
print(f"  Float32 TFLite           : {fp32_mb:8.2f} MB")
print(f"  Dynamic INT8 TFLite      : {quant_mb:8.2f} MB")
print(f"  Full INT8 TFLite (TinyML): {int8_kb:8.1f} KB  ← deploy this")
print(f"  C Header (.h)            : generated for MCU flashing")
print("="*55)
print("\nNext steps:")
print("  1. Copy 'audio_cnn_model.h' into your Arduino/ESP32 sketch folder")
print("  2. Use TensorFlow Lite for Microcontrollers (TFLM) runtime")
print("  3. Include the header and call interpreter with model data array")
