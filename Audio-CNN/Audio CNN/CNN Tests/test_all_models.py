"""
test_all_models.py
Master unified test suite for Audio CNN.
Compares Best Model (.keras), TFLite (.tflite), and TinyML (Full INT8 .tflite).
Supports both:
  - Voice input from Microphone (live recording)
  - Audio files from "Audio CNN/Audio Input/" folder
"""

import sys
import argparse
import os
from pathlib import Path

# Add current directory to path
TESTS_DIR = Path(__file__).resolve().parent
if str(TESTS_DIR) not in sys.path:
    sys.path.insert(0, str(TESTS_DIR))

from model_runners import (
    UnifiedModelTester,
    format_results_table,
    record_from_microphone,
    audio_to_input_tensor,
    AUDIO_INPUT_DIR,
    BEST_KERAS_PATH,
    TFLITE_QUANT_PATH,
    TFLITE_FP32_PATH,
    TINYML_INT8_PATH,
    SOUNDDEVICE_AVAILABLE
)
from test_audio_input import get_audio_input_files, test_single_file, test_all_files_batch


def show_model_summary(tester: UnifiedModelTester):
    """Displays side-by-side architecture, storage, and quantization specs."""
    print("\n" + "=" * 75)
    print("                AUDIO CNN MODEL SUITE SUMMARY")
    print("=" * 75)

    models_info = [
        {
            "name": "Best Keras Model",
            "path": BEST_KERAS_PATH,
            "format": "Keras SavedModel (Float32)",
            "target": "Desktop / Cloud Server GPU/CPU",
            "desc": "Full-precision weights, reference baseline accuracy"
        },
        {
            "name": "TFLite Dynamic INT8",
            "path": TFLITE_QUANT_PATH,
            "format": "TensorFlow Lite (.tflite)",
            "target": "Mobile (Android/iOS) / Raspberry Pi",
            "desc": "Post-training 8-bit dynamic range quantization"
        },
        {
            "name": "TinyML Full INT8",
            "path": TINYML_INT8_PATH,
            "format": "TFLite Micro (.tflite & .h)",
            "target": "Microcontrollers (Arduino, ESP32, STM32)",
            "desc": "Full integer quantization (int8 in/out) for edge devices"
        }
    ]

    for info in models_info:
        p = info["path"]
        exists = p.exists()
        size_str = f"{os.path.getsize(p)/(1024**2):.2f} MB" if exists else "NOT FOUND"
        status = "[READY]" if exists else "[MISSING]"

        print(f"[{status}] {info['name']}")
        print(f"      File        : {p.name} ({size_str})")
        print(f"      Format      : {info['format']}")
        print(f"      Target Env  : {info['target']}")
        print(f"      Description : {info['desc']}\n")

    print(f"Classes Target Mapping : {tester.classes}")
    print(f"Audio Input Directory  : {AUDIO_INPUT_DIR}")
    print("=" * 75 + "\n")


def interactive_menu():
    """Terminal menu for intuitive interactive testing."""
    tester = UnifiedModelTester()

    while True:
        print("\n" + "=" * 65)
        print("          AUDIO CNN - MULTI-MODEL TEST BENCHMARK")
        print("=" * 65)
        print("  [1] Test Voice Input from Microphone (Live Record & Classify)")
        print("  [2] Test an Audio File from 'Audio Input' Folder")
        print("  [3] Test ALL Audio Files in 'Audio Input' Folder (Batch Mode)")
        print("  [4] Model Architectures & Size Summary")
        print("  [5] Exit")
        print("=" * 65)

        choice = input("Enter choice [1-5]: ").strip()

        if choice == "1":
            if not SOUNDDEVICE_AVAILABLE:
                print("\n[!] 'sounddevice' library is required for microphone input.")
                print("    Run: pip install sounddevice\n")
                continue
            dur_str = input("Recording duration in seconds [default: 2.0]: ").strip()
            duration = float(dur_str) if dur_str else 2.0
            
            tester.load_all_models()
            audio_data, saved_path = record_from_microphone(
                duration=duration,
                sample_rate=16000,
                save_to_folder=AUDIO_INPUT_DIR,
                countdown=True
            )
            print(f"--> Saved recording to: {saved_path.name}")
            results = tester.predict_all(audio_data)
            results["source"] = f"Microphone Input ({saved_path.name})"
            print(format_results_table(results, tester.classes))

        elif choice == "2":
            files = get_audio_input_files()
            if not files:
                print(f"\n[!] No audio files found in '{AUDIO_INPUT_DIR}'.")
                print("    Add .wav files to this folder or record from microphone first!\n")
                continue
            print(f"\nFiles in '{AUDIO_INPUT_DIR}':")
            for idx, f in enumerate(files, start=1):
                print(f"  [{idx}] {f.name}")
            f_choice = input(f"Select file [1-{len(files)}]: ").strip()
            if f_choice.isdigit() and 1 <= int(f_choice) <= len(files):
                selected = files[int(f_choice) - 1]
                tester.load_all_models()
                test_single_file(selected, tester, model_choice="all")
            else:
                print("[!] Invalid selection.")

        elif choice == "3":
            files = get_audio_input_files()
            if not files:
                print(f"\n[!] No audio files found in '{AUDIO_INPUT_DIR}'.")
                continue
            tester.load_all_models()
            test_all_files_batch(files, tester)

        elif choice == "4":
            show_model_summary(tester)

        elif choice == "5" or choice.lower() == "q":
            print("\nExiting Audio CNN Test Suite. Goodbye!")
            break
        else:
            print("[!] Invalid option. Please select 1, 2, 3, 4, or 5.")


def main():
    parser = argparse.ArgumentParser(
        description="Master Test Suite: Benchmark Best Model, TFLite, and TinyML on Mic Voice or Audio Input Folder."
    )
    parser.add_argument(
        "--source", type=str, choices=["mic", "folder"], default=None,
        help="Input source: 'mic' (microphone) or 'folder' (Audio Input folder)"
    )
    parser.add_argument(
        "--file", type=str, default=None,
        help="Specific audio file to test"
    )
    parser.add_argument(
        "--duration", type=float, default=2.0,
        help="Microphone recording duration in seconds (default: 2.0)"
    )
    parser.add_argument(
        "--model", type=str, choices=["all", "best", "tflite", "tinyml"], default="all",
        help="Model to test: 'all' (default), 'best', 'tflite', or 'tinyml'"
    )
    parser.add_argument(
        "--summary", action="store_true",
        help="Show model sizes, architectures, and deployment target specs"
    )

    args = parser.parse_args()

    tester = UnifiedModelTester()

    if args.summary:
        show_model_summary(tester)
        return

    if args.file:
        test_single_file(Path(args.file), tester, model_choice=args.model)
    elif args.source == "mic":
        tester.load_all_models()
        audio_data, saved_path = record_from_microphone(
            duration=args.duration,
            sample_rate=16000,
            save_to_folder=AUDIO_INPUT_DIR,
            countdown=True
        )
        print(f"--> Saved recording to: {saved_path.name}")
        results = tester.predict_all(audio_data)
        results["source"] = f"Microphone Input ({saved_path.name})"
        print(format_results_table(results, tester.classes))
    elif args.source == "folder":
        files = get_audio_input_files()
        if not files:
            print(f"[!] No audio files found in '{AUDIO_INPUT_DIR}'")
            return
        tester.load_all_models()
        test_all_files_batch(files, tester)
    else:
        # Launch interactive menu by default
        interactive_menu()


if __name__ == "__main__":
    main()
