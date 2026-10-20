"""
test_audio_input.py
Tests Audio CNN models (Best Keras, TFLite, TinyML) on audio files located in
the separate "Audio CNN/Audio Input/" folder.
Supports single-file testing and batch testing across all files.
"""

import sys
import argparse
import time
from pathlib import Path
import numpy as np
import pandas as pd

# Add current directory to path
TESTS_DIR = Path(__file__).resolve().parent
if str(TESTS_DIR) not in sys.path:
    sys.path.insert(0, str(TESTS_DIR))

from model_runners import (
    UnifiedModelTester,
    audio_to_input_tensor,
    format_results_table,
    AUDIO_INPUT_DIR,
    RESULTS_DIR
)


def get_audio_input_files():
    """Returns deduplicated list of valid audio files in Audio Input directory."""
    if not AUDIO_INPUT_DIR.exists():
        AUDIO_INPUT_DIR.mkdir(parents=True, exist_ok=True)
        return []

    # Supported audio extensions (deduplicated for case-insensitive filesystems like Windows)
    files = {f for f in AUDIO_INPUT_DIR.iterdir() if f.suffix.lower() == ".wav"}
    return sorted(list(files))


def test_single_file(file_path: Path, tester: UnifiedModelTester, model_choice: str = "all", clean_silence: bool = True):
    """Evaluates a single audio file on the selected model(s)."""
    file_path = Path(file_path)
    if not file_path.exists():
        # Check if user passed just filename located in AUDIO_INPUT_DIR
        alt_path = AUDIO_INPUT_DIR / file_path.name
        if alt_path.exists():
            file_path = alt_path
        else:
            print(f"[!] Error: File '{file_path}' does not exist.")
            return None

    if model_choice == "all":
        results = tester.predict_all(file_path, clean_silence=clean_silence)
        table_output = format_results_table(results, tester.classes)
        print(table_output)
        return results
    else:
        _, input_tensor = audio_to_input_tensor(file_path, clean_silence=clean_silence)
        if model_choice == "best":
            res = tester.predict_keras(input_tensor)
            _print_single_result("Best Model (Keras)", file_path.name, res, tester.classes)
        elif model_choice == "tflite":
            res = tester.predict_tflite(input_tensor)
            _print_single_result("TFLite Model", file_path.name, res, tester.classes)
        elif model_choice == "tinyml":
            res = tester.predict_tinyml(input_tensor)
            _print_single_result("TinyML (Full INT8)", file_path.name, res, tester.classes)
        return res


def test_all_files_batch(files: list[Path], tester: UnifiedModelTester, export_csv: bool = False, clean_silence: bool = True):
    """Evaluates all audio files in Audio Input/ and summarizes results."""
    print("\n" + "=" * 80)
    print(f"      BATCH INFERENCE TEST: {len(files)} FILES IN 'Audio Input/'")
    print("=" * 80)

    rows = []
    latencies = {"keras": [], "tflite": [], "tinyml": []}
    agreement_count = 0

    col_w = [28, 14, 10, 14, 10, 14, 10, 8]
    header = (
        f"{'Audio File':<{col_w[0]}} | "
        f"{'Keras':<{col_w[1]}} {'(Conf)':<{col_w[2]}} | "
        f"{'TFLite':<{col_w[3]}} {'(Conf)':<{col_w[4]}} | "
        f"{'TinyML':<{col_w[5]}} {'(Conf)':<{col_w[6]}} | "
        f"{'Agree?':<{col_w[7]}}"
    )
    print(header)
    print("-" * len(header))

    for f in files:
        res = tester.predict_all(f, clean_silence=clean_silence)
        m = res["models"]

        k_lbl = m["keras"]["predicted_label"]
        k_cnf = f"{m['keras']['confidence']*100:.1f}%"
        tf_lbl = m["tflite"]["predicted_label"]
        tf_cnf = f"{m['tflite']['confidence']*100:.1f}%"
        ti_lbl = m["tinyml"]["predicted_label"]
        ti_cnf = f"{m['tinyml']['confidence']*100:.1f}%"

        agree = res["all_agree"]
        if agree:
            agreement_count += 1
        agree_str = "YES [=]" if agree else "NO  [!]"

        row_str = (
            f"{f.name[:col_w[0]]:<{col_w[0]}} | "
            f"{k_lbl:<{col_w[1]}} {k_cnf:<{col_w[2]}} | "
            f"{tf_lbl:<{col_w[3]}} {tf_cnf:<{col_w[4]}} | "
            f"{ti_lbl:<{col_w[5]}} {ti_cnf:<{col_w[6]}} | "
            f"{agree_str:<{col_w[7]}}"
        )
        print(row_str)

        latencies["keras"].append(m["keras"]["latency_ms"])
        latencies["tflite"].append(m["tflite"]["latency_ms"])
        latencies["tinyml"].append(m["tinyml"]["latency_ms"])

        rows.append({
            "filename": f.name,
            "keras_pred": k_lbl,
            "keras_conf": m["keras"]["confidence"],
            "keras_latency_ms": m["keras"]["latency_ms"],
            "tflite_pred": tf_lbl,
            "tflite_conf": m["tflite"]["confidence"],
            "tflite_latency_ms": m["tflite"]["latency_ms"],
            "tinyml_pred": ti_lbl,
            "tinyml_conf": m["tinyml"]["confidence"],
            "tinyml_latency_ms": m["tinyml"]["latency_ms"],
            "all_agree": agree
        })

    print("-" * len(header))
    print(f"Total Files Tested : {len(files)}")
    print(f"Model Consensus    : {agreement_count}/{len(files)} files ({agreement_count/len(files)*100:.1f}% agreement)")
    print(f"Avg Latency Keras  : {np.mean(latencies['keras']):.2f} ms")
    print(f"Avg Latency TFLite : {np.mean(latencies['tflite']):.2f} ms")
    print(f"Avg Latency TinyML : {np.mean(latencies['tinyml']):.2f} ms")
    print("=" * 80 + "\n")

    if export_csv:
        RESULTS_DIR.mkdir(parents=True, exist_ok=True)
        csv_path = RESULTS_DIR / "audio_input_batch_results.csv"
        df = pd.DataFrame(rows)
        df.to_csv(csv_path, index=False)
        print(f"--> Saved batch results CSV to: {csv_path}\n")


