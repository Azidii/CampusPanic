param(
    [string]$Port = 'COM7',
    [string]$EnvFile = (Join-Path $PSScriptRoot '.env'),
    [switch]$ValidateOnly
)
$ErrorActionPreference = 'Stop'
$names = @('WIFI_SSID','WIFI_PASSWORD','SERVER_URL')
$limits = @(32,63,512)
$values = @{}
if (!(Test-Path -LiteralPath $EnvFile)) { throw 'Create ESP32/.env from .env.example first.' }
foreach ($line in [IO.File]::ReadAllLines((Resolve-Path -LiteralPath $EnvFile))) {
    if ($line -match '^\s*(#|$)') { continue }
    if ($line -notmatch '^\s*([A-Z][A-Z0-9_]*)\s*=(.*)$') { throw 'Invalid .env assignment.' }
    $name = $Matches[1]
    $value = $Matches[2].Trim()
    if ($name -notin $names) { throw "Unsupported .env field: $name" }
    if ($values.ContainsKey($name)) { throw "Duplicate .env field: $name" }
    if ($value.StartsWith('"')) {
        try { $value = ConvertFrom-Json -InputObject $value -ErrorAction Stop }
        catch { throw "Invalid double-quoted .env field: $name" }
        if ($value -isnot [string]) { throw "Invalid .env field: $name" }
    } elseif ($value.StartsWith("'")) {
        if ($value.Length -lt 2 -or !$value.EndsWith("'")) { throw "Invalid quoted .env field: $name" }
        $value = $value.Substring(1, $value.Length - 2)
    }
    $values[$name] = $value
}
for ($i = 0; $i -lt $names.Count; $i++) {
    $name = $names[$i]
    if (!$values.ContainsKey($name)) { throw "Missing .env field: $name" }
    $value = $values[$name]
    if ($value -match '[\x00-\x1F\x7F]' -or [Text.Encoding]::UTF8.GetByteCount($value) -gt $limits[$i]) {
        throw "Invalid characters or length in .env field: $name"
    }
    if ($name -ne 'WIFI_PASSWORD' -and !$value.Length) { throw "Empty .env field: $name" }
}
if ($values.SERVER_URL -notmatch '^http://[^\s/]+/?$' -or $values.SERVER_URL.Contains('YOUR_LAPTOP_IP')) {
    throw 'SERVER_URL must be the actual local website base URL, without an API path.'
}
$values.SERVER_URL = $values.SERVER_URL.TrimEnd('/')
if ($ValidateOnly) { Write-Output '.env validation passed. No values printed; no serial port opened.'; return }

function Wait-Board([string]$Expected) {
    $timer = [Diagnostics.Stopwatch]::StartNew()
    $buffer = ''
    while ($timer.Elapsed.TotalSeconds -lt 15) {
        $buffer += $serial.ReadExisting()
        if ($buffer.Contains('CONFIG ERROR')) { throw 'The board rejected configuration. No received values will be printed.' }
        if ($buffer.Contains($Expected)) { return }
        Start-Sleep -Milliseconds 25
    }
    throw 'Board did not acknowledge configuration. Check port, sketch and Serial Monitor closure.'
}

$serial = [IO.Ports.SerialPort]::new($Port, 115200)
$serial.Encoding = [Text.Encoding]::UTF8
$serial.NewLine = "`n"
$serial.DtrEnable = $false
$serial.RtsEnable = $false
try {
    $serial.Open()
    Start-Sleep -Seconds 2
    $serial.DiscardInBuffer()
    $serial.Write('p')
    Wait-Board 'CONFIG READY'
    foreach ($name in $names) {
        $serial.WriteLine($name + '=' + $values[$name])
        Wait-Board ('CONFIG OK ' + $name)
    }
    $serial.WriteLine('COMMIT')
    Wait-Board 'CONFIG SAVED'
    Write-Output 'Configuration saved to board runtime storage. The ESP32 will restart. No secrets were printed or compiled into the sketch.'
} finally {
    if ($serial.IsOpen) { $serial.Close() }
    $serial.Dispose()
}
