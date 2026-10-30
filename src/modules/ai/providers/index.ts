import { env } from '../../../config/env.js';
import { IAIProvider } from './provider.interface.js';
import { MockAIProvider } from './mockProvider.js';
import { GeminiAIProvider } from './geminiProvider.js';
import { FalAiProvider } from './falAiProvider.js';
import { ReplicateAiProvider } from './replicateAiProvider.js';
import { EnhancedLocalProvider } from './enhancedLocalProvider.js';
import { AIProviderOrchestrator, aiOrchestrator } from './aiProviderOrchestrator.js';

export * from './provider.interface.js';
export * from './mockProvider.js';
export * from './geminiProvider.js';
export * from './falAiProvider.js';
export * from './replicateAiProvider.js';
export * from './enhancedLocalProvider.js';
export * from './aiProviderOrchestrator.js';

export function getAIProvider(): IAIProvider {
  return aiOrchestrator;
}
