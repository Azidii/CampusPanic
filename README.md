# CampusPanic

**CampusPanic** is an integrated IoT audio detection and emergency alert platform designed for campus safety. It combines on-device acoustic machine learning models for gunshot and scream detection with a real-time web monitoring and response dispatch system.

---

## Repository Structure

```
CampusPanic/
├── Audio-CNN/             # Audio classification CNN models and training pipelines
│   ├── Audio CNN/         # Audio data processing, training scripts, test suites
│   │   ├── Audio Input/   # Reference audio sample clips (.wav)
│   │   ├── CNN Tests/     # Evaluation and real-time mic inference scripts
│   │   ├── Data_Prep/     # Audio preprocessing & dataset preparation
│   │   ├── Models/        # Keras trained models & feature caches (Git LFS)
│   │   ├── Results/       # Training curves, confusion matrices, logs
│   │   ├── TFLite/        # Quantized FP32 & INT8 TFLite models
│   │   ├── TinyML/        # Embedded C headers and micro-controller exports
│   │   └── Train/         # Model architectures and training routines
│   └── README.md
│
└── DSP-Website/           # Full-stack monitoring and incident alert platform
    ├── client/            # Vite + React frontend dashboard
    ├── server/            # Node.js + Express + MongoDB alert ingestion backend
    ├── INGEST_SPEC.md     # Gateway ingestion API specification
    └── README.md
```

---

## Subprojects Overview

### 1. [Audio-CNN](./Audio-CNN)
- **Deep Learning Acoustic Classification**: Convolutional Neural Network trained to classify acoustic events (Gunshots, Screams, and Ambient/Non-emergency background noise).
- **Edge Deployment**: Models exported to TFLite and TinyML C header arrays (`audio_cnn_model.h`) for deployment onto edge microcontrollers (such as ESP32).
- **Git LFS**: Large model weights (`.keras`) and feature caches (`.npz`) are tracked using Git Large File Storage (LFS).

### 2. [DSP-Website](./DSP-Website)
- **Client**: Modern responsive React dashboard for security personnel, providing real-time alert notifications, device telemetry, campus map visualizations, and incident status workflows.
- **Server**: Express.js REST and WebSocket/SSE backend for securely ingesting alerts from IoT audio edge gateways, persisting incident logs, and streaming live updates.

---

## Getting Started

### Prerequisites
- [Git](https://git-scm.com/) with [Git LFS](https://git-lfs.github.com/) installed
- [Node.js](https://nodejs.org/) (v18+) and npm
- [Python](https://www.python.org/) 3.10+ (for Audio-CNN pipeline)

### Setup

1. **Clone the repository with LFS**:
   ```bash
   git clone https://github.com/Azidii/CampusPanic.git
   cd CampusPanic
   git lfs pull
   ```

2. **Web Application Setup**:
   ```bash
   # Server setup
   cd DSP-Website/server
   cp .env.example .env
   npm install
   npm run dev

   # Client setup (in a new terminal)
   cd DSP-Website/client
   npm install
   npm run dev
   ```

3. **Audio-CNN Setup**:
   ```bash
   cd Audio-CNN
   # Follow instructions in Audio-CNN/README.md for Python environment setup
   ```
