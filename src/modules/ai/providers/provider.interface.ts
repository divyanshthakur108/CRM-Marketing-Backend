export interface CaptionPromptData {
  projectName: string;
  category?: string;
  micromarket?: string;
  city?: string;
  address?: string;
  priceDisplay?: string;
  priceMin?: number;
  priceMax?: number;
  reraNumber?: string;
  bhkConfigs?: string[];
  amenities?: string[];
  targetAudience?: string;
  topic?: string;
  creativeBrief?: string;
  channel?: string;
  language?: 'English' | 'Hindi' | 'Hinglish';
  tone?: string;
}

export interface GeneratedCaptionResult {
  headline: string;
  caption: string;
  hashtags: string[];
  language: 'English' | 'Hindi' | 'Hinglish';
  model: string;
}

export interface ImageAnalysisOptions {
  imageBuffer: Buffer;
  mimeType?: string;
  filename?: string;
}

export interface ImageAnalysisResult {
  category: string;
  detectedFeatures: string[];
  lighting: string;
  perspective: string;
  architecturalStyle?: string;
  isFurnished?: boolean;
  dominantColors?: string[];
  summary?: string;
}

export interface GenerateImageOptions {
  prompt: string;
  aspectRatio?: '1:1' | '4:5' | '9:16';
  projectName?: string;
  style?: string;
  sourceImageUrl?: string;
  sourceImageBuffer?: Buffer;
  mode?: 'TEXT_TO_IMAGE' | 'IMAGE_TO_IMAGE' | 'CONTROLNET_DEPTH' | 'VIRTUAL_STAGING' | 'DAY_TO_DUSK';
  strength?: number;
  guidanceScale?: number;
  negativePrompt?: string;
  preserveStructure?: boolean;
  branding?: {
    primaryColor?: string;
    logoUrl?: string;
  };
}

export interface GeneratedImageResult {
  url: string;
  key?: string;
  format: '1:1' | '4:5' | '9:16';
  model: string;
  isIllustrative?: boolean;
  provider?: string;
  isVirtuallyStaged?: boolean;
  structurePreservationScore?: number;
}

export interface ImageToVideoOptions {
  imageUrl?: string;
  firstFrameUrl?: string;
  imageBuffer?: Buffer;
  durationSeconds?: number;
  motionPrompt?: string;
  aspectRatio?: '1:1' | '4:5' | '9:16';
  jobId?: string;
  sceneIndex?: number;
}

export interface GeneratedVideoResult {
  videoUrl: string;
  storageKey?: string;
  durationSeconds: number;
  format: string;
  model: string;
  operationId?: string;
  isIllustrative?: boolean;
}

export interface IAIProvider {
  name: string;
  isConfigured(): boolean;
  generateCaption(data: CaptionPromptData): Promise<GeneratedCaptionResult>;
  generateImage(options: GenerateImageOptions): Promise<GeneratedImageResult>;
  imageToVideo(options: ImageToVideoOptions): Promise<GeneratedVideoResult>;
  analyzeImage?(options: ImageAnalysisOptions): Promise<ImageAnalysisResult>;
  generateImageToImage?(options: GenerateImageOptions): Promise<GeneratedImageResult>;
}
