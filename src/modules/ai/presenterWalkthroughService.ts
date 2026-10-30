import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { Types } from 'mongoose';
import sharp from 'sharp';
import { Project, IProject } from '../../models/Project.js';
import { PropertyUnit, IPropertyUnit } from '../../models/PropertyUnit.js';
import { MediaAsset, IMediaAsset } from '../../models/MediaAsset.js';
import { Creative, ICreative } from '../../models/Creative.js';
import { Organization } from '../../models/Organization.js';
import { BrandProfile } from '../../models/BrandProfile.js';
import { Subscription } from '../../models/Subscription.js';
import { Notification } from '../../models/Notification.js';
import { defaultStorage } from '../../storage/localStorage.adapter.js';
import { presenterScriptService, PresenterScriptResult } from './presenterScriptService.js';
import { voiceoverService } from './voiceoverService.js';
import { logger } from '../../config/logger.js';

export interface GeneratePresenterWalkthroughParams {
  organizationId: string | Types.ObjectId;
  projectId: string | Types.ObjectId;
  unitId?: string | Types.ObjectId;
  userId?: string;
  language?: 'English' | 'Hindi' | 'Hinglish';
  stylePreset?: 'HERITAGE_LUXURY' | 'HIGH_GROWTH_ROI';
  presenterAssetId?: string;
  selectedAssetIds?: string[];
}

export class PresenterWalkthroughService {
  /**
   * Resolves ffmpeg binary
   */
  private resolveFfmpegBinary(): string {
    if (process.env.FFMPEG_PATH && fsSync.existsSync(process.env.FFMPEG_PATH)) {
      return process.env.FFMPEG_PATH;
    }
    const localAppData =
      process.env.LOCALAPPDATA ||
      (process.env.USERPROFILE ? path.join(process.env.USERPROFILE, 'AppData', 'Local') : '');

    if (localAppData) {
      const wingetDir = path.join(localAppData, 'Microsoft', 'WinGet', 'Packages');
      if (fsSync.existsSync(wingetDir)) {
        try {
          const packages = fsSync.readdirSync(wingetDir);
          for (const pkg of packages) {
            if (pkg.toLowerCase().includes('ffmpeg')) {
              const pkgPath = path.join(wingetDir, pkg);
              const findExe = (dir: string, depth = 0): string | null => {
                if (depth > 3) return null;
                const entries = fsSync.readdirSync(dir, { withFileTypes: true });
                for (const entry of entries) {
                  const full = path.join(dir, entry.name);
                  if (entry.isFile() && entry.name.toLowerCase() === 'ffmpeg.exe') {
                    return full;
                  }
                  if (entry.isDirectory()) {
                    const res = findExe(full, depth + 1);
                    if (res) return res;
                  }
                }
                return null;
              };
              const found = findExe(pkgPath);
              if (found) return found;
            }
          }
        } catch {
          // ignore
        }
      }
    }
    return 'ffmpeg';
  }

  /**
   * Helper to load media image buffer
   */
  private async loadAssetBuffer(asset: IMediaAsset): Promise<Buffer> {
    if (asset.storageKey) {
      try {
        const localPath = defaultStorage.getAbsolutePath(asset.storageKey);
        if (fsSync.existsSync(localPath)) {
          return await fs.readFile(localPath);
        }
      } catch {
        // Fall through
      }
    }

    if (asset.url && asset.url.startsWith('http')) {
      try {
        const resp = await fetch(asset.url, { signal: AbortSignal.timeout(8000) });
        if (resp.ok) {
          const arrayBuf = await resp.arrayBuffer();
          return Buffer.from(arrayBuf);
        }
      } catch {
        // Fall through
      }
    }

    // High quality architectural placeholder
    return sharp({
      create: {
        width: 1080,
        height: 1920,
        channels: 4,
        background: { r: 15, g: 23, b: 42, alpha: 1 },
      },
    })
      .png()
      .toBuffer();
  }

