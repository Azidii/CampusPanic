param(
    [int]$Port = 5057,
    [float]$Threshold = 0.55,
    [int]$Threads = 8
)

$ErrorActionPreference = 'Stop'
$root = Resolve-Path (Join-Path $PSScriptRoot '..')
$model = Join-Path $root 'Audio-CNN\Audio CNN\Models\best_cnn_model.keras'
$classes = Join-Path $root 'Audio-CNN\Audio CNN\Models\classes.json'

if (-not (Test-Path $model)) { throw "Keras model not found at $model" }
if (-not (Test-Path $classes)) { throw "classes.json not found at $classes" }

$env:CAMPUSPANIC_AUDIO_KEY = "campuspanic_standalone_dev_audio_key_1234567890"

Write-Host "Starting CampusPanic Audio CNN Worker on port $Port..." -ForegroundColor Cyan
python (Join-Path $PSScriptRoot 'audio_worker.py') --model $model --classes $classes --port $Port --threshold $Threshold --threads $Threads

