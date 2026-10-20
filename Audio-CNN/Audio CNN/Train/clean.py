"""
clean.py
Audio preprocessing and cleaning using Seth Adams' signal envelope approach.
Removes dead silence/background noise and standardizes audio to 16 kHz mono.
"""

import os
import wave
import numpy as np
import pandas as pd
from pathlib import Path
from scipy.signal import resample

def envelope(y, rate, threshold=0.005):
    """
    Computes signal envelope using a rolling maximum filter
    to identify active acoustic regions and eliminate silence.
    """
    s = pd.Series(np.abs(y))
    window_size = max(int(rate / 20), 1)  # 50ms window
    y_env = s.rolling(window=window_size, min_periods=1, center=True).max().to_numpy()
    mask = y_env > threshold
    return mask, y_env

def read_audio_file(file_path):
    """
    Reads WAV file into float32 numpy array normalized to [-1.0, 1.0].
    Converts multi-channel audio to mono.
    """
    with wave.open(str(file_path), 'rb') as wf:
        sr = wf.getframerate()
        n_ch = wf.getnchannels()
        sampwidth = wf.getsampwidth()
        frames = wf.readframes(wf.getnframes())
        
        # 16-bit PCM
        if sampwidth == 2:
            data = np.frombuffer(frames, dtype=np.int16).astype(np.float32) / 32768.0
        # 32-bit PCM
        elif sampwidth == 4:
            data = np.frombuffer(frames, dtype=np.int32).astype(np.float32) / 2147483648.0
        # 8-bit unsigned
        elif sampwidth == 1:
            data = (np.frombuffer(frames, dtype=np.uint8).astype(np.float32) - 128.0) / 128.0
        else:
            data = np.frombuffer(frames, dtype=np.int16).astype(np.float32) / 32768.0
            
        if n_ch > 1:
            data = data.reshape(-1, n_ch).mean(axis=1)
            
    return data, sr

def preprocess_audio(file_path, target_sr=16000, duration=1.0, clean_silence=True, threshold=0.005):
    """
    Full preprocessing pipeline:
    1. Read and convert to mono.
    2. Resample to target_sr (16 kHz).
    3. (Optional) Filter dead silence using signal envelope.
    4. Truncate or pad to exact fixed length (duration * target_sr).
    """
    audio, sr = read_audio_file(file_path)
    
    # Resample to 16 kHz if necessary
    if sr != target_sr and len(audio) > 0:
        target_len = int(len(audio) * target_sr / sr)
        if target_len > 0:
            audio = resample(audio, target_len).astype(np.float32)
        sr = target_sr
        
    # Silence trimming with envelope
    if clean_silence and len(audio) > 0:
        mask, _ = envelope(audio, target_sr, threshold=threshold)
        active_audio = audio[mask]
        if len(active_audio) >= int(target_sr * 0.1):
            audio = active_audio

    # Fix duration
    required_samples = int(target_sr * duration)
    if len(audio) > required_samples:
        audio = audio[:required_samples]
    elif len(audio) < required_samples:
        pad_width = required_samples - len(audio)
        audio = np.pad(audio, (0, pad_width), mode='constant')
        
    return audio
