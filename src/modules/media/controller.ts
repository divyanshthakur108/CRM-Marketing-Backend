import { Request, Response } from 'express';
import { Types } from 'mongoose';
import fsPromises from 'fs/promises';
import { mediaService } from './service.js';
import { patchMediaSchema } from './validation.js';
import { AppError } from '../../utils/AppError.js';
import { MediaAsset, MediaAspectRatio, MediaCategory } from '../../models/MediaAsset.js';
import { Membership } from '../../models/Membership.js';
import { defaultStorage } from '../../storage/localStorage.adapter.js';

class MediaController {
  private async verifyUserOrgAccess(req: Request, assetOrgId: Types.ObjectId): Promise<void> {
    if (!req.user) {
      throw AppError.unauthorized('Authentication required', 'AUTHENTICATION_REQUIRED');
    }

    if (req.user.isPlatformAdmin) {
      return;
    }

    const membership = await Membership.findOne({
      organizationId: assetOrgId,
      userId: req.user.userId,
      status: 'ACTIVE',
    });

    if (!membership) {
      // 404 prevents cross-tenant file discovery (Org B cannot detect Org A files)
      throw AppError.notFound('Media asset not found');
    }
  }

  private async streamStorageFile(
    key: string,
    mimetype: string,
    filename: string,
    req: Request,
    res: Response
  ): Promise<void> {
    const filePath = defaultStorage.getAbsolutePath(key);
    let stat;
    try {
      stat = await fsPromises.stat(filePath);
    } catch {
      throw AppError.notFound('Media file not found in storage');
    }

    const fileSize = stat.size;
    const range = req.headers.range;

    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Type', mimetype);
    res.setHeader('Cache-Control', 'public, max-age=86400');

    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

      if (isNaN(start) || start >= fileSize || end >= fileSize || start > end) {
        res.status(416).setHeader('Content-Range', `bytes */${fileSize}`).end();
        return;
      }

      const chunkSize = end - start + 1;
      const stream = defaultStorage.createReadStream(key, { start, end });
      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkSize,
        'Content-Type': mimetype,
      });
      stream.pipe(res);
    } else {
      res.setHeader('Content-Length', fileSize);
      res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(filename)}"`);
      const stream = defaultStorage.createReadStream(key);
      stream.pipe(res);
    }
  }

  public uploadMedia = async (req: Request, res: Response): Promise<void> => {
    if (!req.membership) {
      throw AppError.forbidden('Organization membership required');
    }

    if (!req.file) {
      throw AppError.badRequest('No media file provided');
    }

    let parsedTags: string[] = [];
    if (req.body.tags) {
      if (Array.isArray(req.body.tags)) {
        parsedTags = req.body.tags;
      } else if (typeof req.body.tags === 'string') {
        try {
          parsedTags = JSON.parse(req.body.tags);
        } catch {
          parsedTags = req.body.tags.split(',').map((t: string) => t.trim()).filter(Boolean);
        }
      }
    }

    const rightsConsentConfirmed =
      req.body.rightsConsent !== undefined
        ? req.body.rightsConsent === true ||
          req.body.rightsConsent === 'true' ||
          req.body.rightsConsent === 1 ||
          req.body.rightsConsent === '1'
        : true;

    const isCover =
      req.body.isCover === true ||
      req.body.isCover === 'true' ||
      req.body.isCover === 1 ||
      req.body.isCover === '1';

    const asset = await mediaService.uploadMedia(
      req.membership.organizationId,
      {
        buffer: req.file.buffer,
        originalname: req.file.originalname,
        mimetype: req.file.mimetype,
        size: req.file.size,
      },
      {
        projectId: req.body.projectId,
        unitId: req.body.unitId,
        category: req.body.category as MediaCategory,
        room: req.body.room || req.body.roomType,
        actualOrIllustrative: req.body.actualOrIllustrative,
        rightsConsent: rightsConsentConfirmed,
        isCover,
        tags: parsedTags,
        roomType: req.body.roomType || req.body.room,
        aspectRatio: req.body.aspectRatio as MediaAspectRatio,
        approvalStatus: req.body.approvalStatus,
        userId: req.user?.userId,
      }
    );

    res.status(201).json({
      success: true,
      data: asset,
      message: 'Media asset uploaded successfully',
    });
  };

  public listMedia = async (req: Request, res: Response): Promise<void> => {
    if (!req.membership) {
      throw AppError.forbidden('Organization membership required');
    }

    const { projectId, unitId, category, type, tags, aspectRatio, approvalStatus, search, page, limit, consentedOnly } = req.query;
    let tagList: string[] | undefined;
    if (typeof tags === 'string') {
      tagList = tags.split(',').map((t) => t.trim()).filter(Boolean);
    }

    const result = await mediaService.listMedia(req.membership.organizationId, {
      projectId: projectId as string,
      unitId: unitId as string,
      category: category as string,
      type: type as string,
      tags: tagList,
      aspectRatio: aspectRatio as string,
      approvalStatus: approvalStatus as string,
      search: search as string,
      consentedOnly: consentedOnly === 'true',
      page: page ? parseInt(page as string, 10) : 1,
      limit: limit ? parseInt(limit as string, 10) : 50,
    });

    res.status(200).json({
      success: true,
      data: result.items,
      pagination: {
        total: result.total,
        page: result.page,
        limit: result.limit,
        totalPages: result.totalPages,
      },
    });
  };

  public getMedia = async (req: Request, res: Response): Promise<void> => {
    if (!req.membership) {
      throw AppError.forbidden('Organization membership required');
    }

    const asset = await mediaService.getMediaById(
      req.membership.organizationId,
      req.params.id
    );

    res.status(200).json({
      success: true,
      data: asset,
    });
  };

  public getMediaFile = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;
    if (!Types.ObjectId.isValid(id)) {
      throw AppError.notFound('Media asset not found');
    }

    const asset = await MediaAsset.findById(id);
    if (!asset) {
      throw AppError.notFound('Media asset not found');
    }

    // Authenticated & Organization check
    await this.verifyUserOrgAccess(req, asset.organizationId);

    await this.streamStorageFile(asset.storageKey, asset.mimetype, asset.filename, req, res);
  };

  public getMediaThumbnail = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;
    if (!Types.ObjectId.isValid(id)) {
      throw AppError.notFound('Media asset not found');
    }

    const asset = await MediaAsset.findById(id);
    if (!asset) {
      throw AppError.notFound('Media asset not found');
    }

    // Authenticated & Organization check
    await this.verifyUserOrgAccess(req, asset.organizationId);

    const thumbKey = asset.thumbnailKey || asset.posterKey || asset.storageKey;
    const mime = asset.thumbnailKey ? 'image/webp' : (asset.posterKey ? 'image/jpeg' : asset.mimetype);
    await this.streamStorageFile(thumbKey, mime, `thumb_${asset.filename}`, req, res);
  };

  public patchMedia = async (req: Request, res: Response): Promise<void> => {
    if (!req.membership) {
      throw AppError.forbidden('Organization membership required');
    }

    const validated = patchMediaSchema.parse(req.body);
    const asset = await mediaService.patchMedia(
      req.membership.organizationId,
      req.params.id,
      validated
    );

    res.status(200).json({
      success: true,
      data: asset,
      message: 'Media asset updated successfully',
    });
  };

  public reorderMedia = async (req: Request, res: Response): Promise<void> => {
    if (!req.membership) {
      throw AppError.forbidden('Organization membership required');
    }

    const { projectId, mediaIds } = req.body;
    if (!projectId || !Array.isArray(mediaIds)) {
      throw AppError.badRequest('projectId and mediaIds array are required');
    }

    await mediaService.reorderMedia(
      req.membership.organizationId,
      projectId,
      mediaIds
    );

    res.status(200).json({
      success: true,
      message: 'Media order updated successfully',
    });
  };

  public deleteMedia = async (req: Request, res: Response): Promise<void> => {
    if (!req.membership) {
      throw AppError.forbidden('Organization membership required');
    }

    const force = req.query.force === 'true' || req.body?.force === true;

    try {
      await mediaService.deleteMedia(
        req.membership.organizationId,
        req.params.id,
        force
      );

      res.status(200).json({
        success: true,
        message: 'Media asset deleted successfully',
      });
    } catch (err: unknown) {
      const errorWithStatus = err as { statusCode?: number; inUse?: unknown; message: string };
      if (errorWithStatus.statusCode === 409) {
        res.status(409).json({
          success: false,
          message: errorWithStatus.message,
          inUse: errorWithStatus.inUse || {},
        });
        return;
      }
      throw err;
    }
  };
}

export const mediaController = new MediaController();
