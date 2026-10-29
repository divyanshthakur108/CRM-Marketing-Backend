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

export class MockMetaAdapter implements IMetaAdapter {
  private idCounter = 1000;
  public simulateFailureOnStep: 'CAMPAIGN' | 'AD_SET' | 'CREATIVE' | 'AD' | 'ORGANIC' | null = null;
  public simulatedErrorMessage: string = 'Simulated Meta API 504 Gateway Timeout';

  // Call tracking for assertions in tests
  public calls = {
    campaign: 0,
    adSet: 0,
    creative: 0,
    ad: 0,
    organic: 0,
  };

  public resetCallCounts(): void {
    this.calls = {
      campaign: 0,
      adSet: 0,
      creative: 0,
      ad: 0,
      organic: 0,
    };
    this.simulateFailureOnStep = null;
  }

  public setSimulatedFailure(
    step: 'CAMPAIGN' | 'AD_SET' | 'CREATIVE' | 'AD' | 'ORGANIC' | null,
    errorMessage: string = 'Simulated Meta API 504 Gateway Timeout'
  ): void {
    this.simulateFailureOnStep = step;
    this.simulatedErrorMessage = errorMessage;
  }

  async getAuthorizationUrl(state: string): Promise<string> {
    return `https://www.facebook.com/v19.0/dialog/oauth?client_id=mock_meta_app_id&redirect_uri=http%3A%2F%2Flocalhost%3A5173%2Fconnections%2Fcallback&state=${encodeURIComponent(
      state
    )}&scope=pages_manage_posts,pages_read_engagement,ads_management,leads_retrieval`;
  }

  async exchangeCodeForTokens(code: string): Promise<IMetaExchangeResult> {
    if (!code) {
      throw new Error('OAuth authorization code is required for token exchange');
    }

    const tokenSuffix = Math.random().toString(36).substring(2, 10);
    return {
      accessToken: `EAAB_MOCK_USER_TOKEN_${tokenSuffix}`,
      tokenExpiry: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000), // 60 days
      pages: [
        {
          id: 'mock_page_101',
          name: 'Apex Imperial Tower Official',
          accessToken: `EAAB_MOCK_PAGE_TOKEN_${tokenSuffix}`,
        },
      ],
      adAccounts: [
        {
          id: 'act_mock_9001',
          name: 'Apex Developments Ad Manager',
          currency: 'INR',
        },
      ],
      instagramAccounts: [
        {
          id: 'mock_ig_501',
          handle: '@apex_developments',
        },
      ],
    };
  }

  async publishOrganicPost(params: IMetaPostParams): Promise<IMetaPostResult> {
    this.calls.organic++;

    if (this.simulateFailureOnStep === 'ORGANIC') {
      throw new Error(this.simulatedErrorMessage);
    }

    const postId = `mock_post_${++this.idCounter}`;
    return {
      postId,
      permalinkUrl: `https://www.facebook.com/${params.pageId}/posts/${postId}`,
    };
  }

  async createCampaign(_params: IMetaCampaignParams): Promise<{ campaignId: string }> {
    this.calls.campaign++;

    if (this.simulateFailureOnStep === 'CAMPAIGN') {
      throw new Error(this.simulatedErrorMessage);
    }

    const campaignId = `mock_camp_${++this.idCounter}`;
    return { campaignId };
  }

  async createAdSet(_params: IMetaAdSetParams): Promise<{ adSetId: string }> {
    this.calls.adSet++;

    if (this.simulateFailureOnStep === 'AD_SET') {
      throw new Error(this.simulatedErrorMessage);
    }

    const adSetId = `mock_adset_${++this.idCounter}`;
    return { adSetId };
  }

  async createAdCreative(_params: IMetaAdCreativeParams): Promise<{ creativeId: string }> {
    this.calls.creative++;

    if (this.simulateFailureOnStep === 'CREATIVE') {
      throw new Error(this.simulatedErrorMessage);
    }

    const creativeId = `mock_crea_${++this.idCounter}`;
    return { creativeId };
  }

  async createAd(_params: IMetaAdParams): Promise<{ adId: string }> {
    this.calls.ad++;

    if (this.simulateFailureOnStep === 'AD') {
      throw new Error(this.simulatedErrorMessage);
    }

    const adId = `mock_ad_${++this.idCounter}`;
    return { adId };
  }
}

export const mockMetaAdapter = new MockMetaAdapter();
