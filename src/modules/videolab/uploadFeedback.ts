/**
 * Pure functions for upload feedback and shot issue summaries (R1).
 * No AI, no side effects, fast synchronous execution.
 */

export const WARN_LOW_RESOLUTION =
  'Low quality. Looks like a WhatsApp-compressed file. Use the original from the phone.';
export const WARN_HORIZONTAL = 'Horizontal. Vertical gives better results.';
export const WARN_NO_AUDIO = "No sound. Captions from speech won't work.";
export const WARN_LONG_DURATION = 'Only the first 3 minutes are used.';

export interface ClipMetaInput {
  width?: number;
  height?: number;
  hasAudio?: boolean;
  durationSeconds?: number;
}

/**
 * Checks video dimensions, audio track, and duration from ffprobe metadata.
 * Returns human-readable warnings for the user.
 */
export function getClipUploadWarnings(meta: ClipMetaInput): string[] {
  const warnings: string[] = [];

  const w = meta.width ?? 0;
  const h = meta.height ?? 0;

  if (w > 0 && h > 0) {
    const shortSide = Math.min(w, h);
    if (shortSide < 720) {
      warnings.push(WARN_LOW_RESOLUTION);
    }
    if (w > h) {
      warnings.push(WARN_HORIZONTAL);
    }
  }

  if (meta.hasAudio === false) {
    warnings.push(WARN_NO_AUDIO);
  }

  if (meta.durationSeconds && meta.durationSeconds > 180) {
    warnings.push(WARN_LONG_DURATION);
  }

  return warnings;
}

/**
 * Summarizes shot issues (shaky, too_dark, blurry, etc.) into a concise one-line string per clip.
 */
export function summarizeClipIssues(shots?: Array<{ issues?: string[] }>): string | null {
  if (!shots || shots.length === 0) return null;

  const counts = new Map<string, number>();
  for (const s of shots) {
    for (const issue of s.issues || []) {
      const clean = issue.replace(/_/g, ' ').trim();
      counts.set(clean, (counts.get(clean) || 0) + 1);
    }
  }

  if (counts.size === 0) return null;

  const parts: string[] = [];
  // Sort most frequent issues first
  const sorted = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  for (const [name, count] of sorted) {
    parts.push(count > 1 ? `${name} (${count})` : name);
  }

  return `Issues: ${parts.join(', ')}`;
}

/**
 * Soft validation for Indian Real Estate RERA registration numbers.
 * Returns true if the string appears to be a plausibly formatted RERA number.
 */
export function isPlausibleReraNumber(rera?: string): boolean {
  if (!rera) return true;
  const trimmed = rera.trim();
  if (!trimmed) return true;

  // Must contain both letters and digits, at least 6 characters, allowing standard separators
  const hasLetter = /[A-Za-z]/.test(trimmed);
  const hasDigit = /\d/.test(trimmed);
  const validChars = /^[A-Za-z0-9\/\-_. ]{6,60}$/.test(trimmed);

  return hasLetter && hasDigit && validChars;
}

