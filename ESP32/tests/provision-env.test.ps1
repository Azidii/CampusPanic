$ErrorActionPreference = 'Stop'
$provision = Join-Path $PSScriptRoot '..\provision.ps1'
$fixture = Join-Path ([IO.Path]::GetTempPath()) ('esp32-env-test-' + [Guid]::NewGuid().ToString('N') + '.env')
$valid = @'
WIFI_SSID='Lab # network'
WIFI_PASSWORD='test-only="password"'
SERVER_URL=http://127.0.0.1:5000
LED_ACTIVE_HIGH=true
'@
function Check-Config([string]$Text, [bool]$ShouldPass) {
    [IO.File]::WriteAllText($fixture, $Text, [Text.UTF8Encoding]::new($false))
    $passed = $false
    try { $null = & $provision -EnvFile $fixture -ValidateOnly; $passed = $true }
    catch {
        if ($_.Exception.Message.Contains('test-only="password"')) { throw 'Validation leaked a fixture value.' }
    }
    if ($passed -ne $ShouldPass) { throw 'Unexpected .env validation result.' }
}
try {
    Check-Config $valid $true
    Check-Config ($valid.Replace('SERVER_URL=http://127.0.0.1:5000', 'SERVER_URL=')) $false
    Check-Config ($valid.Replace('LED_ACTIVE_HIGH=true', 'LED_ACTIVE_HIGH=yes')) $false
    Check-Config ($valid.Replace('http://127.0.0.1:5000', 'https://127.0.0.1:5000')) $false
    Check-Config ($valid + "`nWIFI_SSID=duplicate") $false
    Check-Config ($valid.Replace("WIFI_SSID='Lab # network'", 'WIFI_SSID="bad\nvalue"')) $false
    Check-Config ($valid.Replace("WIFI_SSID='Lab # network'", 'WIFI_SSID=' + ('x' * 33))) $false
    Write-Output 'PASS: .env validation, quoting, missing fields, duplicate fields, control characters and limits; no serial port opened.'
} finally {
    if (Test-Path -LiteralPath $fixture) { Remove-Item -LiteralPath $fixture }
}