  /**
   * Creates circular presenter avatar badge with gold or cyan glowing border
   */
  private async createPresenterAvatarBadge(
    avatarBuffer: Buffer | null,
    stylePreset: 'HERITAGE_LUXURY' | 'HIGH_GROWTH_ROI',
    hostName = 'Property Advisor'
  ): Promise<Buffer> {
    const isRoi = stylePreset === 'HIGH_GROWTH_ROI';
    const borderColor = isRoi ? '#06B6D4' : '#D97706';
    const badgeBg = isRoi ? '#0B1325' : '#0F172A';
    const dotColor = isRoi ? '#22D3EE' : '#F59E0B';

    const width = 360;
    const height = 110;

    let headshotPng: Buffer;
    if (avatarBuffer) {
      headshotPng = await sharp(avatarBuffer)
        .resize(80, 80, { fit: 'cover', position: 'center' })
        .composite([
          {
            input: Buffer.from(`
              <svg width="80" height="80" xmlns="http://www.w3.org/2000/svg">
                <circle cx="40" cy="40" r="40" fill="#000000"/>
              </svg>
            `),
            blend: 'dest-in',
          },
        ])
        .png()
        .toBuffer();
    } else {
      // Sleek default presenter avatar vector
      const defaultAvatarSvg = `
        <svg width="80" height="80" xmlns="http://www.w3.org/2000/svg">
          <circle cx="40" cy="40" r="39" fill="${badgeBg}" stroke="${borderColor}" stroke-width="2"/>
          <circle cx="40" cy="30" r="16" fill="${borderColor}" fill-opacity="0.85"/>
          <path d="M16 68 C16 52 26 48 40 48 C54 48 64 52 64 68 Z" fill="${borderColor}" fill-opacity="0.85"/>
        </svg>
      `;
      headshotPng = await sharp(Buffer.from(defaultAvatarSvg)).png().toBuffer();
    }

    const badgeContainerSvg = `
      <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <filter id="badgeShadow" x="-10%" y="-10%" width="120%" height="120%">
            <feDropShadow dx="0" dy="4" stdDeviation="6" flood-color="#000000" flood-opacity="0.45"/>
          </filter>
        </defs>
        <!-- Pill Container -->
        <rect x="0" y="5" width="${width}" height="100" rx="50" fill="${badgeBg}" fill-opacity="0.94" stroke="${borderColor}" stroke-width="2" filter="url(#badgeShadow)"/>
        <!-- Verified Host Label -->
        <g transform="translate(100, 32)">
          <circle cx="6" cy="6" r="4" fill="${dotColor}"/>
          <text x="18" y="10" font-family="Inter, -apple-system, sans-serif" font-size="12" font-weight="700" fill="${borderColor}" letter-spacing="1">VERIFIED HOST</text>
          <text x="6" y="34" font-family="Inter, -apple-system, sans-serif" font-size="16" font-weight="800" fill="#FFFFFF">${hostName}</text>
          <text x="6" y="52" font-family="Inter, -apple-system, sans-serif" font-size="11" font-weight="500" fill="#94A3B8">Live Guided Walkthrough</text>
        </g>
      </svg>
    `;

    return sharp(Buffer.from(badgeContainerSvg))
      .composite([
        {
          input: headshotPng,
          top: 15,
          left: 12,
        },
      ])
      .png()
      .toBuffer();
  }

