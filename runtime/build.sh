#!/usr/bin/env bash
#
# Build script for the OPC UA Runtime (Linux/macOS).
#
# Usage:
#   ./build.sh              # Debug build (default)
#   ./build.sh --release    # Release build
#   ./build.sh --clean      # Clean and rebuild
#   ./build.sh --clean --release

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUILD_DIR="$SCRIPT_DIR/build"

BUILD_TYPE="Debug"
CLEAN=false

# --- Parse arguments ----------------------------------------------------------

while [[ $# -gt 0 ]]; do
    case "$1" in
        --release|-r)
            BUILD_TYPE="Release"
            shift
            ;;
        --clean|-c)
            CLEAN=true
            shift
            ;;
        --help|-h)
            echo "Usage: $0 [--release] [--clean]"
            echo ""
            echo "Options:"
            echo "  --release, -r   Build in Release mode (default: Debug)"
            echo "  --clean, -c     Remove build directory before building"
            echo "  --help, -h      Show this help message"
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            echo "Run '$0 --help' for usage."
            exit 1
            ;;
    esac
done

# --- Validate prerequisites ---------------------------------------------------

for tool in cmake ninja gcc git; do
    if ! command -v "$tool" &>/dev/null; then
        echo "Error: '$tool' not found. Please install it."
        echo "  Ubuntu/Debian: sudo apt install cmake build-essential git ninja-build"
        echo "  macOS:         brew install cmake ninja git"
        exit 1
    fi
done

# --- Clean if requested -------------------------------------------------------

if [ "$CLEAN" = true ] && [ -d "$BUILD_DIR" ]; then
    echo "Cleaning build directory..."
    rm -rf "$BUILD_DIR"
fi

# --- Create build directory ---------------------------------------------------

mkdir -p "$BUILD_DIR"

# --- Configure ----------------------------------------------------------------

echo "Configuring ($BUILD_TYPE)..."

cd "$BUILD_DIR"

if [ ! -f "CMakeCache.txt" ]; then
    cmake .. -G Ninja -DCMAKE_BUILD_TYPE="$BUILD_TYPE"
else
    echo "Build already configured. Skipping cmake configure (use --clean to reconfigure)."
fi

# --- Build --------------------------------------------------------------------

echo "Building..."
cmake --build .

echo ""
echo "Build successful!"

BINARY="$SCRIPT_DIR/opcua-runtime"
if [ -f "$BINARY" ]; then
    echo "Binary: $BINARY"
fi
