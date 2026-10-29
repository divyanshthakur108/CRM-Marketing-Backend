export interface IMetaPostParams {
  pageId: string;
  pageAccessToken: string;
  message: string;
  mediaUrl?: string;
  mediaType?: 'IMAGE' | 'VIDEO' | 'CAROUSEL';
  headline?: string;
}

export interface IMetaPostResult {
  postId: string;
  permalinkUrl: string;
}

export interface IMetaCampaignParams {
  adAccountId: string;
  name: string;
  objective: string;
  specialAdCategories: string[];
  status: 'PAUSED' | 'ACTIVE';
}

export interface IMetaAdSetParams {
  adAccountId: string;
  campaignId: string;
  name: string;
  dailyBudget: number;
  targeting: Record<string, unknown>;
  billingEvent?: string;
  optimizationGoal?: string;
  status: 'PAUSED' | 'ACTIVE';
}

export interface IMetaAdCreativeParams {
  adAccountId: string;
  name: string;
  pageId: string;
  message: string;
  imageUrl?: string;
  videoId?: string;
  headline?: string;
  callToAction?: string;
}

export interface IMetaAdParams {
  adAccountId: string;
  adSetId: string;
  creativeId: string;
  name: string;
  status: 'PAUSED' | 'ACTIVE';
}

export interface IMetaExchangeResult {
  accessToken: string;
  tokenExpiry?: Date;
  pages: Array<{ id: string; name: string; accessToken: string }>;
  adAccounts: Array<{ id: string; name: string; currency: string }>;
  instagramAccounts: Array<{ id: string; handle: string }>;
}

export interface IMetaAdapter {
  getAuthorizationUrl(state: string): Promise<string>;
  exchangeCodeForTokens(code: string): Promise<IMetaExchangeResult>;
  publishOrganicPost(params: IMetaPostParams): Promise<IMetaPostResult>;
  createCampaign(params: IMetaCampaignParams): Promise<{ campaignId: string }>;
  createAdSet(params: IMetaAdSetParams): Promise<{ adSetId: string }>;
  createAdCreative(params: IMetaAdCreativeParams): Promise<{ creativeId: string }>;
  createAd(params: IMetaAdParams): Promise<{ adId: string }>;
}
