"""Run the repository's existing TFLite predictor on a WAV, independently of VR3."""
import argparse
from pathlib import Path
import sys


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("audio", type=Path, help="Path to a WAV recording")
    args = parser.parse_args()
    if not args.audio.is_file():
        parser.error(f"Audio file not found: {args.audio}")
    cnn = Path(__file__).resolve().parents[1] / "Audio-CNN" / "Audio CNN"
    predictor = cnn / "TFLite" / "predict_tflite.py"
    if not predictor.is_file():
        parser.error(f"Existing predictor not found: {predictor}")
    sys.path.insert(0, str(predictor.parent))
    try:
        from predict_tflite import predict_with_tflite
    except ModuleNotFoundError as error:
        parser.exit(1, f"Missing dependency: {error.name}. Use your Audio-CNN Python environment.\n")
    predict_with_tflite(args.audio.resolve(), model_path=cnn / "TFLite" / "audio_cnn_fp32.tflite")


if __name__ == "__main__":
    main()
