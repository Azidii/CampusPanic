"""
convert_to_tflite.py
Converts the trained Keras CNN model (best_cnn_model.keras) into TensorFlow Lite (.tflite) format.
Generates:
1. audio_cnn_fp32.tflite (Full precision Float32)
2. audio_cnn_quantized.tflite (Dynamic range INT8 quantized for embedded/edge deployment)
"""

import os
from pathlib import Path
import tensorflow as tf

def convert_model():
    tflite_dir = Path(__file__).resolve().parent
    audio_cnn_dir = tflite_dir.parent
    models_dir = audio_cnn_dir / 'Models'
    
    keras_model_path = models_dir / 'best_cnn_model.keras'
    if not keras_model_path.exists():
        raise FileNotFoundError(f"Trained model not found at '{keras_model_path}'.")
        
    print(f"Loading Keras model from: {keras_model_path}")
    model = tf.keras.models.load_model(str(keras_model_path))
    keras_size_mb = os.path.getsize(keras_model_path) / (1024 * 1024)
    print(f"Keras model file size: {keras_size_mb:.2f} MB")
    
    # 1. Convert to Standard Float32 TFLite
    print("\nConverting to Float32 TFLite model...")
    converter = tf.lite.TFLiteConverter.from_keras_model(model)
    tflite_fp32_model = converter.convert()
    
    fp32_path = tflite_dir / 'audio_cnn_fp32.tflite'
    with open(fp32_path, 'wb') as f:
        f.write(tflite_fp32_model)
    fp32_size_mb = os.path.getsize(fp32_path) / (1024 * 1024)
    print(f"Saved: {fp32_path.name} ({fp32_size_mb:.2f} MB)")
    
    # 2. Convert to Dynamic Range INT8 Quantized TFLite
    print("\nConverting to INT8 Quantized TFLite model...")
    converter_quant = tf.lite.TFLiteConverter.from_keras_model(model)
    converter_quant.optimizations = [tf.lite.Optimize.DEFAULT]
    tflite_quant_model = converter_quant.convert()
    
    quant_path = tflite_dir / 'audio_cnn_quantized.tflite'
    with open(quant_path, 'wb') as f:
        f.write(tflite_quant_model)
    quant_size_mb = os.path.getsize(quant_path) / (1024 * 1024)
    print(f"Saved: {quant_path.name} ({quant_size_mb:.2f} MB)")
    
    # Summary
    print("\n" + "="*50)
    print("           TFLITE CONVERSION SUMMARY")
    print("="*50)
    print(f"Original Keras Model   : {keras_size_mb:6.2f} MB")
    print(f"Float32 TFLite Model   : {fp32_size_mb:6.2f} MB")
    print(f"INT8 Quantized TFLite  : {quant_size_mb:6.2f} MB (Compression: {(1 - quant_size_mb/keras_size_mb)*100:.1f}%)")
    print("="*50)

if __name__ == '__main__':
    convert_model()
