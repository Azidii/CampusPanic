"""
test_random.py
Tests random WAV file(s) from Datasets/random, evaluates accuracy against ground truth,
displays full statistics, and logs all test runs to Results/random_test_history.csv.
"""

import os
import sys
import json
import random
import argparse
from datetime import datetime
from pathlib import Path
import numpy as np
import pandas as pd
import tensorflow as tf

test_dir = Path(__file__).resolve().parent
audio_cnn_dir = test_dir.parent
project_root = audio_cnn_dir.parent
train_dir = audio_cnn_dir / "Train"

if str(train_dir) not in sys.path:
    sys.path.insert(0, str(train_dir))

from clean import preprocess_audio
from data_generator import extract_mel_spectrogram

def load_resources():
    random_dir = project_root / "Datasets" / "random"
    if not random_dir.exists():
        random_dir = project_root / "dataset" / "random"
        
    models_dir = audio_cnn_dir / "Models"
    data_prep_dir = audio_cnn_dir / "Data_Prep"
    results_dir = audio_cnn_dir / "Results"
    
    # 1. Manifest
    manifest_path = random_dir / "random_manifest.csv"
    if not manifest_path.exists():
        manifest_path = data_prep_dir / "random_manifest.csv"
    if not manifest_path.exists():
        raise FileNotFoundError(f"Manifest not found.")
        
    df_manifest = pd.read_csv(manifest_path)
    
    # 2. Classes
    classes_path = models_dir / "classes.json"
    with open(classes_path, 'r') as f:
        classes = json.load(f)
        
    # 3. Model
    model_path = models_dir / "best_cnn_model.keras"
    if not model_path.exists():
        raise FileNotFoundError(f"Model not found at {model_path}.")
        
    model = tf.keras.models.load_model(str(model_path))
    
    return df_manifest, classes, model, random_dir, results_dir

def predict_single_file(file_path, model, classes):
    audio = preprocess_audio(file_path, target_sr=16000, duration=1.0)
    mel_spec = extract_mel_spectrogram(audio, rate=16000)
    input_tensor = np.expand_dims(mel_spec, axis=0)
    
    probs = model.predict(input_tensor, verbose=0)[0]
    top_idx = int(np.argmax(probs))
    pred_label = classes[top_idx]
    confidence = float(probs[top_idx])
    
    return pred_label, confidence, probs

def log_test_results(results, history_path):
    history_path.parent.mkdir(parents=True, exist_ok=True)
    history_df = pd.DataFrame(results)
    if history_path.exists():
        existing_df = pd.read_csv(history_path)
        combined_df = pd.concat([existing_df, history_df], ignore_index=True)
    else:
        combined_df = history_df
    combined_df.to_csv(history_path, index=False)
    return combined_df

def print_result_card(idx, item, total):
    status_symbol = "[CORRECT]" if item['is_correct'] else "[MISMATCH]"
    print("\n" + "-"*65)
    print(f"Test #{idx+1}/{total}: {item['filename']} {status_symbol}")
    print(f"  True Label    : {item['true_label']} (Origin: {item['sub_category']})")
    print(f"  Predicted     : {item['predicted_label']} (Confidence: {item['confidence']*100:.2f}%)")
    print("  Probabilities :")
    for cls_name, p in item['probabilities'].items():
        bar = "#" * int(p * 20)
        marker = " <--" if cls_name == item['predicted_label'] else ""
        print(f"    {cls_name:<11}: {p*100:6.2f}% | {bar:<20} {marker}")
    print("-"*65)

