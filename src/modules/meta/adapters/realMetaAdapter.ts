import {
  IMetaAdapter,
  IMetaPostParams,
  IMetaPostResult,
  IMetaCampaignParams,
  IMetaAdSetParams,
  IMetaAdCreativeParams,
  IMetaAdParams,
  IMetaExchangeResult,
} from './meta.adapter.interface.js';
import { logger } from '../../../config/logger.js';

interface MetaApiError {
  message?: string;
  type?: string;
  code?: number;
  error_subcode?: number;
}

interface MetaOAuthTokenResponse {
  access_token?: string;
  token_type?: string;
  expires_in?: number;
  error?: MetaApiError;
}

interface MetaPageItem {
  id: string;
  name: string;
  access_token: string;
}

interface MetaAccountsResponse {
  data?: MetaPageItem[];
  error?: MetaApiError;
}

interface MetaAdAccountItem {
  id?: string;
  account_id?: string;
  name?: string;
  currency?: string;
}

interface MetaAdAccountsResponse {
  data?: MetaAdAccountItem[];
  error?: MetaApiError;
}

interface MetaEntityResponse {
  id?: string;
  error?: MetaApiError;
}

/**
 * Real Meta Graph API Adapter.
 *
 * IMPORTANT & HONEST NOTICE:
 * Live Meta Marketing API publishing requires:
 * 1. Meta Developer App in "Live" mode.
 * 2. Passed Meta App Review for: pages_manage_posts, pages_read_engagement, ads_management, ads_read, leads_retrieval.
 * 3. Verified Meta Business Manager (Tier 1/2).
 * 4. System User Access Token with assigned Ad Account and Page assets.
 *
 * For development, simulation, and CI testing without approved Meta credentials,
 * use MockMetaAdapter (META_ADAPTER=mock).
 */
export class RealMetaAdapter implements IMetaAdapter {
  private apiVersion = 'v19.0';
  private baseUrl = `https://graph.facebook.com/${this.apiVersion}`;

  async getAuthorizationUrl(state: string): Promise<string> {
    const appId = process.env.META_APP_ID || '';
    const redirectUri = encodeURIComponent(
      process.env.META_REDIRECT_URI || 'http://localhost:5173/connections/callback'
    );
    const scope = encodeURIComponent(
      'pages_manage_posts,pages_read_engagement,ads_management,leads_retrieval'
    );
    return `https://www.facebook.com/${this.apiVersion}/dialog/oauth?client_id=${appId}&redirect_uri=${redirectUri}&state=${encodeURIComponent(
      state
    )}&scope=${scope}`;
  }

  async exchangeCodeForTokens(code: string): Promise<IMetaExchangeResult> {
    const appId = process.env.META_APP_ID;
    const appSecret = process.env.META_APP_SECRET;
    const redirectUri = process.env.META_REDIRECT_URI || 'http://localhost:5173/connections/callback';

    if (!appId || !appSecret) {
      throw new Error(
        'Meta App ID and App Secret must be configured in environment for live OAuth exchange. Set META_ADAPTER=mock for development/simulation.'
      );
    }

    try {
      const tokenUrl = `${this.baseUrl}/oauth/access_token?client_id=${appId}&redirect_uri=${encodeURIComponent(
        redirectUri
      )}&client_secret=${appSecret}&code=${encodeURIComponent(code)}`;

      const res = await fetch(tokenUrl);
      const data = (await res.json()) as MetaOAuthTokenResponse;

      if (!res.ok || data.error) {
        throw new Error(data.error?.message || 'Meta OAuth token exchange failed');
      }

      const userAccessToken = data.access_token;
      if (!userAccessToken) {
        throw new Error('Meta OAuth exchange did not return an access token');
      }

      // Fetch accounts (Pages)
      const accountsRes = await fetch(`${this.baseUrl}/me/accounts?access_token=${userAccessToken}`);
      const accountsData = (await accountsRes.json()) as MetaAccountsResponse;
      const pages = (accountsData.data || []).map((p: MetaPageItem) => ({
        id: p.id,
        name: p.name,
        accessToken: p.access_token,
      }));

      // Fetch Ad Accounts
      const adAccountsRes = await fetch(
        `${this.baseUrl}/me/adaccounts?fields=name,account_id,currency&access_token=${userAccessToken}`
      );
      const adAccountsData = (await adAccountsRes.json()) as MetaAdAccountsResponse;
      const adAccounts = (adAccountsData.data || []).map((a: MetaAdAccountItem) => ({
        id: a.id || `act_${a.account_id}`,
        name: a.name || 'Meta Ad Account',
        currency: a.currency || 'INR',
      }));

      return {
        accessToken: userAccessToken,
        tokenExpiry: data.expires_in
          ? new Date(Date.now() + data.expires_in * 1000)
          : new Date(Date.now() + 60 * 24 * 3600 * 1000),
        pages,
        adAccounts,
        instagramAccounts: [],
      };
    } catch (err: unknown) {
      logger.error({ err }, 'RealMetaAdapter OAuth exchange error');
      throw err;
    }
  }

