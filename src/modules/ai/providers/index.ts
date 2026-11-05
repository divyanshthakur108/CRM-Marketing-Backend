import { IAIProvider } from './provider.interface.js';
import { GeminiAIProvider } from './geminiProvider.js';

export * from './provider.interface.js';
export * from './geminiProvider.js';

// Tests swap in a fake provider here (see tests/setup.ts). The app itself only ever uses Gemini.
let providerOverride: IAIProvider | null = null;

export function setAIProviderOverride(provider: IAIProvider | null): void {
  providerOverride = provider;
}

/** Returns the Gemini provider. When Gemini isn't configured, its methods throw AI_NOT_CONFIGURED. */
export function getAIProvider(): IAIProvider {
  return providerOverride ?? new GeminiAIProvider();
}
