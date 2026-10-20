"""
models.py
Convolutional Neural Network (CNN) architectures for Audio Classification.
"""

import tensorflow as tf
from tensorflow.keras.models import Sequential
from tensorflow.keras.layers import (
    Conv2D,
    MaxPooling2D,
    BatchNormalization,
    Dropout,
    Flatten,
    Dense,
    Input,
    Conv1D,
    GlobalMaxPooling1D
)

def get_conv2d_model(input_shape=(97, 128, 1), num_classes=3):
    model = Sequential([
        Input(shape=input_shape),
        
        # Block 1
        Conv2D(16, kernel_size=(3, 3), activation='relu', padding='same', name='conv2d_1'),
        BatchNormalization(name='bn_1'),
        Conv2D(32, kernel_size=(3, 3), activation='relu', padding='same', name='conv2d_2'),
        BatchNormalization(name='bn_2'),
        MaxPooling2D(pool_size=(2, 2), name='maxpool_1'),
        Dropout(0.25, name='dropout_1'),
        
        # Block 2
        Conv2D(64, kernel_size=(3, 3), activation='relu', padding='same', name='conv2d_3'),
        BatchNormalization(name='bn_3'),
        Conv2D(128, kernel_size=(3, 3), activation='relu', padding='same', name='conv2d_4'),
        BatchNormalization(name='bn_4'),
        MaxPooling2D(pool_size=(2, 2), name='maxpool_2'),
        Dropout(0.25, name='dropout_2'),
        
        # Classification Head
        Flatten(name='flatten'),
        Dense(128, activation='relu', name='dense_1'),
        BatchNormalization(name='bn_dense'),
        Dropout(0.5, name='dropout_dense'),
        Dense(64, activation='relu', name='dense_2'),
        Dense(num_classes, activation='softmax', name='output_softmax')
    ], name='Audio_Conv2D_Classifier')
    
    model.compile(
        optimizer=tf.keras.optimizers.Adam(learning_rate=0.001),
        loss='categorical_crossentropy',
        metrics=['accuracy']
    )
    return model

def get_conv1d_model(input_shape=(16000, 1), num_classes=3):
    model = Sequential([
        Input(shape=input_shape),
        Conv1D(16, kernel_size=64, strides=16, activation='relu', padding='same'),
        BatchNormalization(),
        Conv1D(32, kernel_size=32, strides=8, activation='relu', padding='same'),
        BatchNormalization(),
        Conv1D(64, kernel_size=16, strides=4, activation='relu', padding='same'),
        BatchNormalization(),
        Conv1D(128, kernel_size=8, strides=2, activation='relu', padding='same'),
        BatchNormalization(),
        GlobalMaxPooling1D(),
        Dense(128, activation='relu'),
        Dropout(0.5),
        Dense(num_classes, activation='softmax')
    ], name='Audio_Conv1D_Classifier')
    
    model.compile(
        optimizer=tf.keras.optimizers.Adam(learning_rate=0.001),
        loss='categorical_crossentropy',
        metrics=['accuracy']
    )
    return model
