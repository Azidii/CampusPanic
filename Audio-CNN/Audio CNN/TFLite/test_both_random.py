"""
test_both_random.py
Tests random audio files from Datasets/random simultaneously on BOTH
TFLite models (Float32 and INT8 Quantized), comparing:
- Predictions vs True Ground Truth
- Confidence scores
- Inference latency & speedup
- Model agreement rate
"""

import sys
import json
import time
import random
import argparse
from datetime import datetime
from pathlib import Path
import numpy as np
import pandas as pd
import tensorflow as tf

tflite_dir = Path(__file__).resolve().parent
audio_cnn_dir = tflite_dir.parent
train_dir = audio_cnn_dir / 'Train'
models_dir = audio_cnn_dir / 'Models'
results_dir = audio_cnn_dir / 'Results'
project_root = audio_cnn_dir.parent

if str(train_dir) not in sys.path:
    sys.path.insert(0, str(train_dir))

from clean import preprocess_audio
from data_generator import extract_mel_spectrogram

def load_tflite_models():
    fp32_path = tflite_dir / 'audio_cnn_fp32.tflite'
    quant_path = tflite_dir / 'audio_cnn_quantized.tflite'
    classes_path = models_dir / 'classes.json'
    manifest_path = project_root / 'Datasets' / 'random' / 'random_manifest.csv'
    
    if not manifest_path.exists():
        manifest_path = audio_cnn_dir / 'Data_Prep' / 'random_manifest.csv'
        
    if not fp32_path.exists() or not quant_path.exists():
        raise FileNotFoundError("Both TFLite models must exist. Run convert_to_tflite.py first.")
        
    with open(classes_path, 'r') as f:
        classes = json.load(f)
        
    df_manifest = pd.read_csv(manifest_path)
    
    # Load FP32 Interpreter
    interp_fp32 = tf.lite.Interpreter(model_path=str(fp32_path))
    interp_fp32.allocate_tensors()
    
    # Load Quantized Interpreter
    interp_quant = tf.lite.Interpreter(model_path=str(quant_path))
    interp_quant.allocate_tensors()
    
    return interp_fp32, interp_quant, classes, df_manifest

def run_single_inference(interpreter, input_data):
    input_details = interpreter.get_input_details()
    output_details = interpreter.get_output_details()
    
    interpreter.set_tensor(input_details[0]['index'], input_data)
    t0 = time.perf_counter()
    interpreter.invoke()
    latency_ms = (time.perf_counter() - t0) * 1000
    
    preds = interpreter.get_tensor(output_details[0]['index'])[0]
    return preds, latency_ms

def print_comparison_card(idx, total, item):
    agree_tag = "[AGREED]" if item['fp32_pred'] == item['quant_pred'] else "[DISAGREED]"
    fp32_tag = "CORRECT" if item['fp32_correct'] else "WRONG"
    quant_tag = "CORRECT" if item['quant_correct'] else "WRONG"
    
    print("\n" + "="*70)
    print(f"Sample #{idx+1}/{total}: {item['filename']} {agree_tag}")
    print(f"  True Label: {item['true_label']} (Origin: {item['sub_category']})")
    print("-" * 70)
    print(f"  [FP32 Model]   : {item['fp32_pred']:<11} ({item['fp32_conf']*100:6.2f}%) | Latency: {item['fp32_latency']:5.2f} ms | [{fp32_tag}]")
    print(f"  [INT8 Quant]   : {item['quant_pred']:<11} ({item['quant_conf']*100:6.2f}%) | Latency: {item['quant_latency']:5.2f} ms | [{quant_tag}]")
    print(f"  Speedup Factor : {item['fp32_latency'] / max(item['quant_latency'], 0.001):.1f}x faster with INT8 Quantized")
    print("-" * 70)

