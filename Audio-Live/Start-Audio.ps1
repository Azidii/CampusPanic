param(
    [int]$Port = 5057,
    [float]$Threshold = 0.55,
    [int]$Threads = 8
)

$ErrorActionPreference = 'Stop'
$audioProjectRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
$audioModel = Join-Path $audioProjectRoot 'Audio-CNN\Audio CNN\Models\best_cnn_model.keras'
$audioClasses = Join-Path $audioProjectRoot 'Audio-CNN\Audio CNN\Models\classes.json'
$audioPython = if ($env:AUDIO_PYTHON -and $env:AUDIO_PYTHON.Trim()) { $env:AUDIO_PYTHON.Trim() } else { Join-Path $PSScriptRoot 'venv\Scripts\python.exe' }

if (-not ((Test-Path -LiteralPath $audioPython) -or (Get-Command $audioPython -ErrorAction SilentlyContinue))) {
    throw 'Audio Python environment not found. Run Audio-Live/Setup-Audio.ps1 first, or set AUDIO_PYTHON to a supported Python executable.'
}
try {
    & $audioPython -c "import struct, sys; assert sys.platform == 'win32'; assert struct.calcsize('P') == 8; assert (3, 10) <= sys.version_info[:2] < (3, 14)" *> $null
    if ($LASTEXITCODE -ne 0) { throw 'Unsupported Python' }
} catch {
    throw 'Audio requires native 64-bit Windows Python 3.10-3.13. Run Audio-Live/Setup-Audio.ps1 or correct AUDIO_PYTHON.'
}

if (-not (Test-Path -LiteralPath $audioModel)) { throw "Keras model not found at $audioModel" }
if (-not (Test-Path -LiteralPath $audioClasses)) { throw "classes.json not found at $audioClasses" }

$env:CAMPUSPANIC_AUDIO_KEY = 'campuspanic_standalone_dev_audio_key_1234567890'

Write-Host "Starting CampusPanic Audio CNN Worker on port $Port..." -ForegroundColor Cyan
& $audioPython (Join-Path $PSScriptRoot 'audio_worker.py') --model $audioModel --classes $audioClasses --port $Port --threshold $Threshold --threads $Threads
if ($LASTEXITCODE -ne 0) { throw "Audio worker exited with code $LASTEXITCODE." }