  /**
   * Generates a lower-third overlay PNG for an act
   */
  private async createLowerThirdPng(params: {
    actNumber: number;
    actTitle: string;
    headline: string;
    subline: string;
    stylePreset: 'HERITAGE_LUXURY' | 'HIGH_GROWTH_ROI';
  }): Promise<Buffer> {
    const { actNumber, actTitle, headline, subline, stylePreset } = params;
    const isRoi = stylePreset === 'HIGH_GROWTH_ROI';
    const accentColor = isRoi ? '#06B6D4' : '#D97706';
    const darkBg = isRoi ? '#08172E' : '#0B132B';
    const sublineColor = isRoi ? '#38BDF8' : '#FDE68A';

    const escapeXml = (s?: string) =>
      (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

    const svg = `
      <svg width="984" height="170" viewBox="0 0 984 170" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="ltGrad" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stop-color="${darkBg}" stop-opacity="0.96"/>
            <stop offset="100%" stop-color="#020617" stop-opacity="0.92"/>
          </linearGradient>
          <filter id="ltShadow" x="-5%" y="-5%" width="110%" height="120%">
            <feDropShadow dx="0" dy="6" stdDeviation="10" flood-color="#000000" flood-opacity="0.5"/>
          </filter>
        </defs>
        <!-- Card Backdrop -->
        <rect x="0" y="0" width="984" height="170" rx="20" fill="url(#ltGrad)" stroke="${accentColor}" stroke-opacity="0.4" stroke-width="1.5" filter="url(#ltShadow)"/>
        <!-- Accent left border bar -->
        <rect x="0" y="24" width="8" height="122" rx="4" fill="${accentColor}"/>
        
        <!-- Act Pill -->
        <g transform="translate(32, 24)">
          <rect x="0" y="0" width="${Math.max(120, actTitle.length * 9 + 48)}" height="26" rx="6" fill="${accentColor}" fill-opacity="0.18" stroke="${accentColor}" stroke-width="1"/>
          <text x="14" y="17.5" font-family="Inter, -apple-system, sans-serif" font-size="11" font-weight="700" fill="${accentColor}" letter-spacing="1.2">ACT ${actNumber}: ${escapeXml(actTitle.toUpperCase())}</text>
        </g>

        <!-- Main Headline -->
        <text x="32" y="94" font-family="Inter, -apple-system, sans-serif" font-size="28" font-weight="800" fill="#FFFFFF">${escapeXml(headline)}</text>
        
        <!-- Subline Specs -->
        <text x="32" y="132" font-family="Inter, -apple-system, sans-serif" font-size="17" font-weight="600" fill="${sublineColor}">${escapeXml(subline)}</text>
      </svg>
    `;

    return sharp(Buffer.from(svg)).png().toBuffer();
  }

  /**
   * Main Pipeline: Generates a Complete Presenter Walkthrough Video Reel (9:16)
   */
  public async generatePresenterWalkthroughVideo(
    params: GeneratePresenterWalkthroughParams
  ): Promise<ICreative> {
    const {
      organizationId,
      projectId,
      unitId,
      userId,
      language = 'Hinglish',
      stylePreset = 'HERITAGE_LUXURY',
      presenterAssetId,
      selectedAssetIds,
    } = params;

    const orgId = typeof organizationId === 'string' ? new Types.ObjectId(organizationId) : organizationId;
    const pId = typeof projectId === 'string' ? new Types.ObjectId(projectId) : projectId;
    const uId = unitId ? (typeof unitId === 'string' ? new Types.ObjectId(unitId) : unitId) : undefined;

    // 1. Credit Check
    let subscription = await Subscription.findOne({ organizationId: orgId });
    if (!subscription) {
      subscription = await Subscription.create({
        organizationId: orgId,
        plan: 'GROWTH',
        status: 'ACTIVE',
        creditsAllocated: 5000,
        creditsRemaining: 5000,
      });
    }

    if (subscription.creditsRemaining < 5) {
      throw new Error('Insufficient credits: Presenter Walkthrough video requires 5 credits');
    }

    // 2. Fetch Project & Inventory Details
    const project = await Project.findOne({ _id: pId, organizationId: orgId });
    if (!project) throw new Error('Project not found');

    const unit = uId ? await PropertyUnit.findOne({ _id: uId, organizationId: orgId }) : null;
    const organization = await Organization.findById(orgId);
    const brand = await BrandProfile.findOne({ organizationId: orgId });

    // 3. Select Photos for the 4 Acts
    let candidateMedia = await MediaAsset.find({
      organizationId: orgId,
      projectId: pId,
      'rightsConsent.confirmed': true,
      $or: [{ isApproved: true }, { approvalStatus: 'APPROVED' }],
      type: 'IMAGE',
    });

    if (selectedAssetIds && selectedAssetIds.length > 0) {
      const explicitMedia = await MediaAsset.find({
        _id: { $in: selectedAssetIds.map((id) => new Types.ObjectId(id)) },
        organizationId: orgId,
      });
      if (explicitMedia.length > 0) {
        candidateMedia = explicitMedia;
      }
    }

    if (candidateMedia.length === 0) {
      throw new Error('needs photos: No approved image assets available to create presenter walkthrough');
    }

    // Match 4 distinct photos
    const matchesTag = (m: IMediaAsset, re: RegExp) => {
      const str = [m.room, m.roomType, m.category, ...(m.tags || []), m.filename].filter(Boolean).join(' ');
      return re.test(str);
    };

    const usedIds = new Set<string>();
    const actPhotos: IMediaAsset[] = [];

    const pickBest = (re: RegExp): IMediaAsset | null => {
      const found = candidateMedia.find((m) => !usedIds.has(m._id.toString()) && matchesTag(m, re));
      if (found) {
        usedIds.add(found._id.toString());
        return found;
      }
      return null;
    };

    // Act 1: Exterior / Facade
    const exterior = pickBest(/facade|exterior|cover|elevation|building/i) || candidateMedia[0];
    usedIds.add(exterior._id.toString());
    actPhotos.push(exterior);

    // Act 2: Living Room
    const living = pickBest(/living|hall|drawing|lounge/i) || candidateMedia.find((m) => !usedIds.has(m._id.toString())) || exterior;
    usedIds.add(living._id.toString());
    actPhotos.push(living);

    // Act 3: Master Bedroom / Kitchen
    const bedOrKitchen = pickBest(/bed|master|bedroom|suite|kitchen/i) || candidateMedia.find((m) => !usedIds.has(m._id.toString())) || living;
    usedIds.add(bedOrKitchen._id.toString());
    actPhotos.push(bedOrKitchen);

    // Act 4: Balcony / Amenity / Terrace
    const balconyOrAmenity = pickBest(/balcony|terrace|view|pool|clubhouse|gym|garden/i) || candidateMedia.find((m) => !usedIds.has(m._id.toString())) || exterior;
    actPhotos.push(balconyOrAmenity);

    // 4. Generate 4-Act Presenter Script
    const details = (project.details || {}) as Record<string, any>;
    const scriptResult: PresenterScriptResult = await presenterScriptService.generateScript({
      projectName: project.name || 'Luxury Residences',
      category: project.category,
      subtype: project.subtype,
      city: project.location?.city || details.city || 'Mohali',
      state: project.location?.state || details.state || 'Punjab',
      sectorOrLocation: details.sector || project.location?.address || 'Sector 66 / Airport Road',
      bhk: unit?.unitType || details.bhk ? `${details.bhk} BHK` : '3 BHK',
      areaSqFt: unit?.carpetAreaSqFt || unit?.superBuiltUpAreaSqFt || details.carpetAreaSqFt || '1850',
      priceDisplay: unit?.price ? `₹ ${(unit.price / 10000000).toFixed(2)} Cr*` : details.priceRange || '₹ 1.25 Cr Onwards',
      amenities: project.amenities || ['Clubhouse', 'Swimming Pool', 'Security'],
      reraNumber: project.reraNumber,
      salesPhone: project.ownerContacts?.[0]?.phone || '+91 77103-80077',
      salesOfficeName: project.ownerContacts?.[0]?.name || organization?.name || 'Experience Centre',
      language,
      stylePreset,
    });

    // 5. Synthesize Voiceover Audio
    const fullSpeech = scriptResult.acts.map((a) => a.speech).join('. ');
    logger.info({ speechLen: fullSpeech.length, language }, 'Synthesizing presenter voiceover audio');

    const voiceover = await voiceoverService.synthesizeSpeech(fullSpeech, { language });
    const audioDuration = Math.max(12, voiceover.durationSeconds);
    const sceneDuration = audioDuration / 4;
    const fps = 25;

    logger.info({ audioDuration, sceneDuration }, 'Voiceover audio synthesized successfully');

    // 6. Setup Temp Workspace
    const tempDir = path.resolve(process.cwd(), 'storage', 'scratch', `presenter-${Date.now()}`);
    await fs.mkdir(tempDir, { recursive: true });

    const creativeId = new Types.ObjectId();
    const videoKey = `creatives/${orgId.toString()}/${creativeId.toString()}/presenter_walkthrough_9x16.mp4`;
    const posterKey = `creatives/${orgId.toString()}/${creativeId.toString()}/poster_frame.jpg`;

    const outputVideoPath = defaultStorage.getAbsolutePath(videoKey);
    const outputPosterPath = defaultStorage.getAbsolutePath(posterKey);
    await fs.mkdir(path.dirname(outputVideoPath), { recursive: true });

    // Save audio file locally
    const audioPath = path.join(tempDir, 'narration.mp3');
    await fs.writeFile(audioPath, voiceover.buffer);

    // 7. Render Lower-Third PNGs and Presenter Avatar Badge
    let presenterAvatarBuffer: Buffer | null = null;
    if (presenterAssetId) {
      const pAsset = await MediaAsset.findById(presenterAssetId);
      if (pAsset) presenterAvatarBuffer = await this.loadAssetBuffer(pAsset);
    } else {
      const candidateAvatar = candidateMedia.find((m) => /presenter|host|avatar|agent|founder/i.test([m.room, ...(m.tags || [])].join(' ')));
      if (candidateAvatar) {
        presenterAvatarBuffer = await this.loadAssetBuffer(candidateAvatar);
      }
    }

    const hostName = project.ownerContacts?.[0]?.name || organization?.name || 'Property Host';
    const avatarBadgeBuf = await this.createPresenterAvatarBadge(presenterAvatarBuffer, stylePreset, hostName);
    const avatarBadgePath = path.join(tempDir, 'avatar_badge.png');
    await fs.writeFile(avatarBadgePath, avatarBadgeBuf);

    // Save 4 act images and their corresponding lower-third banners
    const actImagePaths: string[] = [];
    const lowerThirdPaths: string[] = [];

    for (let i = 0; i < 4; i++) {
      const act = scriptResult.acts[i] || scriptResult.acts[0];
      const photoAsset = actPhotos[i] || actPhotos[0];

      // 1080x1920 base photo
      const rawPhoto = await this.loadAssetBuffer(photoAsset);
      const imgPath = path.join(tempDir, `act_photo_${i}.jpg`);
      await sharp(rawPhoto)
        .resize(1080, 1920, { fit: 'cover', position: 'center' })
        .jpeg({ quality: 90 })
        .toFile(imgPath);
      actImagePaths.push(imgPath);

      // Lower-third banner
      const ltBuf = await this.createLowerThirdPng({
        actNumber: act.actNumber,
        actTitle: act.actTitle,
        headline: act.lowerThird.headline,
        subline: act.lowerThird.subline,
        stylePreset,
      });
      const ltPath = path.join(tempDir, `lt_${i}.png`);
      await fs.writeFile(ltPath, ltBuf);
      lowerThirdPaths.push(ltPath);
    }

    // 8. Composite 9:16 Video using FFmpeg
    const ffmpegBin = this.resolveFfmpegBinary();
    const clipFrames = Math.ceil(sceneDuration * fps);
    const fadeDuration = 0.5;

    // Build filter_complex
    // Inputs:
    // 0..3: Act Photos (actImagePaths)
    // 4..7: Lower-Third Banners (lowerThirdPaths)
    // 8: Presenter Avatar Badge (avatarBadgePath)
    // 9: Voiceover Audio (audioPath)

    const filterParts: string[] = [];

    // For each act: apply zoompan + overlay lower third
    for (let i = 0; i < 4; i++) {
      const zp =
        i % 2 === 0
          ? `zoompan=z='min(zoom+0.0012,1.25)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${clipFrames}:s=1080x1920:fps=${fps}`
          : `zoompan=z='if(lte(zoom,1.0),1.0,max(1.0,zoom-0.0015))':x='trunc(iw/2-(iw/zoom/2)+((iw/zoom/5)*${i % 2 === 0 ? 1 : -1}*(on/${clipFrames})))':y='ih/2-(ih/zoom/2)':d=${clipFrames}:s=1080x1920:fps=${fps}`;

      filterParts.push(`[${i}:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,${zp}[bg${i}]`);
      // Overlay lower third at bottom
      filterParts.push(`[bg${i}][${4 + i}:v]overlay=48:H-240[actclip${i}]`);
    }

    // Crossfade the 4 act clips
    filterParts.push(`[actclip0][actclip1]xfade=transition=fade:duration=${fadeDuration}:offset=${(sceneDuration - fadeDuration).toFixed(2)}[x1]`);
    filterParts.push(`[x1][actclip2]xfade=transition=fade:duration=${fadeDuration}:offset=${(sceneDuration * 2 - fadeDuration).toFixed(2)}[x2]`);
    filterParts.push(`[x2][actclip3]xfade=transition=fade:duration=${fadeDuration}:offset=${(sceneDuration * 3 - fadeDuration).toFixed(2)}[x3]`);

    // Overlay Presenter Badge at top-left: x=48, y=64
    filterParts.push(`[x3][8:v]overlay=48:64[vout]`);

    const filterComplex = filterParts.join(';');

    const ffmpegArgs: string[] = [];
    // 0..3: Photos
    for (const p of actImagePaths) {
      ffmpegArgs.push('-loop', '1', '-t', String(sceneDuration + fadeDuration + 0.2), '-i', p);
    }
    // 4..7: Lower-Thirds
    for (const lt of lowerThirdPaths) {
      ffmpegArgs.push('-loop', '1', '-t', String(sceneDuration + fadeDuration + 0.2), '-i', lt);
    }
    // 8: Presenter Badge
    ffmpegArgs.push('-loop', '1', '-t', String(audioDuration + 1), '-i', avatarBadgePath);
    // 9: Audio Track
    ffmpegArgs.push('-i', audioPath);

    ffmpegArgs.push(
      '-filter_complex', filterComplex,
      '-map', '[vout]',
      '-map', '9:a',
      '-c:v', 'libx264',
      '-preset', 'fast',
      '-crf', '22',
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac',
      '-b:a', '192k',
      '-t', String(audioDuration),
      '-r', String(fps),
      '-y',
      outputVideoPath
    );

    logger.info({ binary: ffmpegBin, outputVideoPath }, 'Executing FFmpeg Presenter Walkthrough Video rendering');

    await new Promise<void>((resolve, reject) => {
      const proc = spawn(ffmpegBin, ffmpegArgs);
      let stderr = '';
      proc.stderr?.on('data', (d: Buffer) => { stderr += d.toString(); });
      proc.on('error', reject);
      proc.on('exit', (code) => {
        if (code === 0) {
          resolve();
        } else {
          logger.error({ stderr: stderr.slice(-800) }, 'Presenter video FFmpeg failed');
          reject(new Error(`FFmpeg exited with code ${code}. Last stderr: ${stderr.slice(-300)}`));
        }
      });
    });

    // Extract poster frame thumbnail at 1.0s
    await new Promise<void>((resolve) => {
      const proc = spawn(ffmpegBin, [
        '-ss', '1.0',
        '-i', outputVideoPath,
        '-vframes', '1',
        '-q:v', '2',
        '-y',
        outputPosterPath,
      ]);
      proc.on('exit', () => resolve());
      proc.on('error', () => resolve());
    });

    // 9. Create Creative in MongoDB
    const videoUrl = `/storage/${videoKey}`;
    const posterUrl = fsSync.existsSync(outputPosterPath) ? `/storage/${posterKey}` : null;

    const sourceAssetIds = actPhotos.map((p) => p._id as Types.ObjectId);

    const creative = await Creative.create({
      _id: creativeId,
      organizationId: orgId,
      projectId: pId,
      unitId: uId,
      type: 'REEL',
      format: '9:16',
      renderedAssetUrl: videoUrl,
      posterFrameUrl: posterUrl,
      files: [
        {
          ratio: '9:16',
          url: videoUrl,
          storageKey: videoKey,
          mimeType: 'video/mp4',
        },
      ],
      sourceAssetIds,
      generatedBy: 'ai',
      isIllustrative: false,
      cost: 5,
      status: 'ready_for_review',
      approvalStatus: 'PENDING_APPROVAL',
      version: 1,
      stylePreset,
      isPresenterWalkthrough: true,
      presenterScript: scriptResult,
      headline: scriptResult.headline,
      caption: scriptResult.caption,
      hashtags: scriptResult.hashtags,
      language,
      history: [
        {
          version: 1,
          headline: scriptResult.headline,
          caption: scriptResult.caption,
          hashtags: scriptResult.hashtags,
          renderedAssetUrl: videoUrl,
          files: [{ ratio: '9:16', url: videoUrl, storageKey: videoKey, mimeType: 'video/mp4' }],
          sourceAssetIds,
          generatedBy: 'ai',
          status: 'ready_for_review',
          cost: 5,
          approvalStatus: 'PENDING_APPROVAL',
          generatedAt: new Date(),
        },
      ],
    });

    // 10. Deduct Credits
    subscription.creditsRemaining = Math.max(0, subscription.creditsRemaining - 5);
    await subscription.save();

    // 11. Notification
    try {
      await Notification.create({
        organizationId: orgId,
        title: `Presenter Walkthrough Video Ready: ${project.name}`,
        message: `4-Act Presenter Walkthrough video with voiceover synthesized and ready for client review.`,
        category: 'APPROVAL_REQUIRED',
        link: `/studio?projectId=${project._id.toString()}`,
      });
    } catch {
      // ignore
    }

    // Clean up tempDir
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }

    return creative;
  }
}

export const presenterWalkthroughService = new PresenterWalkthroughService();
