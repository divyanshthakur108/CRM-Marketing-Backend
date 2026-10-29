import { IWhatsAppAdapter } from './types.js';
import { mockWhatsAppAdapter } from './mockWhatsAppAdapter.js';

export * from './types.js';
export * from './mockWhatsAppAdapter.js';

export function getWhatsAppAdapter(): IWhatsAppAdapter {
  return mockWhatsAppAdapter;
}
