$ErrorActionPreference = 'Stop'
$videoPython = $null
$bundledPython = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe'
foreach ($candidate in @($bundledPython, 'python', 'py')) {
    if ((Test-Path -LiteralPath $candidate) -or (Get-Command $candidate -ErrorAction SilentlyContinue)) {
        # Windows may expose a Store launcher named python without Python installed.
        try {
            & $candidate -c 'import sys; assert (3, 10) <= sys.version_info[:2] < (3, 15)' *> $null
            if ($LASTEXITCODE -eq 0) { $videoPython = $candidate; break }
        } catch { continue }
    }
}
if (-not $videoPython) { throw 'Install Python 3.12 (64 bit), then rerun Setup-Video.ps1.' }
& $videoPython -m venv (Join-Path $PSScriptRoot 'venv')
if ($LASTEXITCODE -ne 0) { throw 'Could not create the isolated Python environment.' }
& (Join-Path $PSScriptRoot 'venv\Scripts\python.exe') -m pip install -r (Join-Path $PSScriptRoot 'requirements.txt')
if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' }
Write-Host 'Video setup complete. Run Start-Video.ps1 with the Android stream URL.'
