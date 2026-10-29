import { Types } from 'mongoose';
import sharp from 'sharp';
import { spawn } from 'child_process';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { MediaAsset, IMediaAsset, MediaAspectRatio, MediaType, MediaCategory } from '../../models/MediaAsset.js';
import { Project } from '../../models/Project.js';
import { Creative } from '../../models/Creative.js';
import { Campaign } from '../../models/Campaign.js';
import { defaultStorage } from '../../storage/localStorage.adapter.js';
import { AppError } from '../../utils/AppError.js';
import { env } from '../../config/env.js';
import { validateFileSignature } from '../../utils/fileSignature.js';
import { PatchMediaInput } from './validation.js';

export interface MediaListFilter {
  projectId?: string;
  unitId?: string;
  category?: string;
  type?: string;
  tags?: string[];
  aspectRatio?: string;
  approvalStatus?: string;
  search?: string;
  consentedOnly?: boolean;
  page?: number;
  limit?: number;
}

export interface MediaListResult {
  items: IMediaAsset[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

class MediaService {
  private toObjectId(id: Types.ObjectId | string): Types.ObjectId {
    return typeof id === 'string' ? new Types.ObjectId(id) : id;
  }

  private sanitizeFilename(filename: string): string {
    const base = path.basename(filename);
    return base.replace(/[^a-zA-Z0-9._-]/g, '_');
  }

  private async extractVideoPoster(buffer: Buffer, subfolder: string): Promise<string | null> {
    const tempDir = os.tmpdir();
    const tempVideoPath = path.join(tempDir, `vid_${crypto.randomUUID()}.mp4`);
    const tempPosterPath = path.join(tempDir, `poster_${crypto.randomUUID()}.jpg`);

    try {
      await fs.writeFile(tempVideoPath, buffer);

      await new Promise<void>((resolve, reject) => {
        const proc = spawn('ffmpeg', [
          '-y',
          '-ss', '00:00:01',
          '-i', tempVideoPath,
          '-vframes', '1',
          '-f', 'image2',
          tempPosterPath,
        ]);

        proc.on('error', (err) => reject(err));
        proc.on('close', (code) => {
          if (code === 0) resolve();
          else reject(new Error(`ffmpeg exited with code ${code}`));
        });
      });

      const posterBuffer = await fs.readFile(tempPosterPath);
      const posterKey = `${subfolder}/poster_${crypto.randomUUID()}.jpg`;
      await defaultStorage.saveBuffer(posterKey, posterBuffer);
      return posterKey;
    } catch {
      // If ffmpeg is missing or failed, return null (do not fake a thumbnail)
      return null;
    } finally {
      await fs.unlink(tempVideoPath).catch(() => {});
      await fs.unlink(tempPosterPath).catch(() => {});
    }
  }

  public async uploadMedia(
    orgId: Types.ObjectId | string,
    file: {
      buffer: Buffer;
      originalname: string;
      mimetype: string;
      size: number;
    },
    meta: {
      projectId?: string;
      unitId?: string;
      category?: MediaCategory;
      room?: string;
      actualOrIllustrative?: 'ACTUAL' | 'ILLUSTRATIVE';
      rightsConsent?: boolean;
      isCover?: boolean;
      tags?: string[];
      roomType?: string;
      aspectRatio?: MediaAspectRatio;
      approvalStatus?: 'PENDING' | 'APPROVED' | 'REJECTED';
      userId?: string;
    } = {}
  ): Promise<IMediaAsset> {
    const organizationId = this.toObjectId(orgId);

    // 1. Check project file limit if projectId is provided
    let projectObjectId: Types.ObjectId | undefined;
    if (meta.projectId && Types.ObjectId.isValid(meta.projectId)) {
      projectObjectId = new Types.ObjectId(meta.projectId);
      const currentCount = await MediaAsset.countDocuments({
        organizationId,
        projectId: projectObjectId,
      });

      if (currentCount >= env.MEDIA_MAX_FILES_PER_PROJECT) {
        throw AppError.badRequest(
          `Project file limit of ${env.MEDIA_MAX_FILES_PER_PROJECT} files reached`
        );
      }
    }

    // 2. Validate MIME type AND file signature (magic bytes) + enforce size limits
    const detection = validateFileSignature(file.buffer, file.originalname, file.mimetype);
    if (!detection.valid) {
      throw AppError.badRequest(detection.error || 'File validation failed');
    }

    // 3. Generate random storage key (never trust the original filename)
    const sanitizedName = this.sanitizeFilename(file.originalname);
    const subfolder = `org_${organizationId.toString()}`;
    const randomUuid = crypto.randomUUID();
    const ext = path.extname(sanitizedName).toLowerCase() || `.${detection.ext || 'bin'}`;
    const storageKey = `${subfolder}/${randomUuid}${ext}`;

    await defaultStorage.upload(
      {
        buffer: file.buffer,
        filename: sanitizedName,
        mimetype: detection.mime,
      },
      subfolder,
      storageKey
    );

    // 4. Determine media type and generate thumbnails/posters
    const mediaType: MediaType = detection.type || 'IMAGE';
    let width: number | undefined;
    let height: number | undefined;
    let thumbnailKey: string | undefined;
    let posterKey: string | undefined;
    let processingStatus: IMediaAsset['processingStatus'] = 'ready';

    if (mediaType === 'IMAGE') {
      try {
        const metadata = await sharp(file.buffer).metadata();
        width = metadata.width;
        height = metadata.height;

        const thumbBuffer = await sharp(file.buffer)
          .resize(400, 400, { fit: 'inside', withoutEnlargement: true })
          .webp({ quality: 80 })
          .toBuffer();

        const thumbKey = `${subfolder}/thumb_${crypto.randomUUID()}.webp`;
        await defaultStorage.saveBuffer(thumbKey, thumbBuffer);
        thumbnailKey = thumbKey;
      } catch (err) {
        console.warn('Image thumbnail generation warning:', err);
      }
    } else if (mediaType === 'VIDEO') {
      const generatedPoster = await this.extractVideoPoster(file.buffer, subfolder);
      if (generatedPoster) {
        posterKey = generatedPoster;
        thumbnailKey = generatedPoster;
        processingStatus = 'ready';
      } else {
        // If ffmpeg is missing, report processingStatus = "no_poster" (do not fake a thumbnail)
        posterKey = undefined;
        thumbnailKey = undefined;
        processingStatus = 'no_poster';
      }
    }

    // 5. Handle cover image selection
    let isCover = Boolean(meta.isCover);
    if (!isCover && mediaType === 'IMAGE' && projectObjectId) {
      const existingCover = await MediaAsset.exists({
        organizationId,
        projectId: projectObjectId,
        isCover: true,
      });
      if (!existingCover) {
        isCover = true;
      }
    }

    // 6. Next sort order
    let sortOrder = 0;
    if (projectObjectId) {
      sortOrder = await MediaAsset.countDocuments({
        organizationId,
        projectId: projectObjectId,
      });
    }

    // 7. Rights consent
    const rightsConsentConfirmed = meta.rightsConsent !== undefined ? Boolean(meta.rightsConsent) : true;
    const rightsConsent = {
      confirmed: rightsConsentConfirmed,
      by: meta.userId && Types.ObjectId.isValid(meta.userId) ? new Types.ObjectId(meta.userId) : undefined,
      at: rightsConsentConfirmed ? new Date() : undefined,
    };

    // Files without consent cannot be approved for AI or ads
    const approvalStatus = meta.approvalStatus || (rightsConsentConfirmed ? 'APPROVED' : 'PENDING');
    const isApproved = approvalStatus === 'APPROVED' && rightsConsentConfirmed;

    // 8. Create media asset record
    const asset = await MediaAsset.create({
      organizationId,
      projectId: projectObjectId,
      unitId: meta.unitId && Types.ObjectId.isValid(meta.unitId) ? new Types.ObjectId(meta.unitId) : undefined,
      type: mediaType,
      category: meta.category || (mediaType === 'VIDEO' ? 'VIDEOS' : mediaType === 'DOCUMENT' ? 'BROCHURE' : 'EXTERIOR'),
      room: meta.room || meta.roomType,
      filename: sanitizedName,
      storageKey,
      url: `/api/v1/media/file/${storageKey}`,
      mimetype: detection.mime,
      sizeBytes: file.size,
      width,
      height,
      thumbnailKey,
      posterKey,
      processingStatus,
      rightsConsent,
      actualOrIllustrative: meta.actualOrIllustrative || 'ACTUAL',
      approvalStatus,
      isApproved,
      isCover,
      sortOrder,
      aspectRatio: meta.aspectRatio || 'OTHER',
      tags: meta.tags || [],
      roomType: meta.roomType || meta.room,
      uploadedBy: meta.userId && Types.ObjectId.isValid(meta.userId) ? new Types.ObjectId(meta.userId) : undefined,
    });

    // Update Project coverImageUrl if this is cover
    if (isCover && projectObjectId) {
      await MediaAsset.updateMany(
        {
          organizationId,
          projectId: projectObjectId,
          _id: { $ne: asset._id },
        },
        { $set: { isCover: false } }
      );
      await Project.findByIdAndUpdate(projectObjectId, {
        coverImageUrl: `/api/v1/media/${asset._id}/file`,
      });
    }

    return asset;
  }

  public async listMedia(
    orgId: Types.ObjectId | string,
    filter: MediaListFilter = {}
  ): Promise<MediaListResult> {
    const organizationId = this.toObjectId(orgId);
    const query: Record<string, unknown> = { organizationId };

    if (filter.projectId && Types.ObjectId.isValid(filter.projectId)) {
      query.projectId = new Types.ObjectId(filter.projectId);
    }

    if (filter.unitId && Types.ObjectId.isValid(filter.unitId)) {
      query.unitId = new Types.ObjectId(filter.unitId);
    }

    if (filter.category && filter.category !== 'ALL') {
      query.category = filter.category.toUpperCase();
    }

    if (filter.type && filter.type !== 'ALL') {
      query.type = filter.type.toUpperCase();
    }

    if (filter.tags && filter.tags.length > 0) {
      query.tags = { $in: filter.tags };
    }

    if (filter.aspectRatio && filter.aspectRatio !== 'ALL') {
      query.aspectRatio = filter.aspectRatio;
    }

    if (filter.approvalStatus && filter.approvalStatus !== 'ALL') {
      query.approvalStatus = filter.approvalStatus.toUpperCase();
    }

    if (filter.consentedOnly) {
      query['rightsConsent.confirmed'] = true;
      query.approvalStatus = 'APPROVED';
    }

    if (filter.search) {
      query.$or = [
        { filename: { $regex: filter.search, $options: 'i' } },
        { room: { $regex: filter.search, $options: 'i' } },
        { roomType: { $regex: filter.search, $options: 'i' } },
        { tags: { $regex: filter.search, $options: 'i' } },
      ];
    }

    const page = Math.max(1, filter.page || 1);
    const limit = Math.max(1, Math.min(100, filter.limit || 50));
    const skip = (page - 1) * limit;

    const [items, total] = await Promise.all([
      MediaAsset.find(query)
        .sort({ isCover: -1, sortOrder: 1, createdAt: -1 })
        .skip(skip)
        .limit(limit),
      MediaAsset.countDocuments(query),
    ]);

    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
    };
  }

  public async getMediaById(
    orgId: Types.ObjectId | string,
    mediaId: string
  ): Promise<IMediaAsset> {
    const organizationId = this.toObjectId(orgId);
    if (!Types.ObjectId.isValid(mediaId)) {
      throw AppError.notFound('Media asset not found');
    }

    const asset = await MediaAsset.findOne({
      _id: mediaId,
      organizationId,
    });

    if (!asset) {
      throw AppError.notFound('Media asset not found or belongs to another organization');
    }

    return asset;
  }

  public async getMediaFile(
    orgId: Types.ObjectId | string,
    mediaId: string
  ): Promise<{ buffer: Buffer; mimetype: string; filename: string }> {
    const organizationId = this.toObjectId(orgId);
    const asset = await this.getMediaById(organizationId, mediaId);
    const buffer = await defaultStorage.download(asset.storageKey);

    return {
      buffer,
      mimetype: asset.mimetype,
      filename: asset.filename,
    };
  }

  public async patchMedia(
    orgId: Types.ObjectId | string,
    mediaId: string,
    input: PatchMediaInput
  ): Promise<IMediaAsset> {
    const organizationId = this.toObjectId(orgId);
    const asset = await this.getMediaById(organizationId, mediaId);

    if (input.tags) asset.tags = input.tags;
    if (input.roomType !== undefined) {
      asset.roomType = input.roomType;
      asset.room = input.roomType;
    }
    if (input.room !== undefined) {
      asset.room = input.room || undefined;
      asset.roomType = input.room || undefined;
    }
    if (input.aspectRatio) asset.aspectRatio = input.aspectRatio;
    if (input.category) asset.category = input.category;
    if (input.unitId !== undefined) {
      asset.unitId = input.unitId && Types.ObjectId.isValid(input.unitId) ? new Types.ObjectId(input.unitId) : undefined;
    }
    if (input.actualOrIllustrative) asset.actualOrIllustrative = input.actualOrIllustrative;
    if (input.sortOrder !== undefined) asset.sortOrder = input.sortOrder;

    if (input.rightsConsent !== undefined) {
      asset.rightsConsent = {
        confirmed: input.rightsConsent,
        by: asset.rightsConsent?.by,
        at: input.rightsConsent ? new Date() : undefined,
      };
      if (!input.rightsConsent) {
        asset.isApproved = false;
        asset.approvalStatus = 'REJECTED';
      }
    }

    if (input.approvalStatus) {
      asset.approvalStatus = input.approvalStatus;
      asset.isApproved = input.approvalStatus === 'APPROVED';
      if (asset.isApproved && !asset.rightsConsent?.confirmed) {
        asset.rightsConsent = {
          confirmed: true,
          by: asset.rightsConsent?.by,
          at: new Date(),
        };
      }
    }

    if (input.isApproved !== undefined) {
      asset.isApproved = input.isApproved;
      asset.approvalStatus = input.isApproved ? 'APPROVED' : 'REJECTED';
      if (asset.isApproved && !asset.rightsConsent?.confirmed) {
        asset.rightsConsent = {
          confirmed: true,
          by: asset.rightsConsent?.by,
          at: new Date(),
        };
      }
    }

    if (input.isCover !== undefined) {
      if (input.isCover && asset.projectId) {
        await MediaAsset.updateMany(
          {
            organizationId,
            projectId: asset.projectId,
            _id: { $ne: asset._id },
          },
          { $set: { isCover: false } }
        );
        asset.isCover = true;
        await Project.findByIdAndUpdate(asset.projectId, {
          coverImageUrl: `/api/v1/media/${asset._id}/file`,
        });
      } else {
        asset.isCover = input.isCover;
      }
    }

    await asset.save();

    if (asset.projectId) {
      try {
        const { creativeEngineService } = await import('../ai/creativeEngineService.js');
        await creativeEngineService.flagCreativesStale(
          organizationId,
          asset.projectId,
          asset.unitId,
          'Media metadata or approval status modified'
        );
      } catch {
        // Non-blocking
      }
    }

    return asset;
  }

  public async reorderMedia(
    orgId: Types.ObjectId | string,
    projectId: string,
    mediaIds: string[]
  ): Promise<void> {
    const organizationId = this.toObjectId(orgId);
    if (!Types.ObjectId.isValid(projectId)) {
      throw AppError.badRequest('Invalid project ID');
    }

    const updates = mediaIds.map((id, index) => {
      if (!Types.ObjectId.isValid(id)) return null;
      return MediaAsset.updateOne(
        { _id: new Types.ObjectId(id), organizationId, projectId: new Types.ObjectId(projectId) },
        { $set: { sortOrder: index } }
      );
    }).filter(Boolean);

    await Promise.all(updates);
  }

  public async deleteMedia(
    orgId: Types.ObjectId | string,
    mediaId: string,
    force = false
  ): Promise<void> {
    const organizationId = this.toObjectId(orgId);
    const asset = await this.getMediaById(organizationId, mediaId);

    // 1. Soft-check usage in creatives and campaigns
    const referencingCreatives = await Creative.find({
      organizationId,
      $or: [
        { mediaAssetId: asset._id },
        { renderedAssetUrl: asset.url },
        { renderedAssetUrl: `/api/v1/media/${asset._id}/file` },
      ],
    }).select('headline _id').lean();

    const creativeIds = referencingCreatives.map((c) => c._id);
    const referencingCampaigns = await Campaign.find({
      organizationId,
      $or: [
        { creativeId: { $in: creativeIds } },
        { 'details.mediaAssetId': asset._id },
      ],
    }).select('name _id').lean();

    const isInUse = referencingCreatives.length > 0 || referencingCampaigns.length > 0;

    if (isInUse && !force) {
      const conflictErr = AppError.conflict('Asset is currently in use and cannot be removed');
      (conflictErr as unknown as { inUse: unknown }).inUse = {
        creatives: referencingCreatives.map((c) => ({ id: c._id.toString(), name: c.headline })),
        campaigns: referencingCampaigns.map((c) => ({ id: c._id.toString(), name: c.name })),
      };
      throw conflictErr;
    }

    // 2. Unlink if force is confirmed
    if (isInUse && force) {
      await Creative.updateMany(
        {
          organizationId,
          $or: [
            { mediaAssetId: asset._id },
            { renderedAssetUrl: asset.url },
            { renderedAssetUrl: `/api/v1/media/${asset._id}/file` },
          ],
        },
        { $unset: { mediaAssetId: 1, renderedAssetUrl: 1 } }
      );
    }

    // 3. Remove files from storage
    if (asset.storageKey) {
      await defaultStorage.delete(asset.storageKey).catch(() => {});
    }
    if (asset.thumbnailKey) {
      await defaultStorage.delete(asset.thumbnailKey).catch(() => {});
    }
    if (asset.posterKey && asset.posterKey !== asset.thumbnailKey) {
      await defaultStorage.delete(asset.posterKey).catch(() => {});
    }

    // 4. If was cover, reassign or clear project cover
    if (asset.isCover && asset.projectId) {
      const nextCover = await MediaAsset.findOne({
        organizationId,
        projectId: asset.projectId,
        _id: { $ne: asset._id },
        type: 'IMAGE',
      }).sort({ sortOrder: 1, createdAt: 1 });

      if (nextCover) {
        nextCover.isCover = true;
        await nextCover.save();
        await Project.findByIdAndUpdate(asset.projectId, {
          coverImageUrl: `/api/v1/media/${nextCover._id}/file`,
        });
      } else {
        await Project.findByIdAndUpdate(asset.projectId, {
          $unset: { coverImageUrl: 1 },
        });
      }
    }

    await asset.deleteOne();

    if (asset.projectId) {
      try {
        const { creativeEngineService } = await import('../ai/creativeEngineService.js');
        await creativeEngineService.flagCreativesStale(
          organizationId,
          asset.projectId,
          asset.unitId,
          'Media asset deleted from project catalog'
        );
      } catch {
        // Non-blocking
      }
    }
  }
}

export const mediaService = new MediaService();
