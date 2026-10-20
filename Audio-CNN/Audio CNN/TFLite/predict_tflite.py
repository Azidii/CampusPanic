"""
predict_tflite.py
Inference script using TensorFlow Lite Interpreter.
Evaluates any audio file using the converted .tflite model and benchmarks latency.
"""

import sys
import json
import time
import argparse
from pathlib import Path
import numpy as np
import tensorflow as tf

tflite_dir = Path(__file__).resolve().parent
audio_cnn_dir = tflite_dir.parent
train_dir = audio_cnn_dir / 'Train'
models_dir = audio_cnn_dir / 'Models'
project_root = audio_cnn_dir.parent

if str(train_dir) not in sys.path:
    sys.path.insert(0, str(train_dir))

from clean import preprocess_audio
from data_generator import extract_mel_spectrogram

def predict_with_tflite(audio_path, model_path=None, classes_path=None):
    if model_path is None:
        # Default to quantized if available, else fp32
        quant_model = tflite_dir / 'audio_cnn_quantized.tflite'
        fp32_model = tflite_dir / 'audio_cnn_fp32.tflite'
        model_path = quant_model if quant_model.exists() else fp32_model
        
    if classes_path is None:
        classes_path = models_dir / 'classes.json'
        
    model_path = Path(model_path)
    classes_path = Path(classes_path)
    audio_path = Path(audio_path)
    
    if not model_path.exists():
        raise FileNotFoundError(f"TFLite model not found at {model_path}. Run convert_to_tflite.py first.")
    if not classes_path.exists():
        raise FileNotFoundError(f"Classes mapping not found at {classes_path}.")
    if not audio_path.exists():
        raise FileNotFoundError(f"Audio file not found at {audio_path}.")
        
    with open(classes_path, 'r') as f:
        classes = json.load(f)
        
    # Preprocess audio and extract Mel-Spectrogram
    t0_prep = time.perf_counter()
    audio = preprocess_audio(audio_path, target_sr=16000, duration=1.0)
    mel_spec = extract_mel_spectrogram(audio, rate=16000)
    input_data = np.expand_dims(mel_spec, axis=0).astype(np.float32)
    prep_time_ms = (time.perf_counter() - t0_prep) * 1000
    
    # Initialize TFLite Interpreter
    interpreter = tf.lite.Interpreter(model_path=str(model_path))
    interpreter.allocate_tensors()
    
    input_details = interpreter.get_input_details()
    output_details = interpreter.get_output_details()
    
    # Set input tensor
    interpreter.set_tensor(input_details[0]['index'], input_data)
    
    # Run inference & measure execution latency
    t0_infer = time.perf_counter()
    interpreter.invoke()
    infer_time_ms = (time.perf_counter() - t0_infer) * 1000
    
    # Retrieve predictions
    preds = interpreter.get_tensor(output_details[0]['index'])[0]
    top_idx = int(np.argmax(preds))
    predicted_label = classes[top_idx]
    confidence = float(preds[top_idx])
    
    print("\n" + "="*50)
    print("           TFLITE INFERENCE RESULT")
    print("="*50)
    print(f"Model File       : {model_path.name}")
    print(f"Audio File       : {audio_path.name}")
    print(f"Predicted Class  : {predicted_label} ({confidence * 100:.2f}%)")
    print(f"Inference Latency: {infer_time_ms:.2f} ms")
    print(f"Audio Prep Time  : {prep_time_ms:.2f} ms")
    print("-"*50)
    print("Class Probabilities:")
    for cls_name, prob in zip(classes, preds):
        bar = "#" * int(prob * 20)
        marker = " <--" if cls_name == predicted_label else ""
        print(f"  {cls_name:<11}: {prob * 100:6.2f}% | {bar:<20} {marker}")
    print("="*50 + "\n")
    
    return {
        'file': str(audio_path),
        'model': model_path.name,
        'predicted_label': predicted_label,
        'confidence': confidence,
        'latency_ms': infer_time_ms,
        'probabilities': {cls_name: float(p) for cls_name, p in zip(classes, preds)}
    }

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description="Test TFLite model on audio file")
    parser.add_argument('--audio', type=str, help='Path to audio file (.wav)')
    parser.add_argument('--fp32', action='store_true', help='Use Float32 TFLite model instead of Quantized')
    args = parser.parse_args()
    
    selected_model = (tflite_dir / 'audio_cnn_fp32.tflite') if args.fp32 else (tflite_dir / 'audio_cnn_quantized.tflite')
    
    if args.audio:
        predict_with_tflite(args.audio, model_path=selected_model)
    else:
        sample_path = project_root / 'Datasets' / 'Gunshots' / 'AK-47' / '1 (1).wav'
        if sample_path.exists():
            print(f"No audio file specified. Testing on default sample: {sample_path}")
            predict_with_tflite(sample_path, model_path=selected_model)
        else:
            print("Please specify an audio file using --audio <path_to_wav>")
