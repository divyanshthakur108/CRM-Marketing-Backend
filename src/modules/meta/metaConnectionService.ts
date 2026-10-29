import { MetaConnection, IMetaConnection } from '../../models/MetaConnection.js';
import { getMetaAdapter } from './adapters/index.js';
import { encryptToken, decryptToken } from '../../utils/crypto.js';
import { AppError } from '../../utils/AppError.js';
import { logger } from '../../config/logger.js';
import { env } from '../../config/env.js';

export class MetaConnectionService {
  /**
   * Generates OAuth authorization URL.
   */
  async getConnectUrl(organizationId: string): Promise<{ url: string; state: string; adapterMode: string }> {
    const adapter = getMetaAdapter();
    const state = JSON.stringify({ orgId: organizationId, timestamp: Date.now() });
    const url = await adapter.getAuthorizationUrl(state);
    return {
      url,
      state,
      adapterMode: env.META_ADAPTER,
    };
  }

  /**
   * Handles OAuth callback, exchanges authorization code for tokens, encrypts tokens, and stores them.
   */
  async handleCallback(organizationId: string, code: string): Promise<IMetaConnection> {
    const adapter = getMetaAdapter();
    const result = await adapter.exchangeCodeForTokens(code);

    const primaryPage = result.pages[0] || {
      id: 'mock_page_default',
      name: 'RealCRM Default Page',
      accessToken: 'EAAB_MOCK_FALLBACK',
    };

    const primaryAdAccount = result.adAccounts[0] || {
      id: 'act_mock_default',
      name: 'RealCRM Ad Manager',
      currency: 'INR',
    };

    const primaryIg = result.instagramAccounts[0] || {
      id: 'mock_ig_default',
      handle: '@realcrm_official',
    };

    // Encrypt Page Access Token using AES-256-GCM
    const encryptedPageToken = encryptToken(primaryPage.accessToken);

    const connection = await MetaConnection.findOneAndUpdate(
      { organizationId },
      {
        $set: {
          facebookPage: {
            pageId: primaryPage.id,
            pageName: primaryPage.name,
            accessToken: encryptedPageToken,
            connected: true,
          },
          instagramAccount: {
            accountId: primaryIg.id,
            handle: primaryIg.handle,
            connected: true,
          },
          adAccount: {
            accountId: primaryAdAccount.id,
            name: primaryAdAccount.name,
            currency: primaryAdAccount.currency || 'INR',
            connected: true,
          },
          systemUserActive: true,
          tokenExpiresAt: result.tokenExpiry || new Date(Date.now() + 60 * 24 * 3600 * 1000),
        },
      },
      { upsert: true, new: true }
    );

    logger.info({ organizationId }, 'Meta accounts connected successfully and token encrypted');
    return connection;
  }

  /**
   * Retrieves connection status for tenant without exposing unencrypted secrets.
   */
  async getConnectionStatus(organizationId: string) {
    const conn = await MetaConnection.findOne({ organizationId });

    if (!conn) {
      return {
        connected: false,
        adapterMode: env.META_ADAPTER,
        facebookPage: { connected: false, pageId: '', pageName: '' },
        instagramAccount: { connected: false, accountId: '', handle: '' },
        adAccount: { connected: false, accountId: '', name: '', currency: 'INR' },
        systemUserActive: false,
        disclaimer:
          'Live Meta Marketing API publishing requires Meta App Review and verified permissions. Running in simulated Mock Adapter mode.',
      };
    }

    // Mask encrypted token preview
    const hasToken = Boolean(conn.facebookPage.accessToken);
    let tokenPreview = 'None';
    if (hasToken) {
      try {
        const decrypted = decryptToken(conn.facebookPage.accessToken!);
        tokenPreview = `${decrypted.slice(0, 8)}...${decrypted.slice(-4)}`;
      } catch {
        tokenPreview = 'Encrypted (AES-256-GCM)';
      }
    }

    return {
      connected: conn.facebookPage.connected || conn.adAccount.connected,
      adapterMode: env.META_ADAPTER,
      facebookPage: {
        connected: conn.facebookPage.connected,
        pageId: conn.facebookPage.pageId,
        pageName: conn.facebookPage.pageName,
        tokenPreview,
      },
      instagramAccount: {
        connected: conn.instagramAccount.connected,
        accountId: conn.instagramAccount.accountId,
        handle: conn.instagramAccount.handle,
      },
      adAccount: {
        connected: conn.adAccount.connected,
        accountId: conn.adAccount.accountId,
        name: conn.adAccount.name,
        currency: conn.adAccount.currency,
      },
      systemUserActive: conn.systemUserActive,
      tokenExpiresAt: conn.tokenExpiresAt,
      disclaimer:
        'Live Meta Marketing API publishing requires Meta App Review and verified business permissions. Active in Mock Mode for development & simulation.',
    };
  }

  /**
   * Disconnects Meta integration and wipes tokens.
   */
  async disconnect(organizationId: string): Promise<void> {
    await MetaConnection.findOneAndUpdate(
      { organizationId },
      {
        $set: {
          'facebookPage.connected': false,
          'facebookPage.accessToken': '',
          'instagramAccount.connected': false,
          'adAccount.connected': false,
          systemUserActive: false,
        },
      }
    );
    logger.info({ organizationId }, 'Meta integration disconnected');
  }

  /**
   * Helper to retrieve decrypted page access token for publishing.
   */
  async getDecryptedPageAccessToken(organizationId: string): Promise<string> {
    const conn = await MetaConnection.findOne({ organizationId });
    if (!conn || !conn.facebookPage.connected || !conn.facebookPage.accessToken) {
      throw new AppError(
        422,
        'FACEBOOK_PAGE_NOT_CONNECTED',
        'Facebook Page is not connected. Connect Meta integration first.'
      );
    }
    return decryptToken(conn.facebookPage.accessToken);
  }
}

export const metaConnectionService = new MetaConnectionService();
