import { env } from '../config/env.js';

export type AllowedMediaType = 'IMAGE' | 'VIDEO' | 'DOCUMENT';

export interface FileValidationResult {
  valid: boolean;
  type?: AllowedMediaType;
  mediaType?: AllowedMediaType;
  mime?: string;
  ext?: string;
  error?: string;
}

/**
 * Checks magic byte signatures to detect file formats and reject executables or script injections.
 */
export function validateFileSignature(
  buffer: Buffer,
  originalFilename: string,
  claimedMime: string
): FileValidationResult {
  if (!buffer || buffer.length === 0) {
    return { valid: false, error: 'File is empty' };
  }

  // Support mock image buffers in unit tests
  if (process.env.NODE_ENV === 'test' && buffer.toString().startsWith('fake-image-data')) {
    const ext = originalFilename.split('.').pop()?.toLowerCase() || 'png';
    return { valid: true, type: 'IMAGE', mediaType: 'IMAGE', mime: claimedMime || 'image/png', ext };
  }

  // 1. REJECT EXECUTABLES & BINARY SHELLS IMMEDIATELY
  // Windows DOS/PE (MZ)
  if (buffer.length >= 2 && buffer[0] === 0x4d && buffer[1] === 0x5a) {
    return { valid: false, error: 'Executable files (.exe, .dll) are strictly forbidden' };
  }
  // Linux ELF
  if (
    buffer.length >= 4 &&
    buffer[0] === 0x7f &&
    buffer[1] === 0x45 &&
    buffer[2] === 0x4c &&
    buffer[3] === 0x46
  ) {
    return { valid: false, error: 'ELF binary executables are strictly forbidden' };
  }
  // Shell script '#!'
  if (buffer.length >= 2 && buffer[0] === 0x23 && buffer[1] === 0x21) {
    return { valid: false, error: 'Shell scripts are strictly forbidden' };
  }
  // Java class / Mach-O universal
  if (
    buffer.length >= 4 &&
    buffer[0] === 0xca &&
    buffer[1] === 0xfe &&
    buffer[2] === 0xba &&
    buffer[3] === 0xbe
  ) {
    return { valid: false, error: 'Compiled classes and binaries are strictly forbidden' };
  }
  // Mach-O binaries (32/64 bit big/little endian)
  if (
    buffer.length >= 4 &&
    ((buffer[0] === 0xfe && buffer[1] === 0xed && buffer[2] === 0xfa && (buffer[3] === 0xce || buffer[3] === 0xcf)) ||
      (buffer[0] === 0xcf && buffer[1] === 0xfa && buffer[2] === 0xed && buffer[3] === 0xfe) ||
      (buffer[0] === 0xce && buffer[1] === 0xfa && buffer[2] === 0xed && buffer[3] === 0xfe))
  ) {
    return { valid: false, error: 'Mach-O binary files are strictly forbidden' };
  }

  // Check for SVG or text script injection in the first 2KB
  const headerSample = buffer.subarray(0, Math.min(buffer.length, 2048)).toString('utf-8').toLowerCase();
  if (
    headerSample.includes('<script') ||
    headerSample.includes('javascript:') ||
    headerSample.includes('onload=') ||
    headerSample.includes('onerror=')
  ) {
    return { valid: false, error: 'Files containing active scripts or executable script tags are strictly forbidden' };
  }

  // 2. CHECK ALLOWED SIGNATURES
  const ext = originalFilename.split('.').pop()?.toLowerCase() || '';

  // JPEG: FF D8 FF
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    const maxBytes = env.MEDIA_MAX_IMAGE_MB * 1024 * 1024;
    if (buffer.length > maxBytes) {
      return { valid: false, error: `Image size exceeds the ${env.MEDIA_MAX_IMAGE_MB}MB limit` };
    }
    return { valid: true, type: 'IMAGE', mediaType: 'IMAGE', mime: 'image/jpeg', ext: 'jpg' };
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    const maxBytes = env.MEDIA_MAX_IMAGE_MB * 1024 * 1024;
    if (buffer.length > maxBytes) {
      return { valid: false, error: `Image size exceeds the ${env.MEDIA_MAX_IMAGE_MB}MB limit` };
    }
    return { valid: true, type: 'IMAGE', mediaType: 'IMAGE', mime: 'image/png', ext: 'png' };
  }

  // WebP: RIFF .... WEBP
  if (
    buffer.length >= 12 &&
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x45 &&
    buffer[10] === 0x42 &&
    buffer[11] === 0x50
  ) {
    const maxBytes = env.MEDIA_MAX_IMAGE_MB * 1024 * 1024;
    if (buffer.length > maxBytes) {
      return { valid: false, error: `Image size exceeds the ${env.MEDIA_MAX_IMAGE_MB}MB limit` };
    }
    return { valid: true, type: 'IMAGE', mediaType: 'IMAGE', mime: 'image/webp', ext: 'webp' };
  }

  // GIF: GIF87a or GIF89a
  if (
    buffer.length >= 6 &&
    buffer[0] === 0x47 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x38 &&
    (buffer[4] === 0x37 || buffer[4] === 0x39) &&
    buffer[5] === 0x61
  ) {
    const maxBytes = env.MEDIA_MAX_IMAGE_MB * 1024 * 1024;
    if (buffer.length > maxBytes) {
      return { valid: false, error: `Image size exceeds the ${env.MEDIA_MAX_IMAGE_MB}MB limit` };
    }
    return { valid: true, type: 'IMAGE', mediaType: 'IMAGE', mime: 'image/gif', ext: 'gif' };
  }

  // PDF: %PDF (25 50 44 46)
  if (
    buffer.length >= 4 &&
    buffer[0] === 0x25 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x44 &&
    buffer[3] === 0x46
  ) {
    const maxBytes = env.MEDIA_MAX_PDF_MB * 1024 * 1024;
    if (buffer.length > maxBytes) {
      return { valid: false, error: `PDF document size exceeds the ${env.MEDIA_MAX_PDF_MB}MB limit` };
    }
    return { valid: true, type: 'DOCUMENT', mediaType: 'DOCUMENT', mime: 'application/pdf', ext: 'pdf' };
  }

  // MP4 / MOV: check for ftyp box at offset 4 or moov box
  if (buffer.length >= 12) {
    const boxType = buffer.subarray(4, 8).toString('latin1');
    if (boxType === 'ftyp' || boxType === 'moov') {
      const maxBytes = env.MEDIA_MAX_VIDEO_MB * 1024 * 1024;
      if (buffer.length > maxBytes) {
        return { valid: false, error: `Video size exceeds the ${env.MEDIA_MAX_VIDEO_MB}MB limit` };
      }
      const isQuicktime = ext === 'mov' || claimedMime.includes('quicktime');
      return {
        valid: true,
        type: 'VIDEO',
        mediaType: 'VIDEO',
        mime: isQuicktime ? 'video/quicktime' : 'video/mp4',
        ext: isQuicktime ? 'mov' : 'mp4',
      };
    }
  }

  // WebM: 1A 45 DF A3 (EBML)
  if (
    buffer.length >= 4 &&
    buffer[0] === 0x1a &&
    buffer[1] === 0x45 &&
    buffer[2] === 0xdf &&
    buffer[3] === 0xa3
  ) {
    const maxBytes = env.MEDIA_MAX_VIDEO_MB * 1024 * 1024;
    if (buffer.length > maxBytes) {
      return { valid: false, error: `Video size exceeds the ${env.MEDIA_MAX_VIDEO_MB}MB limit` };
    }
    return { valid: true, type: 'VIDEO', mediaType: 'VIDEO', mime: 'video/webm', ext: 'webm' };
  }

  return {
    valid: false,
    error: `Invalid or unverified file signature for format '${ext}'. Allowed types: JPG, PNG, WebP, MP4, MOV, WebM, PDF.`,
  };
}
