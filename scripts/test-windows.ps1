param([Parameter(Mandatory=$true)][string]$Package, [Parameter(Mandatory=$true)][string]$Project)
$ErrorActionPreference = 'Stop'
$env:ELECTRON_RUN_AS_NODE = '1'
$env:RUNE_IDE_WINDOWS_EXE = Join-Path $Package 'rune-ide.exe'
$env:RUNE_IDE_TEST_BACKGROUND = '1'
# Electron's Node mode avoids requiring a separate Windows Node installation.
& $env:RUNE_IDE_WINDOWS_EXE (Join-Path $Project 'scripts\test-windows.cjs') | Out-Host
exit $LASTEXITCODE
