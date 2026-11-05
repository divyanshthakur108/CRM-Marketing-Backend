/**
 * Builds ASS subtitle files. ASS is rendered by libass + HarfBuzz, which shapes Hindi (Devanagari)
 * and Punjabi (Gurmukhi) correctly, unlike ffmpeg's drawtext.
 */
import { CaptionCue, CaptionLanguage, CaptionStyle } from './recipe.js';

const FONT_LATIN = 'Noto Sans';
const FONT_DEVANAGARI = 'Noto Sans Devanagari';
const FONT_GURMUKHI = 'Noto Sans Gurmukhi';

/** Picks the font from the script actually used in the text (falls back to the language). */
export function fontForText(text: string, language?: CaptionLanguage): string {
  if (/[਀-੿]/.test(text)) return FONT_GURMUKHI;
  if (/[ऀ-ॿ]/.test(text)) return FONT_DEVANAGARI;
  if (language === 'pa' && !/[A-Za-z]/.test(text)) return FONT_GURMUKHI;
  if (language === 'hi' && !/[A-Za-z]/.test(text)) return FONT_DEVANAGARI;
  return FONT_LATIN;
}

/** Devanagari glyphs look smaller than Latin at the same size; scale them up a little to match. */
const SCALE: Record<string, string> = {
  [FONT_LATIN]: '\\fscx100\\fscy100',
  [FONT_DEVANAGARI]: '\\fscx112\\fscy112',
  [FONT_GURMUKHI]: '\\fscx100\\fscy100',
};

function scriptFont(ch: string): string | null {
  if (/[਀-੿]/.test(ch)) return FONT_GURMUKHI;
  if (/[ऀ-ॿ]/.test(ch)) return FONT_DEVANAGARI;
  if (/[A-Za-z]/.test(ch)) return FONT_LATIN;
  return null; // digits, spaces, punctuation: keep the current font
}

/**
 * Splits mixed-script text (e.g. "मोहाली में 3 BHK") into runs, each with its own font,
 * so English words don't fall back to a mismatched font inside Hindi/Punjabi lines.
 */
export function withFontRuns(text: string, language?: CaptionLanguage): string {
  let current = fontForText(text, language);
  let out = `{\\fn${current}${SCALE[current]}}`;
  for (const ch of text) {
    const font = scriptFont(ch);
    if (font && font !== current) {
      current = font;
      out += `{\\fn${font}${SCALE[font]}}`;
    }
    out += ch;
  }
  return out;
}

/** '#RRGGBB' + alpha (0 = opaque, 255 = transparent) → ASS '&HAABBGGRR' */
export function assColor(hex: string, alpha = 0): string {
  const h = hex.replace('#', '');
  const [r, g, b] = [h.slice(0, 2), h.slice(2, 4), h.slice(4, 6)];
  const a = alpha.toString(16).padStart(2, '0');
  return `&H${a}${b}${g}${r}`.toUpperCase();
}

export function escapeAssText(text: string): string {
  return text.replace(/\\/g, '').replace(/[{}]/g, '').replace(/\r?\n/g, ' ').trim();
}

