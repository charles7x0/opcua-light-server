<#
.SYNOPSIS
    Build script for the OPC UA Runtime (Windows).

.DESCRIPTION
    Configures and builds the opcua-runtime C project using CMake + Ninja
    with the MSYS2 MinGW toolchain.

.PARAMETER Release
    Build in Release mode (default is Debug).

.PARAMETER Clean
    Remove the build directory before building.

.EXAMPLE
    .\build.ps1
    .\build.ps1 -Release
    .\build.ps1 -Clean -Release
#>

param(
    [switch]$Release,
    [switch]$Clean
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$BuildDir = Join-Path $ScriptDir "build"
$MinGWBin = "C:\msys64\mingw64\bin"

# --- Validate prerequisites ---------------------------------------------------

if (-not (Test-Path $MinGWBin)) {
    Write-Error "MSYS2 MinGW not found at $MinGWBin. Install MSYS2 and run: pacman -S mingw-w64-x86_64-gcc mingw-w64-x86_64-ninja"
    exit 1
}

# Add MinGW to PATH for this session
if ($env:PATH -notlike "*$MinGWBin*") {
    $env:PATH = "$MinGWBin;$env:PATH"
}

# Verify tools are available
$requiredTools = @("gcc", "ninja", "cmake")
foreach ($tool in $requiredTools) {
    if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) {
        Write-Error "'$tool' not found on PATH. Ensure MSYS2 MinGW toolchain is installed."
        exit 1
    }
}

# --- Clean if requested -------------------------------------------------------

if ($Clean -and (Test-Path $BuildDir)) {
    Write-Host "Cleaning build directory..." -ForegroundColor Yellow
    Remove-Item -Recurse -Force $BuildDir
}

# --- Create build directory ---------------------------------------------------

if (-not (Test-Path $BuildDir)) {
    New-Item -ItemType Directory -Path $BuildDir | Out-Null
}

# --- Configure ----------------------------------------------------------------

$BuildType = if ($Release) { "Release" } else { "Debug" }

Write-Host "Configuring ($BuildType)..." -ForegroundColor Cyan

$cmakeArgs = @(
    ".."
    "-G", "Ninja"
    "-DCMAKE_BUILD_TYPE=$BuildType"
    "-DCMAKE_POLICY_VERSION_MINIMUM=3.5"
)

Push-Location $BuildDir
try {
    # Only reconfigure if CMakeCache.txt doesn't exist or Clean was used
    if (-not (Test-Path "CMakeCache.txt")) {
        & cmake @cmakeArgs
        if ($LASTEXITCODE -ne 0) {
            Write-Error "CMake configuration failed."
            exit 1
        }
    } else {
        Write-Host "Build already configured. Skipping cmake configure (use -Clean to reconfigure)." -ForegroundColor DarkGray
    }

    # --- Build ----------------------------------------------------------------

    Write-Host "Building..." -ForegroundColor Cyan
    & cmake --build .
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Build failed."
        exit 1
    }

    Write-Host "Build successful!" -ForegroundColor Green
    $binary = Join-Path $ScriptDir "opcua-runtime.exe"
    if (Test-Path $binary) {
        Write-Host "Binary: $binary" -ForegroundColor Green
    }
} finally {
    Pop-Location
}
