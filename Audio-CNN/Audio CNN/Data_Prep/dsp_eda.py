"""
dsp_eda.py
Exploratory Data Analysis and DSP Visualization following Seth Adams' Part 1 & 2 tutorials.
Plots raw waveforms, signal envelopes, FFT magnitude spectra, and Mel-Spectrograms
for representative sounds across each class (Gunshot, Scream, Non-Scream).
Saves plot into Results/dsp_exploration.png.
"""

import sys
import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
import tensorflow as tf
from pathlib import Path
from scipy.signal import resample

data_prep_dir = Path(__file__).resolve().parent
audio_cnn_dir = data_prep_dir.parent
train_dir = audio_cnn_dir / 'Train'
results_dir = audio_cnn_dir / 'Results'

if str(train_dir) not in sys.path:
    sys.path.insert(0, str(train_dir))

from clean import read_audio_file, envelope

def compute_fft(signal, rate):
    n = len(signal)
    freq = np.fft.rfftfreq(n, d=1.0/rate)
    mag = np.abs(np.fft.rfft(signal)) / n
    return freq, mag

def compute_mel_spectrogram(signal, rate=16000, n_mels=128):
    signal_tensor = tf.convert_to_tensor(signal, dtype=tf.float32)
    stfts = tf.signal.stft(signal_tensor, frame_length=512, frame_step=160, fft_length=512)
    spectrograms = tf.abs(stfts)
    num_spectrogram_bins = stfts.shape[-1]
    mel_weight_matrix = tf.signal.linear_to_mel_weight_matrix(
        num_mel_bins=n_mels,
        num_spectrogram_bins=num_spectrogram_bins,
        sample_rate=rate,
        lower_edge_hertz=20.0,
        upper_edge_hertz=8000.0
    )
    mel_spec = tf.tensordot(spectrograms, mel_weight_matrix, 1)
    log_mel = tf.math.log(mel_spec + 1e-6).numpy()
    return log_mel

def run_dsp_eda():
    index_csv = data_prep_dir / 'dataset_index.csv'
    if not index_csv.exists():
        index_csv = audio_cnn_dir / 'dataset_index.csv'
    if not index_csv.exists():
        print(f"Error: {index_csv} not found.")
        return
        
    df = pd.read_csv(index_csv)
    classes = ['Gunshot', 'Scream', 'Non-Scream']
    
    fig, axes = plt.subplots(nrows=len(classes), ncols=4, figsize=(18, 9))
    fig.suptitle("DSP Exploratory Analysis - Audio Waveforms, Envelopes, FFT, & Mel Spectrograms", fontsize=16, y=0.98)
    
    target_sr = 16000
    
    for row_idx, cls in enumerate(classes):
        cls_df = df[df['label'] == cls]
        if cls_df.empty:
            continue
        sample_row = cls_df.iloc[0]
        audio_path = sample_row['absolute_path']
        
        audio, sr = read_audio_file(audio_path)
        if sr != target_sr and len(audio) > 0:
            audio = resample(audio, int(len(audio) * target_sr / sr)).astype(np.float32)
            sr = target_sr
            
        time_axis = np.linspace(0, len(audio) / sr, len(audio))
        mask, env = envelope(audio, sr, threshold=0.005)
        freq, mag = compute_fft(audio, sr)
        
        chunk_len = min(len(audio), sr * 2)
        mel_spec = compute_mel_spectrogram(audio[:chunk_len], rate=sr)
        
        # Plot 1: Waveform
        axes[row_idx, 0].plot(time_axis, audio, color='#2c3e50', alpha=0.8, linewidth=0.8)
        axes[row_idx, 0].set_title(f"{cls} - Time Domain", fontsize=11, fontweight='bold')
        axes[row_idx, 0].set_xlabel("Time (s)")
        axes[row_idx, 0].set_ylabel("Amplitude")
        axes[row_idx, 0].grid(True, alpha=0.3)
        
        # Plot 2: Envelope
        axes[row_idx, 1].plot(time_axis, audio, color='#bdc3c7', alpha=0.5, label='Signal')
        axes[row_idx, 1].plot(time_axis, env, color='#e74c3c', linewidth=1.2, label='Envelope')
        axes[row_idx, 1].axhline(0.005, color='black', linestyle='--', alpha=0.6, label='Threshold')
        axes[row_idx, 1].set_title(f"{cls} - Signal Envelope", fontsize=11, fontweight='bold')
        axes[row_idx, 1].set_xlabel("Time (s)")
        axes[row_idx, 1].legend(loc='upper right', fontsize=8)
        axes[row_idx, 1].grid(True, alpha=0.3)
        
        # Plot 3: FFT
        axes[row_idx, 2].plot(freq, mag, color='#2980b9', linewidth=1.0)
        axes[row_idx, 2].set_title(f"{cls} - FFT Spectrum", fontsize=11, fontweight='bold')
        axes[row_idx, 2].set_xlabel("Frequency (Hz)")
        axes[row_idx, 2].set_ylabel("Magnitude")
        axes[row_idx, 2].set_xlim(0, 8000)
        axes[row_idx, 2].grid(True, alpha=0.3)
        
        # Plot 4: Mel Spectrogram
        im = axes[row_idx, 3].imshow(mel_spec.T, aspect='auto', origin='lower', cmap='magma')
        axes[row_idx, 3].set_title(f"{cls} - Mel Spectrogram (2D)", fontsize=11, fontweight='bold')
        axes[row_idx, 3].set_xlabel("Time Frame")
        axes[row_idx, 3].set_ylabel("Mel Bin")
        fig.colorbar(im, ax=axes[row_idx, 3], fraction=0.046, pad=0.04)

    plt.tight_layout()
    results_dir.mkdir(parents=True, exist_ok=True)
    output_img = results_dir / 'dsp_exploration.png'
    plt.savefig(output_img, dpi=150)
    plt.close()
    print(f"DSP exploratory analysis saved to: {output_img}")

if __name__ == '__main__':
    run_dsp_eda()
