"""
train.py
Trains the 2D CNN model for audio classification using Seth Adams' pipeline.
Loads index from Data_Prep/, saves trained model to Models/, and logs/plots to Results/.
"""

import os
import sys
import json
import argparse
from pathlib import Path
import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
import tensorflow as tf
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import LabelEncoder
from sklearn.utils.class_weight import compute_class_weight
from sklearn.metrics import classification_report, confusion_matrix
from tensorflow.keras.callbacks import ModelCheckpoint, EarlyStopping, CSVLogger, ReduceLROnPlateau

train_dir = Path(__file__).resolve().parent
audio_cnn_dir = train_dir.parent
if str(train_dir) not in sys.path:
    sys.path.insert(0, str(train_dir))

from clean import preprocess_audio
from data_generator import extract_mel_spectrogram
from models import get_conv2d_model

def load_or_extract_features(df, cache_file, target_sr=16000, duration=1.0):
    if cache_file.exists():
        print(f"Loading precomputed features from: {cache_file}")
        data = np.load(cache_file, allow_pickle=True)
        return data['X'], data['y'], data['classes']
        
    print(f"Extracting features for {len(df)} files...")
    X = []
    y_raw = df['label'].values
    
    le = LabelEncoder()
    y_encoded = le.fit_transform(y_raw)
    
    total = len(df)
    for i, (_, row) in enumerate(df.iterrows()):
        audio = preprocess_audio(row['absolute_path'], target_sr=target_sr, duration=duration)
        spec = extract_mel_spectrogram(audio, rate=target_sr)
        X.append(spec)
        if (i + 1) % 500 == 0 or (i + 1) == total:
            print(f"  Processed {i + 1}/{total} audio files")
            
    X = np.array(X, dtype=np.float32)
    y = np.array(y_encoded, dtype=np.int32)
    classes = le.classes_
    
    cache_file.parent.mkdir(parents=True, exist_ok=True)
    print(f"Saving features cache to: {cache_file}")
    np.savez_compressed(cache_file, X=X, y=y, classes=classes)
    return X, y, classes

def plot_history(history, output_path):
    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(14, 5))
    
    ax1.plot(history.history['accuracy'], label='Train Accuracy', linewidth=2, color='#2980b9')
    ax1.plot(history.history['val_accuracy'], label='Val Accuracy', linewidth=2, color='#e67e22', linestyle='--')
    ax1.set_title('Model Accuracy vs Epoch', fontsize=12, fontweight='bold')
    ax1.set_xlabel('Epoch')
    ax1.set_ylabel('Accuracy')
    ax1.legend()
    ax1.grid(True, alpha=0.3)
    
    ax2.plot(history.history['loss'], label='Train Loss', linewidth=2, color='#2980b9')
    ax2.plot(history.history['val_loss'], label='Val Loss', linewidth=2, color='#e67e22', linestyle='--')
    ax2.set_title('Model Loss vs Epoch', fontsize=12, fontweight='bold')
    ax2.set_xlabel('Epoch')
    ax2.set_ylabel('Loss')
    ax2.legend()
    ax2.grid(True, alpha=0.3)
    
    plt.tight_layout()
    output_path.parent.mkdir(parents=True, exist_ok=True)
    plt.savefig(output_path, dpi=150)
    plt.close()
    print(f"Training curves saved to: {output_path}")

def plot_confusion_matrix(cm, classes, output_path):
    fig, ax = plt.subplots(figsize=(7, 6))
    im = ax.imshow(cm, interpolation='nearest', cmap=plt.cm.Blues)
    ax.figure.colorbar(im, ax=ax)
    
    ax.set(xticks=np.arange(cm.shape[1]),
           yticks=np.arange(cm.shape[0]),
           xticklabels=classes, yticklabels=classes,
           title='Confusion Matrix',
           ylabel='True Label',
           xlabel='Predicted Label')
           
    thresh = cm.max() / 2.
    for i in range(cm.shape[0]):
        for j in range(cm.shape[1]):
            ax.text(j, i, format(cm[i, j], 'd'),
                    ha="center", va="center",
                    color="white" if cm[i, j] > thresh else "black",
                    fontweight='bold')
                    
    plt.tight_layout()
    output_path.parent.mkdir(parents=True, exist_ok=True)
    plt.savefig(output_path, dpi=150)
    plt.close()
    print(f"Confusion matrix saved to: {output_path}")

