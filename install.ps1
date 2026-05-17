# TeamCode Installer for Windows
# Run: powershell -ExecutionPolicy Bypass -File install.ps1
param(
    [switch]$NoModifyPath,
    [string]$InstallDir = "$env:USERPROFILE\.teamcode"
)

$ErrorActionPreference = "Stop"
$TEAMCODE_ROOT = Split-Path -Parent $MyInvocation.MyCommand.Path
$BIN_DIR = Join-Path $InstallDir "bin"
$LAUNCHER = Join-Path $BIN_DIR "teamcode.cmd"
$CONFIG_FILE = Join-Path $InstallDir "teamcode.jsonc"

Write-Host "  ⬢ TeamCode Installer" -ForegroundColor Cyan
Write-Host "  Source:  $TEAMCODE_ROOT" -ForegroundColor Gray
Write-Host "  Install: $InstallDir" -ForegroundColor Gray
Write-Host ""

# ── 1. Detect / install Bun ──
$bun = Get-Command bun -ErrorAction SilentlyContinue
if ($bun) {
    Write-Host "  ✓ bun $(& bun --version)" -ForegroundColor Green
} else {
    Write-Host "  Installing bun..." -ForegroundColor Gray
    irm bun.sh/install.ps1 | iex
    $env:Path = [Environment]::GetEnvironmentVariable("Path", "User")
    Write-Host "  ✓ bun installed" -ForegroundColor Green
}

# ── 2. Install dependencies ──
Write-Host "  Installing packages..." -ForegroundColor Gray
Set-Location $TEAMCODE_ROOT
bun install 2>$null
Write-Host "  ✓ dependencies" -ForegroundColor Green

# ── 3. Create install directory + launcher ──
if (-not (Test-Path $BIN_DIR)) {
    New-Item -ItemType Directory -Path $BIN_DIR -Force | Out-Null
}

@"
@echo off
setlocal
cd /d "%CD%"
bun run --conditions=browser "$TEAMCODE_ROOT\src\index.ts" %*
"@ | Set-Content -Path $LAUNCHER
Write-Host "  ✓ launcher → $LAUNCHER" -ForegroundColor Green

# ── 4. Copy default config ──
if (-not (Test-Path $CONFIG_FILE)) {
    $sourceConfig = Join-Path $TEAMCODE_ROOT "teamcode.jsonc"
    if (Test-Path $sourceConfig) {
        Copy-Item $sourceConfig $CONFIG_FILE
        Write-Host "  ✓ default config → $CONFIG_FILE" -ForegroundColor Green
    }
}

# ── 5. Add to PATH ──
if (-not $NoModifyPath) {
    $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
    if ($userPath -notlike "*$BIN_DIR*") {
        [Environment]::SetEnvironmentVariable("Path", "$userPath;$BIN_DIR", "User")
        $env:Path = "$env:Path;$BIN_DIR"
        Write-Host "  ✓ Added to PATH" -ForegroundColor Green
        Write-Host ""
        Write-Host "  Restart terminal or run:" -ForegroundColor Yellow
        Write-Host "    `$env:Path = [Environment]::GetEnvironmentVariable('Path','User')" -ForegroundColor Gray
    } else {
        Write-Host "  ✓ Already in PATH" -ForegroundColor Green
    }
}

# ── 6. API key hint ──
if (-not $env:TEAMCODE_API_KEY -and -not $env:TEAMCODE_PM_API_KEY) {
    Write-Host ""
    Write-Host "  Set your API key before first run:" -ForegroundColor Gray
    Write-Host "    `$env:TEAMCODE_API_KEY = 'sk-your-key'" -ForegroundColor Gray
    Write-Host "    or edit $CONFIG_FILE" -ForegroundColor Gray
}

Write-Host ""
Write-Host "  TeamCode installed! Run 'teamcode' from any directory." -ForegroundColor Cyan
