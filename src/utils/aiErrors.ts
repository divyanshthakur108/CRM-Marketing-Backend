import { AppError } from './AppError.js';

/**
 * Turns any AI provider failure into a clear AppError for the user.
 * The app never substitutes placeholder or template output when AI fails.
 */

export function aiNotConfigured(feature = 'AI generation'): AppError {
  return new AppError(
    503,
    'AI_NOT_CONFIGURED',
    `${feature} is unavailable: no Gemini API key is configured. Add GEMINI_API_KEY to the backend .env.`
  );
}

export function toAiError(err: unknown, feature = 'AI generation'): AppError {
  if (err instanceof AppError) return err;

  const raw = err instanceof Error ? err.message : typeof err === 'string' ? err : JSON.stringify(err);
  const msg = raw || 'Unknown error';
  const lower = msg.toLowerCase();

  if (lower.includes('blocked by provider') || lower.includes('safety') || lower.includes('policy')) {
    return new AppError(
      422,
      'AI_SAFETY_BLOCKED',
      `${feature} was blocked by Gemini's safety filters. Try a different photo or prompt.`,
      { providerMessage: msg }
    );
  }
  // Daily limit (free tier: a small number of requests per model per day)
  if ((lower.includes('quota') || lower.includes('"code":429')) && /per day|perday|per_day/.test(lower)) {
    return new AppError(
      429,
      'AI_DAILY_LIMIT',
      `${feature} is unavailable: this Gemini API key has used up its free daily limit. Try again tomorrow, or enable billing in Google AI Studio (https://aistudio.google.com) to remove the limit.`,
      { providerMessage: msg }
    );
  }
  // Per-minute limit (free tier allows only a few requests per minute): temporary, not a billing problem.
  // "limit: 0" means the model isn't available on this key at all (billing), so that falls through.
  if ((lower.includes('quota') || lower.includes('"code":429')) && /perminute|per_minute|per minute|retry in|retrydelay/.test(lower) && !/limit:\s*0\b/.test(lower)) {
    return new AppError(
      429,
      'AI_RATE_LIMITED',
      `${feature} hit Gemini's requests-per-minute limit (free tier). Wait about a minute and try again.`,
      { providerMessage: msg }
    );
  }
  if (lower.includes('resource_exhausted') || lower.includes('quota') || lower.includes('"code":429') || lower.includes('billing')) {
    return new AppError(
      402,
      'AI_QUOTA_EXCEEDED',
      `${feature} is unavailable: the Gemini API quota is used up or billing is not enabled for this API key. Enable billing in Google AI Studio (https://aistudio.google.com) and try again.`,
      { providerMessage: msg }
    );
  }
  if (lower.includes('api_key_invalid') || lower.includes('api key not valid') || lower.includes('permission_denied') || lower.includes('"code":403') || lower.includes('"code":401')) {
    return new AppError(
      503,
      'AI_KEY_INVALID',
      `${feature} is unavailable: the Gemini API key is invalid or doesn't have access to this model.`,
      { providerMessage: msg }
    );
  }
  if (lower.includes('not_found') || lower.includes('"code":404') || lower.includes('no longer available') || lower.includes('is not found')) {
    return new AppError(
      503,
      'AI_MODEL_UNAVAILABLE',
      `${feature} is unavailable: the configured Gemini model is not available for this API key.`,
      { providerMessage: msg }
    );
  }
  if (lower.includes('"code":503') || lower.includes('unavailable') || lower.includes('overloaded') || lower.includes('high demand')) {
    return new AppError(503, 'AI_BUSY', `${feature} failed: Gemini is overloaded right now. Please try again in a minute.`, {
      providerMessage: msg,
    });
  }
  if (lower.includes('timed out') || lower.includes('timeout') || lower.includes('deadline')) {
    return new AppError(504, 'AI_TIMEOUT', `${feature} timed out waiting for Gemini. Please try again.`, {
      providerMessage: msg,
    });
  }
  return new AppError(502, 'AI_FAILED', `${feature} failed: Gemini returned an error.`, { providerMessage: msg });
}
