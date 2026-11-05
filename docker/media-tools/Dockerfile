# Video editing tools for RealCRM (ffmpeg + ffprobe), the same build on macOS, Windows and Linux.
# Node runs on the host as usual. With MEDIA_TOOLS=docker the backend runs ffmpeg in this container
# via `docker exec` (see src/utils/ffmpeg.ts). Start it with: docker compose up -d media-tools
#
# Debian's ffmpeg is built with libass + HarfBuzz (needed for Hindi/Punjabi captions), libvidstab,
# libx264 and the filters the renderer uses (xfade, sidechaincompress, loudnorm, subtitles, zoompan).
FROM debian:trixie-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ffmpeg \
      fontconfig \
      # Default font for drawtext overlays (AI Studio reels). Video Lab captions use assets/fonts.
      fonts-dejavu-core \
      # Noto Sans incl. Devanagari and Gurmukhi, as a fallback for Indic text
      fonts-noto-core \
 && rm -rf /var/lib/apt/lists/* \
 && fc-cache -f

WORKDIR /work

# Stay running so the backend can `docker exec` ffmpeg without starting a new container each time
CMD ["sleep", "infinity"]
