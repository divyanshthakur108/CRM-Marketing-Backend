#!/usr/bin/env bash
# Downloads Real-ESRGAN (free, open-source AI upscaler) used by Creative Lab clean-up.
# Official release: https://github.com/xinntao/Real-ESRGAN/releases/tag/v0.2.5.0
# Installs into ../tools/realesrgan (next to the repos, NOT in git), or into $REALESRGAN_DIR.
#   npm run setup:realesrgan
set -euo pipefail

VERSION_TAG="v0.2.5.0"
BUILD="20220424"
DIR="${REALESRGAN_DIR:-$(cd "$(dirname "$0")/../.." && pwd)/tools/realesrgan}"

case "$(uname -s)" in
  Darwin) OS="macos" ;;
  Linux) OS="ubuntu" ;;
  MINGW*|MSYS*|CYGWIN*) OS="windows" ;;
  *) echo "Unsupported OS: $(uname -s)"; exit 1 ;;
esac

BIN="$DIR/realesrgan-ncnn-vulkan"
[ "$OS" = "windows" ] && BIN="$BIN.exe"
if [ -x "$BIN" ] && [ -d "$DIR/models" ]; then
  echo "Real-ESRGAN already installed: $BIN"
  exit 0
fi

ZIP="realesrgan-ncnn-vulkan-${BUILD}-${OS}.zip"
URL="https://github.com/xinntao/Real-ESRGAN/releases/download/${VERSION_TAG}/${ZIP}"
mkdir -p "$DIR"
echo "Downloading $ZIP (~50 MB) from the official GitHub release..."
curl -fL --progress-bar -o "$DIR/$ZIP" "$URL"
unzip -q -o "$DIR/$ZIP" -d "$DIR"
rm -f "$DIR/$ZIP" "$DIR"/input*.jpg "$DIR"/onepiece_demo.mp4
chmod +x "$BIN" 2>/dev/null || true
# macOS marks downloaded programs as "quarantined"; remove that flag so it can run
[ "$OS" = "macos" ] && xattr -d com.apple.quarantine "$BIN" 2>/dev/null || true

echo "Installed: $BIN"
if ("$BIN" -h 2>&1 || true) | grep -qi "usage"; then echo "Check: runs OK"; else echo "Warning: it didn't start. It needs a GPU with Vulkan support (Apple Silicon, most NVIDIA / AMD / Intel GPUs)."; fi
echo "If you installed somewhere else, set REALESRGAN_PATH in the backend .env to the binary path."
