param(
    [Parameter(Mandatory=$true)][string]$StreamUrl,
    [double]$Confidence = 0.5,
    [switch]$ShareOnLan
)
$ErrorActionPreference = 'Stop'
$videoPython = Join-Path $PSScriptRoot 'venv\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $videoPython)) { throw 'Run Setup-Video.ps1 first.' }
$videoArguments = @((Join-Path $PSScriptRoot 'live_video.py'), '--stream-url', $StreamUrl, '--confidence', $Confidence)
if ($ShareOnLan) { $videoArguments += '--share-on-lan' }
& $videoPython @videoArguments