def main():
    parser = argparse.ArgumentParser(description="Train Audio CNN Model")
    parser.add_argument('--epochs', type=int, default=25, help='Number of training epochs')
    parser.add_argument('--batch_size', type=int, default=32, help='Batch size')
    parser.add_argument('--test_size', type=float, default=0.2, help='Validation split fraction')
    args = parser.parse_args()
    
    # Path setup
    data_prep_dir = audio_cnn_dir / 'Data_Prep'
    models_dir = audio_cnn_dir / 'Models'
    results_dir = audio_cnn_dir / 'Results'
    
    index_csv = data_prep_dir / 'dataset_index.csv'
    cache_file = models_dir / 'features_cache.npz'
    model_save_path = models_dir / 'best_cnn_model.keras'
    classes_json_path = models_dir / 'classes.json'
    
    if not index_csv.exists():
        index_csv = audio_cnn_dir / 'dataset_index.csv'
    if not index_csv.exists():
        print(f"Error: dataset_index.csv not found.")
        return
        
    df = pd.read_csv(index_csv)
    print(f"Loaded {len(df)} samples from {index_csv}")
    print(df['label'].value_counts())
    
    # 1. Feature Extraction / Loading
    X, y, classes = load_or_extract_features(df, cache_file)
    num_classes = len(classes)
    
    models_dir.mkdir(parents=True, exist_ok=True)
    with open(classes_json_path, 'w') as f:
        json.dump(list(classes), f, indent=2)
    print(f"Class mapping saved to: {classes_json_path}")
    
    # 2. Train/Test Split
    X_train, X_val, y_train_raw, y_val_raw = train_test_split(
        X, y, test_size=args.test_size, random_state=42, stratify=y
    )
    
    y_train = tf.keras.utils.to_categorical(y_train_raw, num_classes=num_classes)
    y_val = tf.keras.utils.to_categorical(y_val_raw, num_classes=num_classes)
    
    print(f"Training samples: {len(X_train)}, Validation samples: {len(X_val)}")
    
    # 3. Class Weights
    class_weights_vals = compute_class_weight('balanced', classes=np.unique(y_train_raw), y=y_train_raw)
    class_weights_dict = {i: weight for i, weight in enumerate(class_weights_vals)}
    print("Computed class weights:", class_weights_dict)
    
    # 4. Model Architecture
    input_shape = X_train.shape[1:]
    model = get_conv2d_model(input_shape=input_shape, num_classes=num_classes)
    
    # 5. Callbacks
    results_dir.mkdir(parents=True, exist_ok=True)
    callbacks = [
        ModelCheckpoint(
            filepath=str(model_save_path),
            monitor='val_accuracy',
            mode='max',
            save_best_only=True,
            verbose=1
        ),
        EarlyStopping(
            monitor='val_loss',
            patience=7,
            restore_best_weights=True,
            verbose=1
        ),
        ReduceLROnPlateau(
            monitor='val_loss',
            factor=0.5,
            patience=3,
            verbose=1
        ),
        CSVLogger(
            filename=str(results_dir / 'training_log.csv'),
            separator=',',
            append=False
        )
    ]
    
    # 6. Training
    print(f"\nStarting training for {args.epochs} epochs...")
    history = model.fit(
        X_train, y_train,
        validation_data=(X_val, y_val),
        epochs=args.epochs,
        batch_size=args.batch_size,
        class_weight=class_weights_dict,
        callbacks=callbacks,
        verbose=1
    )
    
    # 7. Plot Curves
    plot_history(history, results_dir / 'training_history.png')
    
    # 8. Evaluation & Metrics
    print("\n--- Evaluating Best Model on Validation Set ---")
    val_preds_probs = model.predict(X_val)
    val_preds = np.argmax(val_preds_probs, axis=1)
    
    print("\nClassification Report:")
    report = classification_report(y_val_raw, val_preds, target_names=classes)
    print(report)
    
    cm = confusion_matrix(y_val_raw, val_preds)
    plot_confusion_matrix(cm, classes, results_dir / 'confusion_matrix.png')
    
    print(f"\nModel training and evaluation complete! Best model saved to: {model_save_path}")

if __name__ == '__main__':
    main()
