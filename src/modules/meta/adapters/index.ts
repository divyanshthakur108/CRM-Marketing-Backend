import { env } from '../../../config/env.js';
import { IMetaAdapter } from './meta.adapter.interface.js';
import { mockMetaAdapter } from './mockMetaAdapter.js';
import { realMetaAdapter } from './realMetaAdapter.js';
import { logger } from '../../../config/logger.js';

export function getMetaAdapter(): IMetaAdapter {
  if (env.META_ADAPTER === 'meta') {
    logger.info('Using RealMetaAdapter for Meta Marketing API');
    return realMetaAdapter;
  }
  return mockMetaAdapter;
}

export * from './meta.adapter.interface.js';
export { mockMetaAdapter, MockMetaAdapter } from './mockMetaAdapter.js';
export { realMetaAdapter, RealMetaAdapter } from './realMetaAdapter.js';
