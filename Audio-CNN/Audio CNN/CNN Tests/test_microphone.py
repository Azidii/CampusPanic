"""
test_microphone.py
Tests Audio CNN models (Best Keras, TFLite, TinyML) from live microphone voice input.
Every recording is automatically saved into "Audio CNN/Audio Input/" for tracking.
"""

import sys
import argparse
import time
from pathlib import Path

# Add current directory to path
TESTS_DIR = Path(__file__).resolve().parent
if str(TESTS_DIR) not in sys.path:
    sys.path.insert(0, str(TESTS_DIR))

from model_runners import (
    UnifiedModelTester,
    record_from_microphone,
    audio_to_input_tensor,
    format_results_table,
    AUDIO_INPUT_DIR,
    SOUNDDEVICE_AVAILABLE
)


def run_microphone_test(duration: float = 2.0, model_choice: str = "all",
                        save_name: str = None, clean_silence: bool = True):
    if not SOUNDDEVICE_AVAILABLE:
        print("\n[!] Error: 'sounddevice' package is not installed.")
        print("    Install it via: pip install sounddevice\n")
        return

    tester = UnifiedModelTester()

    # Pre-warm models so recording latency isn't skewed by model initialization
    print("\nInitializing and loading models...")
    if model_choice in ["all", "best"]:
        tester.load_keras()
    if model_choice in ["all", "tflite"]:
        tester.load_tflite()
    if model_choice in ["all", "tinyml"]:
        tester.load_tinyml()
    print("Models ready!\n")

    # Record from microphone
    audio_data, saved_path = record_from_microphone(
        duration=duration,
        sample_rate=16000,
        save_to_folder=AUDIO_INPUT_DIR,
        filename=save_name,
        countdown=True
    )

    print(f"--> Saved audio to: {saved_path.relative_to(TESTS_DIR.parent)}")

    # Preprocess
    _, input_tensor = audio_to_input_tensor(audio_data, clean_silence=clean_silence)

    if model_choice == "all":
        results = tester.predict_all(audio_data, clean_silence=clean_silence)
        results["source"] = f"Microphone Live Recording ({saved_path.name})"
        table_output = format_results_table(results, tester.classes)
        print(table_output)

    elif model_choice == "best":
        res = tester.predict_keras(input_tensor)
        _print_single_result("Best Model (Keras)", saved_path.name, res, tester.classes)

    elif model_choice == "tflite":
        res = tester.predict_tflite(input_tensor)
        _print_single_result("TFLite Model", saved_path.name, res, tester.classes)

    elif model_choice == "tinyml":
        res = tester.predict_tinyml(input_tensor)
        _print_single_result("TinyML (Full INT8)", saved_path.name, res, tester.classes)


def _print_single_result(model_name: str, file_name: str, res: dict, classes: list):
    print("\n" + "=" * 55)
    print(f"        {model_name.upper()} INFERENCE")
    print("=" * 55)
    print(f"Audio Source : {file_name}")
    print(f"Model File   : {res['model_file']} ({res['size_mb']:.1f} MB)")
    print(f"Prediction   : {res['predicted_label']} ({res['confidence'] * 100:.2f}%)")
    print(f"Latency      : {res['latency_ms']:.2f} ms")
    print("-" * 55)
    print("Class Probabilities:")
    for cls_name in classes:
        prob = res["probabilities"].get(cls_name, 0.0)
        bar_len = int(prob * 20)
        bar = "#" * bar_len + "-" * (20 - bar_len)
        marker = " <--" if cls_name == res["predicted_label"] else ""
        print(f"  {cls_name:<11}: {prob * 100:6.2f}% | [{bar}]{marker}")
    print("=" * 55 + "\n")


def main():
    parser = argparse.ArgumentParser(
        description="Test Best Model, TFLite, and TinyML with Microphone Voice Input."
    )
    parser.add_argument(
        "--duration", type=float, default=2.0,
        help="Recording duration in seconds (default: 2.0)"
    )
    parser.add_argument(
        "--model", type=str, choices=["all", "best", "tflite", "tinyml"], default="all",
        help="Model to test: 'all' (default), 'best', 'tflite', or 'tinyml'"
    )
    parser.add_argument(
        "--save_name", type=str, default=None,
        help="Optional custom filename for the saved recording in Audio Input/"
    )
    parser.add_argument(
        "--loop", action="store_true",
        help="Run continuously in a loop for repeated voice testing"
    )
    parser.add_argument(
        "--no-silence-clean", action="store_true",
        help="Disable automatic DSP silence removal"
    )

    args = parser.parse_args()

    clean_silence = not args.no_silence_clean

    if args.loop:
        print("\nStarting Continuous Voice Testing Loop (Press Ctrl+C or type 'q' to stop)...")
        while True:
            try:
                run_microphone_test(
                    duration=args.duration,
                    model_choice=args.model,
                    save_name=args.save_name,
                    clean_silence=clean_silence
                )
                user_input = input("Press [Enter] to record again, or type 'q' to quit: ").strip().lower()
                if user_input == 'q':
                    print("Exiting voice testing loop. Goodbye!")
                    break
            except KeyboardInterrupt:
                print("\nVoice testing loop stopped by user.")
                break
    else:
        run_microphone_test(
            duration=args.duration,
            model_choice=args.model,
            save_name=args.save_name,
            clean_silence=clean_silence
        )


if __name__ == "__main__":
    main()
