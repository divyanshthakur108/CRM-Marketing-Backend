import { env } from '../../../config/env.js';
import { IAIProvider } from './provider.interface.js';
import { MockAIProvider } from './mockProvider.js';
import { GeminiAIProvider } from './geminiProvider.js';

export * from './provider.interface.js';
export * from './mockProvider.js';
export * from './geminiProvider.js';

export function getAIProvider(): IAIProvider {
  if (env.AI_PROVIDER === 'gemini') {
    return new GeminiAIProvider();
  }
  return new MockAIProvider();
}