export function formatAssTime(seconds: number): string {
  // Work in whole centiseconds to avoid floating-point drift (e.g. 9.95 → 9.94)
  const total = Math.round(Math.max(0, seconds) * 100);
  const cs = total % 100;
  const sec = Math.floor(total / 100) % 60;
  const m = Math.floor(total / 6000) % 60;
  const h = Math.floor(total / 360000);
  return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

const HEADER = `[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding`;

const EVENTS = `[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text`;

/**
 * Captions (evenly timed over the video) + optional text watermark for the main video.
 * Returns null when there is nothing to draw.
 */
export function buildMainAss(params: {
  durationSeconds: number;
  captions: { language: CaptionLanguage; style: CaptionStyle; lines: string[] } | null;
  /** Timed captions on the merged timeline (from speech). When given, these are used instead of `lines`. */
  cues?: CaptionCue[];
  watermarkText?: string;
}): string | null {
  const { durationSeconds, captions, cues, watermarkText } = params;
  const events: string[] = [];

  if (captions) {
    const style = captions.style === 'BOXED' ? 'CaptionBoxed' : 'CaptionOutline';
    const timed: CaptionCue[] = cues?.length
      ? cues
      : captions.lines.map((text, i, all) => {
          // Typed lines: spread evenly over the video
          const per = durationSeconds / all.length;
          return { start: i * per, end: (i + 1) * per - 0.05, text };
        });
    for (const cue of timed) {
      const text = escapeAssText(cue.text);
      if (!text || cue.start >= durationSeconds) continue;
      const end = Math.min(cue.end, durationSeconds);
      events.push(
        `Dialogue: 1,${formatAssTime(cue.start)},${formatAssTime(end)},${style},,0,0,0,,{\\fad(120,120)}${withFontRuns(text, captions.language)}`
      );
    }
  }

  if (watermarkText) {
    const text = escapeAssText(watermarkText);
    events.push(
      `Dialogue: 0,${formatAssTime(0)},${formatAssTime(durationSeconds)},Watermark,,0,0,0,,${withFontRuns(text)}`
    );
  }

  if (!events.length) return null;

  const styles = [
    // Bottom-centre captions, kept above Instagram's bottom UI (MarginV 420)
    `Style: CaptionBoxed,${FONT_LATIN},58,&H00FFFFFF,&H000000FF,&H59000000,&H59000000,-1,0,0,0,100,100,0,0,4,16,0,2,90,90,420,1`,
    `Style: CaptionOutline,${FONT_LATIN},62,&H00FFFFFF,&H000000FF,&H00000000,&H64000000,-1,0,0,0,100,100,0,0,1,5,2,2,90,90,420,1`,
    // Top-right org name when there's no logo
    `Style: Watermark,${FONT_LATIN},34,&H33FFFFFF,&H000000FF,&H80000000,&H00000000,-1,0,0,0,100,100,0,0,1,2,0,9,0,48,72,1`,
  ];

  return `${HEADER}\n${styles.join('\n')}\n\n${EVENTS}\n${events.join('\n')}\n`;
}

/** Text for the end card: project name, org name, phone and RERA (the last two only if provided). */
export function buildEndCardAss(params: {
  seconds: number;
  projectName: string;
  orgName: string;
  phone?: string;
  rera?: string;
  accentHex: string;
  textHex: string;
  hasLogo: boolean;
}): string {
  const { seconds, projectName, orgName, phone, rera, accentHex, textHex, hasLogo } = params;
  const start = formatAssTime(0);
  const end = formatAssTime(seconds);
  const top = hasLogo ? 1040 : 820;

  const line = (y: number, style: string, text: string, fadeMs: number) => {
    const t = escapeAssText(text);
    return `Dialogue: 0,${start},${end},${style},,0,0,0,,{\\an5\\pos(540,${y})\\fad(${fadeMs},0)}${withFontRuns(t)}`;
  };

  const events = [line(top, 'Title', projectName, 250), line(top + 110, 'Sub', orgName, 350)];
  let y = top + 260;
  if (phone) {
    events.push(line(y, 'Info', `Call / WhatsApp: ${phone}`, 450));
    y += 80;
  }
  if (rera) {
    events.push(line(y, 'Small', `RERA: ${rera}`, 500));
  }

  const text = assColor(textHex);
  const accent = assColor(accentHex);
  const styles = [
    `Style: Title,${FONT_LATIN},76,${text},&H000000FF,&H00000000,&H00000000,-1,0,0,0,100,100,1,0,1,0,0,5,60,60,0,1`,
    `Style: Sub,${FONT_LATIN},44,${accent},&H000000FF,&H00000000,&H00000000,-1,0,0,0,100,100,2,0,1,0,0,5,60,60,0,1`,
    `Style: Info,${FONT_LATIN},42,${text},&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,5,60,60,0,1`,
    `Style: Small,${FONT_LATIN},32,${assColor(textHex, 0x40)},&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,5,60,60,0,1`,
  ];

  return `${HEADER}\n${styles.join('\n')}\n\n${EVENTS}\n${events.join('\n')}\n`;
}
