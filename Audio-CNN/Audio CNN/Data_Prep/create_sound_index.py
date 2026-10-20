"""
create_sound_index.py
Scans Datasets/ folder, extracts audio properties, and exports to dataset_index.csv.
"""

import os
import csv
import wave
import contextlib
from pathlib import Path

data_prep_dir = Path(__file__).resolve().parent
audio_cnn_dir = data_prep_dir.parent
project_root = audio_cnn_dir.parent

def get_audio_info(file_path):
    file_size = os.path.getsize(file_path)
    try:
        with contextlib.closing(wave.open(str(file_path), 'rb')) as wf:
            channels = wf.getnchannels()
            sample_rate = wf.getframerate()
            frames = wf.getnframes()
            sample_width = wf.getsampwidth()
            duration = frames / float(sample_rate) if sample_rate > 0 else 0.0
            bit_depth = sample_width * 8
            return {
                'sample_rate': sample_rate,
                'channels': channels,
                'duration_seconds': round(duration, 4),
                'bit_depth': bit_depth,
                'file_size_bytes': file_size,
                'status': 'OK'
            }
    except Exception as e_wave:
        return {
            'sample_rate': None,
            'channels': None,
            'duration_seconds': None,
            'bit_depth': None,
            'file_size_bytes': file_size,
            'status': f'Wave read error: {e_wave}'
        }

def determine_label(rel_path_parts):
    lower_parts = [p.lower() for p in rel_path_parts]
    if any('non_scream' in p or 'non-scream' in p for p in lower_parts):
        return 'Non-Scream'
    if any('scream' in p for p in lower_parts):
        return 'Scream'
    gun_keywords = ['gun', 'shot', 'mp5', 'zastava', 'ak-', 'm16', 'm4', 'm249', 'mg-42', 'desert eagle']
    if any(any(kw in p for kw in gun_keywords) for p in lower_parts):
        return 'Gunshot'
    return 'Unknown'

def build_index(dataset_root, output_csv):
    dataset_root = Path(dataset_root).resolve()
    output_csv = Path(output_csv).resolve()
    
    if not dataset_root.exists():
        print(f"Error: Dataset directory does not exist at '{dataset_root}'")
        return

    print(f"Scanning dataset in: {dataset_root}")
    audio_extensions = {'.wav', '.mp3', '.flac', '.ogg', '.m4a', '.aiff'}
    
    rows = []
    class_counts = {}
    
    for file_path in dataset_root.rglob('*'):
        # Ignore random test folder when creating original training index
        if 'random' in file_path.parts:
            continue
        if file_path.is_file() and file_path.suffix.lower() in audio_extensions:
            rel_path = file_path.relative_to(project_root)
            rel_to_dataset = file_path.relative_to(dataset_root)
            parts = rel_to_dataset.parts[:-1]
            sub_category = "/".join(parts) if parts else "root"
            label = determine_label(parts)
            class_counts[label] = class_counts.get(label, 0) + 1
            meta = get_audio_info(file_path)
            
            rows.append({
                'file_name': file_path.name,
                'label': label,
                'sub_category': sub_category,
                'duration_seconds': meta['duration_seconds'],
                'sample_rate': meta['sample_rate'],
                'channels': meta['channels'],
                'bit_depth': meta['bit_depth'],
                'file_size_bytes': meta['file_size_bytes'],
                'relative_path': str(rel_path).replace('\\', '/'),
                'absolute_path': str(file_path),
                'read_status': meta['status']
            })
            
    print(f"Total audio files found: {len(rows)}")
    for lbl, count in sorted(class_counts.items()):
        print(f"  - {lbl}: {count} files")
        
    output_csv.parent.mkdir(parents=True, exist_ok=True)
    with open(output_csv, mode='w', newline='', encoding='utf-8') as f:
        fieldnames = [
            'file_name', 'label', 'sub_category', 'duration_seconds',
            'sample_rate', 'channels', 'bit_depth', 'file_size_bytes',
            'relative_path', 'absolute_path', 'read_status'
        ]
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)
        
    print(f"\nIndex successfully written to: {output_csv}")

if __name__ == '__main__':
    dataset_dir = project_root / 'Datasets'
    csv_file = data_prep_dir / 'dataset_index.csv'
    build_index(dataset_dir, csv_file)
