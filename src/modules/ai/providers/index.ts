import { IAIProvider } from './provider.interface.js';
import { aiOrchestrator } from './aiProviderOrchestrator.js';

export * from './provider.interface.js';
export * from './geminiProvider.js';
export * from './falAiProvider.js';
export * from './replicateAiProvider.js';
export * from './enhancedLocalProvider.js';
export * from './aiProviderOrchestrator.js';

// Tests swap in a fake provider here (see tests/setup.ts). The app uses the orchestrator (Gemini + image providers).
let providerOverride: IAIProvider | null = null;

export function setAIProviderOverride(provider: IAIProvider | null): void {
  providerOverride = provider;
}

/** Returns the AI provider. Failures surface as clear errors (AI_NOT_CONFIGURED, ...), never as fake output. */
export function getAIProvider(): IAIProvider {
  return providerOverride ?? aiOrchestrator;
}
