"""
predict.py
Inference script to classify any audio file using the trained Audio CNN model.
"""

import os
import sys
import json
import argparse
from pathlib import Path
import numpy as np
import tensorflow as tf

test_dir = Path(__file__).resolve().parent
audio_cnn_dir = test_dir.parent
project_root = audio_cnn_dir.parent
train_dir = audio_cnn_dir / "Train"

if str(train_dir) not in sys.path:
    sys.path.insert(0, str(train_dir))

from clean import preprocess_audio
from data_generator import extract_mel_spectrogram

def predict_sound(audio_path, model_path=None, classes_path=None):
    models_dir = audio_cnn_dir / 'Models'
    
    if model_path is None:
        model_path = models_dir / 'best_cnn_model.keras'
    if classes_path is None:
        classes_path = models_dir / 'classes.json'
        
    model_path = Path(model_path)
    classes_path = Path(classes_path)
    audio_path = Path(audio_path)
    
    if not model_path.exists():
        raise FileNotFoundError(f"Trained model not found at '{model_path}'.")
    if not classes_path.exists():
        raise FileNotFoundError(f"Classes mapping file not found at '{classes_path}'.")
    if not audio_path.exists():
        raise FileNotFoundError(f"Audio file not found at '{audio_path}'.")
        
    with open(classes_path, 'r') as f:
        classes = json.load(f)
        
    model = tf.keras.models.load_model(str(model_path))
    
    audio = preprocess_audio(audio_path, target_sr=16000, duration=1.0)
    mel_spec = extract_mel_spectrogram(audio, rate=16000)
    input_tensor = np.expand_dims(mel_spec, axis=0)
    
    preds = model.predict(input_tensor, verbose=0)[0]
    top_idx = int(np.argmax(preds))
    predicted_label = classes[top_idx]
    confidence = float(preds[top_idx])
    
    print("\n" + "="*45)
    print(f"File: {audio_path.name}")
    print(f"Predicted Class: {predicted_label} ({confidence * 100:.2f}%)")
    print("="*45)
    print("Class Probabilities:")
    for cls_name, prob in zip(classes, preds):
        bar = "#" * int(prob * 20)
        print(f"  {cls_name:<12}: {prob * 100:6.2f}% | {bar}")
    print("="*45 + "\n")
    
    return {
        'file': str(audio_path),
        'predicted_label': predicted_label,
        'confidence': confidence,
        'probabilities': {cls_name: float(p) for cls_name, p in zip(classes, preds)}
    }

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description="Predict audio class with trained CNN")
    parser.add_argument('--audio', type=str, required=False, help='Path to audio file (.wav)')
    args = parser.parse_args()
    
    if args.audio:
        predict_sound(args.audio)
    else:
        sample_file = project_root / 'Datasets' / 'Gunshots' / 'AK-47' / '1 (1).wav'
        if sample_file.exists():
            print(f"No audio file specified. Testing on default sample: {sample_file}")
            predict_sound(sample_file)
        else:
            print("Please specify an audio file using --audio <path_to_wav>")
