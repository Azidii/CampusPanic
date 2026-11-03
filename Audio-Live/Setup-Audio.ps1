param()

$ErrorActionPreference = 'Stop'
$audioPython = $null
$audioPythonArgs = @()
$bundledAudioPython = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe'
$audioCandidates = @(
    @{ Command = $bundledAudioPython; Arguments = @() },
    @{ Command = 'python'; Arguments = @() },
    @{ Command = 'py'; Arguments = @('-3.12') },
    @{ Command = 'py'; Arguments = @('-3.13') },
    @{ Command = 'py'; Arguments = @('-3.11') },
    @{ Command = 'py'; Arguments = @('-3.10') }
)

foreach ($audioCandidate in $audioCandidates) {
    $audioCommand = $audioCandidate.Command
    if (-not ((Test-Path -LiteralPath $audioCommand) -or (Get-Command $audioCommand -ErrorAction SilentlyContinue))) { continue }
    $audioArguments = $audioCandidate.Arguments
    # TensorFlow needs a supported, native 64-bit Windows Python. MSYS Python
    # reports a different platform and cannot use the Windows dependency wheels.
    try {
        & $audioCommand @audioArguments -c "import struct, sys; assert sys.platform == 'win32'; assert struct.calcsize('P') == 8; assert (3, 10) <= sys.version_info[:2] < (3, 14)" *> $null
        if ($LASTEXITCODE -eq 0) {
            $audioPython = $audioCommand
            $audioPythonArgs = $audioArguments
            break
        }
    } catch { continue }
}

if (-not $audioPython) { throw 'Install native 64-bit Python 3.12 for Windows, then rerun Setup-Audio.ps1. Python 3.10-3.13 is supported.' }

$audioVenv = Join-Path $PSScriptRoot 'venv'
& $audioPython @audioPythonArgs -m venv $audioVenv
if ($LASTEXITCODE -ne 0) { throw 'Could not create Audio-Live/venv.' }
& (Join-Path $audioVenv 'Scripts\python.exe') -m pip install -r (Join-Path $PSScriptRoot 'requirements.txt')
if ($LASTEXITCODE -ne 0) { throw 'Audio dependency installation failed. Check the pip output, then rerun Setup-Audio.ps1.' }
Write-Host 'Audio setup complete. Run Start-Audio.ps1 or restart the website.'
