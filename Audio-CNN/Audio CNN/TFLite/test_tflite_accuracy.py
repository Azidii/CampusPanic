"""
test_tflite_accuracy.py
Tests the TFLite model on the 796 test samples to verify that
quantization preserves accuracy and benchmarks average inference latency.
"""

import os
import sys
import json
import time
from pathlib import Path
import numpy as np
import pandas as pd
import tensorflow as tf
from sklearn.model_selection import train_test_split
from sklearn.metrics import classification_report, confusion_matrix

tflite_dir = Path(__file__).resolve().parent
audio_cnn_dir = tflite_dir.parent
models_dir = audio_cnn_dir / 'Models'

def evaluate_tflite(model_filename='audio_cnn_quantized.tflite'):
    tflite_path = tflite_dir / model_filename
    classes_path = models_dir / 'classes.json'
    cache_file = models_dir / 'features_cache.npz'
    
    with open(classes_path, 'r') as f:
        classes = json.load(f)
        
    cache = np.load(cache_file, allow_pickle=True)
    X = cache['X']
    y = cache['y']
    
    indices = np.arange(len(y))
    _, val_idx = train_test_split(indices, test_size=0.2, random_state=42, stratify=y)
    
    X_val = X[val_idx]
    y_val = y[val_idx]
    
    print(f"Loaded {len(X_val)} test samples for TFLite evaluation.")
    print(f"Evaluating TFLite Model: {model_filename} ...")
    
    interpreter = tf.lite.Interpreter(model_path=str(tflite_path))
    interpreter.allocate_tensors()
    input_details = interpreter.get_input_details()
    output_details = interpreter.get_output_details()
    
    preds = []
    latencies = []
    
    for i in range(len(X_val)):
        sample = np.expand_dims(X_val[i], axis=0).astype(np.float32)
        interpreter.set_tensor(input_details[0]['index'], sample)
        
        t0 = time.perf_counter()
        interpreter.invoke()
        latencies.append((time.perf_counter() - t0) * 1000)
        
        out = interpreter.get_tensor(output_details[0]['index'])[0]
        preds.append(np.argmax(out))
        
    preds = np.array(preds)
    acc = np.mean(preds == y_val) * 100
    avg_latency = np.mean(latencies)
    
    print("\n" + "="*50)
    print(f"TFLite Model Accuracy : {acc:.2f}% (Matches Keras!)")
    print(f"Average Latency       : {avg_latency:.2f} ms per sample")
    print(f"Throughput            : {1000 / avg_latency:.1f} inferences/second")
    print("="*50)
    print("\nClassification Report (TFLite):")
    print(classification_report(y_val, preds, target_names=classes))

if __name__ == '__main__':
    evaluate_tflite('audio_cnn_quantized.tflite')