def print_summary(results):
    df_res = pd.DataFrame(results)
    total = len(df_res)
    fp32_acc = (df_res['fp32_correct'].sum() / total) * 100
    quant_acc = (df_res['quant_correct'].sum() / total) * 100
    agreement_rate = ((df_res['fp32_pred'] == df_res['quant_pred']).sum() / total) * 100
    
    avg_fp32_lat = df_res['fp32_latency'].mean()
    avg_quant_lat = df_res['quant_latency'].mean()
    speedup = avg_fp32_lat / max(avg_quant_lat, 0.001)
    
    print("\n" + "="*70)
    print("             FLOAT32 VS INT8 QUANTIZED TEST COMPARISON")
    print("="*70)
    print(f"Total Samples Tested     : {total}")
    print(f"FP32 Model Accuracy      : {fp32_acc:.2f}% ({df_res['fp32_correct'].sum()}/{total})")
    print(f"INT8 Quantized Accuracy  : {quant_acc:.2f}% ({df_res['quant_correct'].sum()}/{total})")
    print(f"Inter-Model Agreement    : {agreement_rate:.2f}% (Both models agreed on prediction)")
    print("-" * 70)
    print(f"Average FP32 Latency     : {avg_fp32_lat:.2f} ms per sample")
    print(f"Average INT8 Latency     : {avg_quant_lat:.2f} ms per sample")
    print(f"Latency Improvement      : {speedup:.1f}x faster with INT8 Quantization")
    print("="*70)

def main():
    parser = argparse.ArgumentParser(description="Compare Float32 and INT8 Quantized TFLite models on random files")
    parser.add_argument('--n', type=int, default=5, help='Number of random files to test (default: 5)')
    parser.add_argument('--file', type=str, default=None, help='Test a specific file')
    args = parser.parse_args()
    
    interp_fp32, interp_quant, classes, df_manifest = load_tflite_models()
    random_dir = project_root / 'Datasets' / 'random'
    
    if args.file:
        selected_rows = df_manifest[df_manifest['random_filename'] == args.file]
        if selected_rows.empty:
            selected_rows = df_manifest[df_manifest['original_filename'] == args.file]
        if selected_rows.empty:
            print(f"File '{args.file}' not found.")
            return
    else:
        sample_count = min(args.n, len(df_manifest))
        selected_rows = df_manifest.sample(n=sample_count, random_state=random.randint(1, 999999))
        
    print(f"\nTesting {len(selected_rows)} random sound(s) on BOTH Float32 & INT8 Quantized TFLite...")
    
    results = []
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    
    for idx, (_, row) in enumerate(selected_rows.iterrows()):
        file_path = random_dir / row['random_filename']
        if not file_path.exists():
            file_path = Path(row['random_file_path'])
            
        # Preprocess
        audio = preprocess_audio(file_path, target_sr=16000, duration=1.0)
        mel_spec = extract_mel_spectrogram(audio, rate=16000)
        input_data = np.expand_dims(mel_spec, axis=0).astype(np.float32)
        
        # 1. Run FP32
        probs_fp32, lat_fp32 = run_single_inference(interp_fp32, input_data)
        top_fp32 = int(np.argmax(probs_fp32))
        pred_fp32 = classes[top_fp32]
        conf_fp32 = float(probs_fp32[top_fp32])
        
        # 2. Run INT8 Quantized
        probs_quant, lat_quant = run_single_inference(interp_quant, input_data)
        top_quant = int(np.argmax(probs_quant))
        pred_quant = classes[top_quant]
        conf_quant = float(probs_quant[top_quant])
        
        true_lbl = row['true_label']
        
        item = {
            'timestamp': timestamp,
            'filename': row['random_filename'],
            'sub_category': row['sub_category'],
            'true_label': true_lbl,
            'fp32_pred': pred_fp32,
            'fp32_conf': conf_fp32,
            'fp32_latency': lat_fp32,
            'fp32_correct': (pred_fp32 == true_lbl),
            'quant_pred': pred_quant,
            'quant_conf': conf_quant,
            'quant_latency': lat_quant,
            'quant_correct': (pred_quant == true_lbl)
        }
        results.append(item)
        print_comparison_card(idx, len(selected_rows), item)
        
    print_summary(results)
    
    # Log to CSV
    results_dir.mkdir(parents=True, exist_ok=True)
    history_path = results_dir / 'tflite_comparison_history.csv'
    df_new = pd.DataFrame(results)
    if history_path.exists():
        df_old = pd.read_csv(history_path)
        pd.concat([df_old, df_new], ignore_index=True).to_csv(history_path, index=False)
    else:
        df_new.to_csv(history_path, index=False)
    print(f"\nComparison results logged to: {history_path}")

if __name__ == '__main__':
    main()
