/**
 * Test-only wiring: replace Gemini with a local fake so tests never call the real AI API.
 * The running app has no fake AI mode; this fake exists only under tests/.
 */
import { setAIProviderOverride } from '../src/modules/ai/providers/index.js';
import { MockAIProvider } from './fakes/fakeAIProvider.js';

setAIProviderOverride(new MockAIProvider());