def print_statistics(results, cumulative_df=None):
    df_res = pd.DataFrame(results)
    total = len(df_res)
    correct = df_res['is_correct'].sum()
    acc = (correct / total) * 100 if total > 0 else 0.0
    
    print("\n" + "="*65)
    print("                  CURRENT BATCH STATISTICS")
    print("="*65)
    print(f"Total Files Tested   : {total}")
    print(f"Correct Predictions  : {correct}")
    print(f"Incorrect / Mismatch : {total - correct}")
    print(f"Batch Accuracy       : {acc:.2f}%")
    print(f"Average Confidence   : {df_res['confidence'].mean()*100:.2f}%")
    
    print("\nClass Performance Breakdown:")
    print(f"  {'Class':<12} | {'Tested':<6} | {'Correct':<7} | {'Accuracy':<9}")
    print("  " + "-"*40)
    for cls in df_res['true_label'].unique():
        sub = df_res[df_res['true_label'] == cls]
        c_tot = len(sub)
        c_cor = sub['is_correct'].sum()
        c_acc = (c_cor / c_tot) * 100 if c_tot > 0 else 0.0
        print(f"  {cls:<12} | {c_tot:<6} | {c_cor:<7} | {c_acc:6.1f}%")
        
    print("\nOrigin / Weapon Breakdown:")
    for subcat in sorted(df_res['sub_category'].unique()):
        sub = df_res[df_res['sub_category'] == subcat]
        s_tot = len(sub)
        s_cor = sub['is_correct'].sum()
        s_acc = (s_cor / s_tot) * 100 if s_tot > 0 else 0.0
        print(f"  {subcat:<28} : {s_cor}/{s_tot} correct ({s_acc:5.1f}%)")
        
    if cumulative_df is not None:
        cum_tot = len(cumulative_df)
        cum_cor = cumulative_df['is_correct'].sum()
        cum_acc = (cum_cor / cum_tot) * 100 if cum_tot > 0 else 0.0
        print("\n" + "="*65)
        print(f"ALL-TIME TRACKED HISTORY: {cum_cor}/{cum_tot} correct ({cum_acc:.2f}% accuracy across all sessions)")
        print("="*65)

def main():
    parser = argparse.ArgumentParser(description="Test random audio files from Datasets/random")
    parser.add_argument('--n', type=int, default=1, help='Number of random files to test (default: 1)')
    parser.add_argument('--all', action='store_true', help='Test all files in Datasets/random')
    parser.add_argument('--file', type=str, default=None, help='Test a specific file in Datasets/random')
    parser.add_argument('--class_filter', type=str, default=None, help='Filter by class (Gunshot, Scream, Non-Scream)')
    args = parser.parse_args()
    
    df_manifest, classes, model, random_dir, results_dir = load_resources()
    
    filtered_df = df_manifest.copy()
    if args.class_filter:
        filtered_df = filtered_df[filtered_df['true_label'].str.lower() == args.class_filter.lower()]
        if filtered_df.empty:
            print(f"No files matching class filter '{args.class_filter}'")
            return
            
    if args.file:
        selected_rows = df_manifest[df_manifest['random_filename'] == args.file]
        if selected_rows.empty:
            selected_rows = df_manifest[df_manifest['original_filename'] == args.file]
        if selected_rows.empty:
            print(f"File '{args.file}' not found in manifest.")
            return
    elif args.all:
        selected_rows = filtered_df
    else:
        sample_count = min(args.n, len(filtered_df))
        selected_rows = filtered_df.sample(n=sample_count, random_state=random.randint(1, 999999))
        
    print(f"\nEvaluating {len(selected_rows)} file(s) from '{random_dir.name}' ...")
    
    results = []
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    
    for idx, (_, row) in enumerate(selected_rows.iterrows()):
        file_path = random_dir / row['random_filename']
        if not file_path.exists():
            file_path = Path(row['random_file_path'])
            
        pred_label, confidence, probs = predict_single_file(file_path, model, classes)
        is_correct = (pred_label == row['true_label'])
        prob_dict = {cls_name: float(p) for cls_name, p in zip(classes, probs)}
        
        item = {
            'timestamp': timestamp,
            'filename': row['random_filename'],
            'original_filename': row['original_filename'],
            'original_path': row['original_path'],
            'sub_category': row['sub_category'],
            'true_label': row['true_label'],
            'predicted_label': pred_label,
            'is_correct': is_correct,
            'confidence': confidence,
            'probabilities': prob_dict,
            'prob_Gunshot': prob_dict.get('Gunshot', 0.0),
            'prob_Scream': prob_dict.get('Scream', 0.0),
            'prob_Non_Scream': prob_dict.get('Non-Scream', 0.0)
        }
        results.append(item)
        print_result_card(idx, item, len(selected_rows))
        
    history_csv = results_dir / "random_test_history.csv"
    cumulative_df = log_test_results(results, history_csv)
    
    print_statistics(results, cumulative_df)
    print(f"\nAll test records logged to: {history_csv}")

if __name__ == '__main__':
    main()
