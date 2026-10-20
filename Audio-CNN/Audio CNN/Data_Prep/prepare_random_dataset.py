"""
prepare_random_dataset.py
Copies all 3,979 audio files from Datasets to Datasets/random.
Ensures unique filenames to avoid collision and creates a tracking manifest.
"""

import os
import shutil
import pandas as pd
from pathlib import Path

data_prep_dir = Path(__file__).resolve().parent
audio_cnn_dir = data_prep_dir.parent
project_root = audio_cnn_dir.parent

def prepare_random_dataset():
    source_csv = data_prep_dir / "dataset_index.csv"
    dest_dir = project_root / "Datasets" / "random"
    
    if not source_csv.exists():
        raise FileNotFoundError(f"Missing {source_csv}")
        
    df = pd.read_csv(source_csv)
    dest_dir.mkdir(parents=True, exist_ok=True)
    
    manifest_rows = []
    total = len(df)
    print(f"Copying {total} files to: {dest_dir} ...")
    
    for i, row in df.iterrows():
        src_path = Path(row['absolute_path'])
        if not src_path.exists():
            continue
            
        subcat_clean = row['sub_category'].replace('/', '_').replace('\\', '_').replace(' ', '_')
        dest_filename = f"{subcat_clean}_{src_path.name}"
        dest_path = dest_dir / dest_filename
        
        if dest_path.exists() and dest_path != src_path:
            dest_filename = f"{i:04d}_{dest_filename}"
            dest_path = dest_dir / dest_filename
            
        shutil.copy2(src_path, dest_path)
        
        manifest_rows.append({
            'random_filename': dest_filename,
            'true_label': row['label'],
            'sub_category': row['sub_category'],
            'original_filename': row['file_name'],
            'original_path': row['absolute_path'],
            'duration_seconds': row['duration_seconds'],
            'sample_rate': row['sample_rate'],
            'file_size_bytes': row['file_size_bytes'],
            'random_file_path': str(dest_path)
        })
        
        if (i + 1) % 500 == 0 or (i + 1) == total:
            print(f"  Copied {i + 1}/{total} files...")
            
    manifest_df = pd.DataFrame(manifest_rows)
    manifest_path = dest_dir / "random_manifest.csv"
    manifest_df.to_csv(manifest_path, index=False)
    manifest_df.to_csv(data_prep_dir / "random_manifest.csv", index=False)
    
    print("\n" + "="*50)
    print(f"Successfully copied {len(manifest_df)} files to {dest_dir}")
    print(f"Tracking manifest saved to: {manifest_path}")
    print("="*50)

if __name__ == '__main__':
    prepare_random_dataset()