  async publishOrganicPost(params: IMetaPostParams): Promise<IMetaPostResult> {
    const url = `${this.baseUrl}/${params.pageId}/feed`;
    const body: Record<string, string> = {
      message: params.message,
      access_token: params.pageAccessToken,
    };
    if (params.mediaUrl) {
      body.link = params.mediaUrl;
    }

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const data = (await res.json()) as MetaEntityResponse;
    if (!res.ok || data.error) {
      throw new Error(data.error?.message || 'Failed to publish organic post to Facebook Page');
    }

    return {
      postId: data.id || '',
      permalinkUrl: `https://www.facebook.com/${params.pageId}/posts/${data.id}`,
    };
  }

  async createCampaign(params: IMetaCampaignParams): Promise<{ campaignId: string }> {
    const url = `${this.baseUrl}/${params.adAccountId}/campaigns`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: params.name,
        objective: params.objective,
        special_ad_categories: params.specialAdCategories,
        status: params.status,
      }),
    });

    const data = (await res.json()) as MetaEntityResponse;
    if (!res.ok || data.error) {
      throw new Error(data.error?.message || 'Meta API create campaign failed');
    }

    return { campaignId: data.id || '' };
  }

  async createAdSet(params: IMetaAdSetParams): Promise<{ adSetId: string }> {
    const url = `${this.baseUrl}/${params.adAccountId}/adsets`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: params.name,
        campaign_id: params.campaignId,
        daily_budget: params.dailyBudget * 100, // Meta requires budget in subunits (paise / cents)
        billing_event: params.billingEvent || 'IMPRESSIONS',
        optimization_goal: params.optimizationGoal || 'LEAD_GENERATION',
        targeting: params.targeting,
        status: params.status,
      }),
    });

    const data = (await res.json()) as MetaEntityResponse;
    if (!res.ok || data.error) {
      throw new Error(data.error?.message || 'Meta API create ad set failed');
    }

    return { adSetId: data.id || '' };
  }

  async createAdCreative(params: IMetaAdCreativeParams): Promise<{ creativeId: string }> {
    const url = `${this.baseUrl}/${params.adAccountId}/adcreatives`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: params.name,
        object_story_spec: {
          page_id: params.pageId,
          link_data: {
            message: params.message,
            link: params.imageUrl || 'https://realcrm.in',
            image_hash: params.imageUrl,
            name: params.headline || params.name,
            call_to_action: {
              type: params.callToAction || 'LEARN_MORE',
            },
          },
        },
      }),
    });

    const data = (await res.json()) as MetaEntityResponse;
    if (!res.ok || data.error) {
      throw new Error(data.error?.message || 'Meta API create ad creative failed');
    }

    return { creativeId: data.id || '' };
  }

  async createAd(params: IMetaAdParams): Promise<{ adId: string }> {
    const url = `${this.baseUrl}/${params.adAccountId}/ads`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: params.name,
        adset_id: params.adSetId,
        creative: { creative_id: params.creativeId },
        status: params.status,
      }),
    });

    const data = (await res.json()) as MetaEntityResponse;
    if (!res.ok || data.error) {
      throw new Error(data.error?.message || 'Meta API create ad failed');
    }

    return { adId: data.id || '' };
  }
}

export const realMetaAdapter = new RealMetaAdapter();