def _print_single_result(model_name: str, file_name: str, res: dict, classes: list):
    print("\n" + "=" * 55)
    print(f"        {model_name.upper()} INFERENCE")
    print("=" * 55)
    print(f"Audio File   : {file_name}")
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


def interactive_selection():
    """Provides an interactive terminal menu for testing files in Audio Input."""
    files = get_audio_input_files()
    if not files:
        print(f"\n[!] No audio files (.wav) found in '{AUDIO_INPUT_DIR}'.")
        print("    Add .wav audio files to this folder or record from microphone first!\n")
        return

    print("\n" + "=" * 55)
    print("       'AUDIO INPUT' FOLDER SELECTION MENU")
    print("=" * 55)
    print(f"Folder: {AUDIO_INPUT_DIR}")
    print(f"Found {len(files)} audio file(s):\n")

    for idx, f in enumerate(files, start=1):
        size_kb = f.stat().st_size / 1024
        print(f"  [{idx}] {f.name} ({size_kb:.1f} KB)")

    print("\n  [A] Test ALL files in batch mode")
    print("  [Q] Exit")
    print("-" * 55)

    choice = input("Select an option [1-{}, A, Q]: ".format(len(files))).strip().lower()

    if choice == 'q':
        print("Cancelled.")
        return

    tester = UnifiedModelTester()
    tester.load_all_models()

    if choice == 'a':
        test_all_files_batch(files, tester)
    elif choice.isdigit() and 1 <= int(choice) <= len(files):
        selected_file = files[int(choice) - 1]
        test_single_file(selected_file, tester, model_choice="all")
    else:
        print("[!] Invalid option selected.")


def main():
    parser = argparse.ArgumentParser(
        description="Test Best Model, TFLite, and TinyML on audio files in 'Audio CNN/Audio Input/'"
    )
    parser.add_argument(
        "--file", type=str, default=None,
        help="Specific audio file name or path to test"
    )
    parser.add_argument(
        "--all", action="store_true",
        help="Test all audio files in 'Audio Input/' in batch mode"
    )
    parser.add_argument(
        "--model", type=str, choices=["all", "best", "tflite", "tinyml"], default="all",
        help="Model to test: 'all' (default), 'best', 'tflite', or 'tinyml'"
    )
    parser.add_argument(
        "--export-csv", action="store_true",
        help="Export batch evaluation results to Audio CNN/Results/audio_input_batch_results.csv"
    )
    parser.add_argument(
        "--no-silence-clean", action="store_true",
        help="Disable automatic DSP silence removal"
    )

    args = parser.parse_args()
    clean_silence = not args.no_silence_clean

    if args.file:
        tester = UnifiedModelTester()
        test_single_file(Path(args.file), tester, model_choice=args.model, clean_silence=clean_silence)
    elif args.all:
        files = get_audio_input_files()
        if not files:
            print(f"[!] No audio files found in '{AUDIO_INPUT_DIR}'")
            return
        tester = UnifiedModelTester()
        test_all_files_batch(files, tester, export_csv=args.export_csv, clean_silence=clean_silence)
    else:
        # Launch interactive menu
        interactive_selection()


if __name__ == "__main__":
    main()
