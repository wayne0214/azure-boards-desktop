# Builds the Windows installer (NSIS .exe). Run from PowerShell on Windows:
#
#   powershell -ExecutionPolicy Bypass -File scripts\build-installer.ps1
#
# Output: src-tauri\target\release\bundle\nsis\Boards_<version>_x64-setup.exe
#
# Prerequisites (one-time):
#   - Node 20+            https://nodejs.org
#   - Rust (MSVC)         https://rustup.rs   (choose the default MSVC toolchain)
#   - Visual Studio Build Tools with "Desktop development with C++"
#   - WebView2 runtime is bundled by the installer automatically (downloadBootstrapper)
$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..")

function Need($cmd, $hint) {
  if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) { Write-Error "Missing '$cmd'. $hint" }
}
Need node  "Install Node 20+ from https://nodejs.org"
Need cargo "Install Rust from https://rustup.rs"

if (-not (Test-Path node_modules)) {
  Write-Host "Installing npm dependencies..."
  npm ci
}

Write-Host "Building Windows installer (NSIS)..."
npx tauri build --bundles nsis

Write-Host ""
Write-Host "Done. Installer:"
Get-ChildItem -Path "src-tauri\target\release\bundle\nsis" -Filter *.exe | ForEach-Object { Write-Host "  $($_.FullName)" }
Write-Host ""
Write-Host "The installer is unsigned; Windows SmartScreen will warn on first launch."
Write-Host "To sign it, set TAURI_SIGNING_PRIVATE_KEY or configure 'bundle.windows.certificateThumbprint' (see https://tauri.app/distribute/sign/windows/)."
