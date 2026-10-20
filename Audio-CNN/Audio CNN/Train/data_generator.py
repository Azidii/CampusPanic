"""
data_generator.py
Keras DataGenerator for batch loading, audio preprocessing, and Mel-Spectrogram extraction.
"""

import os
import sys
from pathlib import Path
import numpy as np
import tensorflow as tf
from tensorflow.keras.utils import Sequence, to_categorical

train_dir = Path(__file__).resolve().parent
if str(train_dir) not in sys.path:
    sys.path.insert(0, str(train_dir))

from clean import preprocess_audio

def extract_mel_spectrogram(audio_signal, rate=16000, n_mels=128):
    signal_tensor = tf.convert_to_tensor(audio_signal, dtype=tf.float32)
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
    log_mel = tf.math.log(mel_spec + 1e-6)
    log_mel = tf.expand_dims(log_mel, axis=-1)
    return log_mel.numpy()

class AudioDataGenerator(Sequence):
    def __init__(self, file_paths, labels, num_classes=3, batch_size=32,
                 sr=16000, duration=1.0, shuffle=True):
        self.file_paths = np.array(file_paths)
        self.labels = np.array(labels)
        self.num_classes = num_classes
        self.batch_size = batch_size
        self.sr = sr
        self.duration = duration
        self.shuffle = shuffle
        self.indexes = np.arange(len(self.file_paths))
        self.on_epoch_end()
        
    def __len__(self):
        return int(np.floor(len(self.file_paths) / self.batch_size))
        
    def __getitem__(self, index):
        batch_indexes = self.indexes[index * self.batch_size:(index + 1) * self.batch_size]
        batch_paths = self.file_paths[batch_indexes]
        batch_labels = self.labels[batch_indexes]
        
        X_batch = []
        for path in batch_paths:
            audio = preprocess_audio(path, target_sr=self.sr, duration=self.duration)
            spec = extract_mel_spectrogram(audio, rate=self.sr)
            X_batch.append(spec)
            
        X = np.array(X_batch, dtype=np.float32)
        y = to_categorical(batch_labels, num_classes=self.num_classes)
        return X, y
        
    def on_epoch_end(self):
        if self.shuffle:
            np.random.shuffle(self.indexes)
