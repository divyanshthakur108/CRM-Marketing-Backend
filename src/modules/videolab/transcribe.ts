import fsp from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { getAIProvider } from '../ai/providers/index.js';
import { defaultStorage } from '../../storage/localStorage.adapter.js';
import { probeMedia, runFfmpeg } from '../../utils/ffmpeg.js';
import { AppError } from '../../utils/AppError.js';
import { env } from '../../config/env.js';
import { CaptionCue, CaptionLanguage, cleanCues } from './recipe.js';
import { MAX_ANALYZE_SECONDS } from './analyze.js';

export interface ClipTranscript {
  clipKey: string;
  language: CaptionLanguage;
  hasSpeech: boolean;
  spokenLanguage?: string;
  cues: CaptionCue[];
  model: string;
  ms: number;
}

/** How the captions must be written for each caption language */
const SCRIPT_RULES: Record<CaptionLanguage, string> = {
  hi: 'Write the captions in Hindi using Devanagari script (देवनागरी). Common English real-estate words (BHK, flat, sq ft, RERA, site visit) may stay in English letters. If the speaker is not speaking Hindi, translate faithfully into Hindi.',
  pa: 'Write the captions in Punjabi using Gurmukhi script (ਗੁਰਮੁਖੀ). Common English real-estate words (BHK, flat, sq ft, RERA) may stay in English letters. If the speaker is not speaking Punjabi, translate faithfully into Punjabi.',
  hinglish:
    'Write the captions in Hinglish: Hindi/Punjabi words written in Roman (English) letters exactly as spoken, e.g. "Aapka sapno ka ghar ab ready hai". Keep English words in English. Do NOT use Devanagari or Gurmukhi.',
  en: 'Write the captions in English. If the speaker is speaking Hindi, Punjabi or another language, translate faithfully into simple English.',
};

/** Same limit as clip understanding: smart cut can use any part of the first 3 minutes */
const MAX_SECONDS = MAX_ANALYZE_SECONDS;

/**
 * Listens to the speech in a Lab clip and returns short timed captions (via Gemini audio understanding).
 * Never invents text: no speech → hasSpeech false and no cues.
 */
export async function transcribeClip(clipKey: string, language: CaptionLanguage): Promise<ClipTranscript> {
  const started = Date.now();
  const clipPath = await defaultStorage.ensureLocal(clipKey);
  const probe = await probeMedia(clipPath);
  if (!probe.hasAudio) {
    throw AppError.badRequest('This clip has no sound, so there is no speech to turn into captions.', 'CLIP_HAS_NO_AUDIO');
  }
  const seconds = Math.min(probe.durationSeconds || MAX_SECONDS, MAX_SECONDS);

  // Small mono MP3 of the part of the clip that will be used in the video
  const scratch = path.resolve(process.cwd(), 'storage', 'scratch', `transcribe-${crypto.randomUUID()}`);
  await fsp.mkdir(scratch, { recursive: true });
  const audioPath = path.join(scratch, 'speech.mp3');
  let audio: Buffer;
  try {
    await runFfmpeg([
      '-hide_banner', '-loglevel', 'error', '-y',
      '-i', clipPath,
      '-t', String(MAX_SECONDS),
      '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'libmp3lame', '-b:a', '48k',
      audioPath,
    ]);
    audio = await fsp.readFile(audioPath);
  } finally {
    await fsp.rm(scratch, { recursive: true, force: true }).catch(() => undefined);
  }

  const prompt = `You are a professional subtitle writer for Indian real-estate videos.
Listen to the attached audio (${seconds.toFixed(1)} seconds long). The speaker is usually Indian and may mix Hindi, Punjabi and English.

Task: write burned-in captions for exactly what is spoken.
${SCRIPT_RULES[language]}

Rules:
- Only use words that are actually spoken. Do not add, summarize or invent anything (no prices, offers or claims that were not said).
- Split into short captions of at most 6 words each, at natural pauses. Caption the whole audio, start to end.
- "start" and "end" are seconds from the start of the audio (0.1s precision) and must match when those words are spoken. All times must be between 0 and ${seconds.toFixed(1)}.
- Ignore music, background noise and non-speech sounds.
- If there is no clear speech, return "hasSpeech": false and an empty "segments" list.

Return only JSON in this exact shape:
{"hasSpeech": true, "spokenLanguage": "Hindi", "segments": [{"start": 0.0, "end": 1.8, "text": "..."}]}`;

  const result = await getAIProvider().generateJson<{
    hasSpeech?: boolean;
    spokenLanguage?: string;
    segments?: Array<{ start: number; end: number; text: string }>;
  }>(prompt, {
    images: [{ data: audio, mimeType: 'audio/mp3' }],
    feature: 'Captions from speech',
  });

  const cues = cleanCues(Array.isArray(result?.segments) ? result.segments : [], seconds);
  return {
    clipKey,
    language,
    hasSpeech: Boolean(result?.hasSpeech) && cues.length > 0,
    ...(result?.spokenLanguage ? { spokenLanguage: String(result.spokenLanguage) } : {}),
    cues,
    model: env.GEMINI_TEXT_MODEL,
    ms: Date.now() - started,
  };
}
