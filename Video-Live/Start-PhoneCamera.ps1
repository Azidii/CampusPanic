param([double]$Confidence = 0.5)
$ErrorActionPreference = 'Stop'
$videoPython = Join-Path $PSScriptRoot 'venv\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $videoPython)) { throw 'Run Setup-Video.ps1 first.' }
Write-Host 'Connect your Android phone to the same Wi-Fi. Enter the laptop Wi-Fi IP and the pairing code shown below.'
& $videoPython (Join-Path $PSScriptRoot 'live_video.py') --phone-app --confidence $Confidence --share-on-lan
