"""
evaluate_test.py
Full test set evaluation script.
Loads dataset and model from Data_Prep/ and Models/, evaluates performance,
and saves plots/metrics into Results/.
"""

import os
import sys
import json
import shutil
import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
import tensorflow as tf
from pathlib import Path
from sklearn.model_selection import train_test_split
from sklearn.metrics import classification_report, confusion_matrix

test_dir = Path(__file__).resolve().parent
audio_cnn_dir = test_dir.parent
project_root = audio_cnn_dir.parent

def run_evaluation():
    data_prep_dir = audio_cnn_dir / 'Data_Prep'
    models_dir = audio_cnn_dir / 'Models'
    results_dir = audio_cnn_dir / 'Results'
    
    index_csv = data_prep_dir / 'dataset_index.csv'
    cache_file = models_dir / 'features_cache.npz'
    model_path = models_dir / 'best_cnn_model.keras'
    classes_path = models_dir / 'classes.json'
    
    print("Loading test data and model...")
    df = pd.read_csv(index_csv)
    with open(classes_path, 'r') as f:
        classes = json.load(f)
        
    cache = np.load(cache_file, allow_pickle=True)
    X = cache['X']
    y = cache['y']
    
    indices = np.arange(len(y))
    train_idx, val_idx = train_test_split(indices, test_size=0.2, random_state=42, stratify=y)
    
    X_val = X[val_idx]
    y_val = y[val_idx]
    val_df = df.iloc[val_idx].copy().reset_index(drop=True)
    
    print(f"Total test/validation samples: {len(X_val)}")
    
    model = tf.keras.models.load_model(str(model_path))
    
    pred_probs = model.predict(X_val, batch_size=32, verbose=0)
    pred_labels = np.argmax(pred_probs, axis=1)
    
    val_df['pred_label_idx'] = pred_labels
    val_df['pred_label'] = [classes[i] for i in pred_labels]
    val_df['confidence'] = np.max(pred_probs, axis=1)
    val_df['is_correct'] = val_df['label'] == val_df['pred_label']
    
    accuracy = np.mean(val_df['is_correct'])
    report_text = classification_report(y_val, pred_labels, target_names=classes)
    cm = confusion_matrix(y_val, pred_labels)
    
    print("\n" + "="*50)
    print(f"OVERALL TEST ACCURACY: {accuracy * 100:.2f}%")
    print("="*50)
    print(report_text)
    
    results_dir.mkdir(parents=True, exist_ok=True)
    
    # 1. Confusion Matrix Plot
    fig, ax = plt.subplots(figsize=(7, 6))
    cm_norm = cm.astype('float') / cm.sum(axis=1)[:, np.newaxis]
    im = ax.imshow(cm_norm, cmap=plt.cm.Blues, vmin=0, vmax=1)
    cbar = fig.colorbar(im, ax=ax)
    cbar.set_label('Recall Rate', rotation=270, labelpad=15)
    
    ax.set_xticks(np.arange(len(classes)))
    ax.set_yticks(np.arange(len(classes)))
    ax.set_xticklabels(classes, fontsize=11, fontweight='bold')
    ax.set_yticklabels(classes, fontsize=11, fontweight='bold')
    ax.set_xlabel('Predicted Class', fontsize=12, labelpad=10)
    ax.set_ylabel('True Class', fontsize=12, labelpad=10)
    ax.set_title(f'Test Confusion Matrix (Accuracy: {accuracy*100:.2f}%)', fontsize=13, fontweight='bold', pad=12)
    
    for i in range(len(classes)):
        for j in range(len(classes)):
            count = cm[i, j]
            pct = cm_norm[i, j] * 100
            color = 'white' if cm_norm[i, j] > 0.5 else 'black'
            ax.text(j, i, f"{count}\n({pct:.1f}%)", ha="center", va="center", color=color, fontweight='bold', fontsize=11)
            
    plt.tight_layout()
    cm_img_path = results_dir / 'eval_confusion_matrix.png'
    plt.savefig(cm_img_path, dpi=180)
    plt.close()
    
    # 2. Subcategory Bar Chart
    subcat_stats = []
    for subcat, group in val_df.groupby('sub_category'):
        acc = group['is_correct'].mean()
        avg_conf = group['confidence'].mean()
        subcat_stats.append({
            'Subcategory': subcat,
            'Accuracy': f"{acc * 100:.1f}%",
            'Avg Confidence': f"{avg_conf * 100:.1f}%"
        })
        
    fig, ax = plt.subplots(figsize=(11, 6))
    sorted_subcats = sorted(subcat_stats, key=lambda x: float(x['Accuracy'].replace('%', '')))
    names = [s['Subcategory'].replace('Gunshots/', '').replace('Scream Sounds/', '') for s in sorted_subcats]
    accs = [float(s['Accuracy'].replace('%', '')) for s in sorted_subcats]
    colors = ['#27ae60' if a >= 95 else '#2980b9' if a >= 85 else '#e67e22' for a in accs]
    
    bars = ax.barh(names, accs, color=colors, height=0.6)
    ax.set_xlim(0, 105)
    ax.set_xlabel('Accuracy (%)', fontsize=12, fontweight='bold')
    ax.set_title('Subcategory / Weapon Accuracy on Test Set', fontsize=13, fontweight='bold', pad=12)
    ax.axvline(accuracy * 100, color='#e74c3c', linestyle='--', linewidth=1.5, label=f'Overall Test Avg ({accuracy*100:.1f}%)')
    ax.legend(loc='lower right')
    ax.grid(axis='x', alpha=0.3)
    
    for bar in bars:
        w = bar.get_width()
        ax.text(w + 1, bar.get_y() + bar.get_height()/2, f"{w:.1f}%", va='center', fontsize=10, fontweight='bold')
        
    plt.tight_layout()
    subcat_img_path = results_dir / 'eval_subcategories.png'
    plt.savefig(subcat_img_path, dpi=180)
    plt.close()
    
    # Save CSV
    test_results_csv = results_dir / 'test_evaluation_results.csv'
    val_df.to_csv(test_results_csv, index=False)
    print(f"\nEvaluation plots and results saved into: {results_dir}")

if __name__ == '__main__':
    run_evaluation()
