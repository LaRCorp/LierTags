# Build LierTags for Windows (x64)
#
# Usage (from repository root):
#   powershell -ExecutionPolicy Bypass -File packaging/windows/build.ps1

$ErrorActionPreference = "Stop"

$root = (Resolve-Path (Join-Path $PSScriptRoot "../..")).Path
$frontend = Join-Path $root "frontend"
$manifest = Join-Path $root "src-tauri/Cargo.toml"
$outDir = Join-Path $root "dist/LierTags-windows-x64"

Write-Host "=== Building LierTags for Windows ===" -ForegroundColor Cyan

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    throw "npm was not found. Install Node.js from https://nodejs.org/"
}
if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) {
    throw "cargo was not found. Install Rust from https://rustup.rs/"
}

Write-Host "Step 1/3: Building React + Vite frontend..." -ForegroundColor Yellow
Push-Location $frontend
try {
    npm run build
    if ($LASTEXITCODE -ne 0) { throw "Frontend build failed" }
} finally {
    Pop-Location
}

Write-Host "Step 2/3: Compiling Tauri release binary..." -ForegroundColor Yellow
cargo build --release --features custom-protocol --manifest-path $manifest
if ($LASTEXITCODE -ne 0) { throw "Cargo build failed" }

Write-Host "Step 3/3: Packaging standalone portable bundle..." -ForegroundColor Yellow
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
Copy-Item (Join-Path $root "target/release/liertags-app.exe") $outDir -Force
Copy-Item (Join-Path $PSScriptRoot "run-portable.bat") $outDir -Force

Write-Host "Done: $outDir" -ForegroundColor Green
Write-Host "  liertags-app.exe - normal launch"
Write-Host "  run-portable.bat - portable launch"
