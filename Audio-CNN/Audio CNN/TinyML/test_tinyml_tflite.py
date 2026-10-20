"""
test_tinyml_tflite.py
Tests the Full INT8 TFLite (TinyML) model — accuracy, latency,
and per-class comparison against the dynamic-range quantized model.
Place this in:  Audio CNN/TinyML/
"""

import os
import sys
import json
import time
from pathlib import Path
import numpy as np
import tensorflow as tf
from sklearn.model_selection import train_test_split
from sklearn.metrics import classification_report, confusion_matrix

# ── Paths ──────────────────────────────────────────────────────────────────────
TINYML_DIR  = Path(__file__).resolve().parent
AUDIO_CNN   = TINYML_DIR.parent
MODELS_DIR  = AUDIO_CNN / "Models"
TFLITE_DIR  = AUDIO_CNN / "TFLite"

INT8_MODEL  = TINYML_DIR / "audio_cnn_int8.tflite"
QUANT_MODEL = TFLITE_DIR / "audio_cnn_quantized.tflite"
CLASSES     = MODELS_DIR / "classes.json"
CACHE       = MODELS_DIR / "features_cache.npz"

# ── Helpers ────────────────────────────────────────────────────────────────────
def run_interpreter(model_path: Path, X: np.ndarray, is_int8: bool):
    """Run all samples through a TFLite interpreter. Returns (preds, latencies)."""
    interp = tf.lite.Interpreter(model_path=str(model_path))
    interp.allocate_tensors()

    inp  = interp.get_input_details()[0]
    out  = interp.get_output_details()[0]

    preds, latencies = [], []

    for i in range(len(X)):
        sample = np.expand_dims(X[i], axis=0)

        if is_int8:
            # Quantize float → int8 using the model's scale/zero_point
            scale, zp = inp["quantization"]
            sample = (sample / scale + zp).astype(np.int8)
        else:
            sample = sample.astype(np.float32)

        interp.set_tensor(inp["index"], sample)

        t0 = time.perf_counter()
        interp.invoke()
        latencies.append((time.perf_counter() - t0) * 1000)

        raw = interp.get_tensor(out["index"])[0]

        if is_int8:
            # Dequantize int8 → float
            o_scale, o_zp = out["quantization"]
            raw = (raw.astype(np.float32) - o_zp) * o_scale

        preds.append(np.argmax(raw))

        if (i + 1) % 100 == 0:
            print(f"  {i+1}/{len(X)} samples done...", end="\r")

    return np.array(preds), np.array(latencies)


def print_report(name, preds, y_true, latencies, classes, model_path):
    acc       = np.mean(preds == y_true) * 100
    avg_ms    = np.mean(latencies)
    p95_ms    = np.percentile(latencies, 95)
    size_kb   = os.path.getsize(model_path) / 1024

    print(f"\n{'='*60}")
    print(f"  {name}")
    print(f"{'='*60}")
    print(f"  Model File    : {Path(model_path).name}")
    print(f"  Model Size    : {size_kb:.1f} KB")
    print(f"  Test Samples  : {len(y_true)}")
    print(f"  Accuracy      : {acc:.2f}%")
    print(f"  Avg Latency   : {avg_ms:.2f} ms")
    print(f"  p95 Latency   : {p95_ms:.2f} ms")
    print(f"  Throughput    : {1000/avg_ms:.1f} inf/sec")
    print(f"\n  Classification Report:")
    report = classification_report(y_true, preds, target_names=classes)
    indented = "\n".join("  " + line for line in report.splitlines())
    print(indented)

    cm = confusion_matrix(y_true, preds)
    print(f"  Confusion Matrix:")
    print(f"  {'':12}", end="")
    for c in classes:
        print(f"  {c:<12}", end="")
    print()
    for i, row in enumerate(cm):
        print(f"  {classes[i]:<12}", end="")
        for val in row:
            print(f"  {val:<12}", end="")
        print()


# ── Main ───────────────────────────────────────────────────────────────────────
def main():
    with open(CLASSES) as f:
        classes = json.load(f)

    print("Loading feature cache...")
    cache  = np.load(CACHE, allow_pickle=True)
    X, y   = cache["X"], cache["y"]

    # Same 80/20 split used during training
    idx = np.arange(len(y))
    _, val_idx = train_test_split(idx, test_size=0.2, random_state=42, stratify=y)
    X_val, y_val = X[val_idx], y[val_idx]
    print(f"Test set: {len(X_val)} samples | Classes: {classes}")

    # ── A. Test Full INT8 TFLite ───────────────────────────────────────────────
    if not INT8_MODEL.exists():
        print(f"[!] INT8 model not found: {INT8_MODEL}")
        print("    Run convert_to_tinyml.py first.")
    else:
        print(f"\n[1/2] Running INT8 TFLite model...")
        preds_int8, lat_int8 = run_interpreter(INT8_MODEL, X_val, is_int8=True)
        print_report("FULL INT8 TFLite (TinyML)", preds_int8, y_val, lat_int8, classes, INT8_MODEL)

    # ── B. Test Dynamic-Range Quantized for comparison ─────────────────────────
    if not QUANT_MODEL.exists():
        print(f"[!] Quantized model not found: {QUANT_MODEL}")
    else:
        print(f"\n[2/2] Running Dynamic-Range Quantized model (baseline)...")
        preds_dyn, lat_dyn = run_interpreter(QUANT_MODEL, X_val, is_int8=False)
        print_report("Dynamic-Range INT8 TFLite (Baseline)", preds_dyn, y_val, lat_dyn, classes, QUANT_MODEL)

    # ── C. Side-by-side accuracy delta ────────────────────────────────────────
    if INT8_MODEL.exists() and QUANT_MODEL.exists():
        acc_int8 = np.mean(preds_int8 == y_val) * 100
        acc_dyn  = np.mean(preds_dyn  == y_val) * 100
        print(f"\n{'='*60}")
        print(f"  ACCURACY DELTA")
        print(f"{'='*60}")
        print(f"  Full INT8 TFLite        : {acc_int8:.2f}%")
        print(f"  Dynamic-Range Quantized : {acc_dyn:.2f}%")
        print(f"  Difference              : {acc_int8 - acc_dyn:+.2f}%")
        print(f"{'='*60}\n")


if __name__ == "__main__":
    main()
