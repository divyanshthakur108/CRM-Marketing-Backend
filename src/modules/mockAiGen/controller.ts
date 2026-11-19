import { Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import { mockAiGenService } from './mockAiGenService.js';
import { mockAiGenStorage } from './mockAiGenStorage.js';
import { logger } from '../../config/logger.js';

export const getMockProject = async (req: Request, res: Response): Promise<void> => {
  try {
    const project = await mockAiGenService.getProject();
    res.status(200).json({
      success: true,
      data: project,
    });
  } catch (err: any) {
    logger.error('Error fetching mock project:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

export const updateMockProject = async (req: Request, res: Response): Promise<void> => {
  try {
    const updated = await mockAiGenService.updateProjectJson(req.body);
    res.status(200).json({
      success: true,
      data: updated,
      message: 'Mock property project JSON updated successfully.',
    });
  } catch (err: any) {
    logger.error('Error updating mock project JSON:', err);
    res.status(400).json({ success: false, message: err.message });
  }
};

export const getMockState = async (req: Request, res: Response): Promise<void> => {
  try {
    const state = await mockAiGenService.getState();
    res.status(200).json({
      success: true,
      data: state,
    });
  } catch (err: any) {
    logger.error('Error fetching mock state:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

export const uploadMockPhoto = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.file) {
      res.status(400).json({ success: false, message: 'No file uploaded.' });
      return;
    }

    const isLogo = req.body.isLogo === 'true' || req.body.isLogo === true;
    const stored = await mockAiGenService.uploadAsset(
      req.file.buffer,
      req.file.originalname,
      req.file.mimetype,
      isLogo
    );

    res.status(201).json({
      success: true,
      data: stored,
      message: `Uploaded and EXIF-stripped ${stored.cleanName} successfully.`,
    });
  } catch (err: any) {
    logger.error('Error uploading mock photo:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

export const uploadMockVideo = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.file) {
      res.status(400).json({ success: false, message: 'No video file uploaded.' });
      return;
    }

    const analyzed = await mockAiGenService.uploadVideo(
      req.file.buffer,
      req.file.originalname,
      req.file.mimetype
    );

    res.status(201).json({
      success: true,
      data: analyzed,
      message: `Uploaded, probed and analyzed raw video ${analyzed.cleanName} successfully.`,
    });
  } catch (err: any) {
    logger.error('Error uploading and analyzing raw video:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

export const updateAssetClassification = async (req: Request, res: Response): Promise<void> => {
  try {
    const { assetId, userRoomOverride, classification } = req.body;
    if (!assetId) {
      res.status(400).json({ success: false, message: 'assetId is required.' });
      return;
    }

    const updated = await mockAiGenService.updateAssetClassification({
      assetId,
      userRoomOverride: userRoomOverride || '',
      classification: classification || 'ACTUAL',
    });

    res.status(200).json({
      success: true,
      data: updated,
      message: 'Asset room classification updated successfully.',
    });
  } catch (err: any) {
    logger.error('Error updating asset classification:', err);
    res.status(400).json({ success: false, message: err.message });
  }
};

export const rotateMockAsset = async (req: Request, res: Response): Promise<void> => {
  try {
    const { assetId, rotationOverride } = req.body;
    if (!assetId || rotationOverride === undefined) {
      res.status(400).json({ success: false, message: 'assetId and rotationOverride (e.g. 180) are required.' });
      return;
    }

    const updated = await mockAiGenService.rotateAsset(assetId, Number(rotationOverride));
    res.status(200).json({
      success: true,
      data: updated,
      message: `Asset "${assetId}" rotated to ${rotationOverride}° and proxy re-generated.`,
    });
  } catch (err: any) {
    logger.error('Error rotating mock asset:', err);
    res.status(400).json({ success: false, message: err.message });
  }
};

export const preprocessAllVideos = async (_req: Request, res: Response): Promise<void> => {
  try {
    const results = await mockAiGenService.preprocessAllVideos();
    res.status(200).json({
      success: true,
      data: results,
      message: `Preprocessed ${results.length} videos successfully.`,
    });
  } catch (err: any) {
    logger.error('Error preprocessing all videos:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

export const mapMockSlot = async (req: Request, res: Response): Promise<void> => {
  try {
    const { slotId, assetId } = req.body;
    if (!slotId || !assetId) {
      res.status(400).json({ success: false, message: 'Both slotId and assetId are required.' });
      return;
    }

    const mapping = await mockAiGenService.mapAssetToSlot(slotId, assetId);
    res.status(200).json({
      success: true,
      data: mapping,
      message: `Slot "${slotId}" mapped to asset "${assetId}".`,
    });
  } catch (err: any) {
    logger.error('Error mapping mock slot:', err);
    res.status(400).json({ success: false, message: err.message });
  }
};

export const autoMapMockSlots = async (req: Request, res: Response): Promise<void> => {
  try {
    const mappings = await mockAiGenService.autoMapSlots();
    res.status(200).json({
      success: true,
      data: mappings,
      message: 'All uploaded photos and videos auto-mapped to room slots successfully.',
    });
  } catch (err: any) {
    logger.error('Error auto-mapping mock slots:', err);
    res.status(400).json({ success: false, message: err.message });
  }
};

export const getMockCampaigns = async (req: Request, res: Response): Promise<void> => {
  try {
    const campaigns = await mockAiGenService.getCampaigns();
    res.status(200).json({
      success: true,
      data: campaigns,
    });
  } catch (err: any) {
    logger.error('Error fetching mock campaigns:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

export const triggerRunwayPilot = async (req: Request, res: Response): Promise<void> => {
  try {
    const { campaignId, sceneIndex, hasHumanCostApproval } = req.body;

    if (!campaignId || sceneIndex === undefined) {
      res.status(400).json({
        success: false,
        message: 'campaignId and sceneIndex are required.',
      });
      return;
    }

    if (!hasHumanCostApproval) {
      res.status(402).json({
        success: false,
        requiresHumanCostApproval: true,
        estimatedCredits: 5,
        estimatedCostUsd: 0.25,
        message:
          'CRITICAL BUDGET GATE: Explicit human approval required before initiating paid Runway API generation ($0.25 USD / 5 credits). Set hasHumanCostApproval: true to confirm.',
      });
      return;
    }

    const result = await mockAiGenService.triggerRunwayPilot({
      campaignId,
      sceneIndex: Number(sceneIndex),
      hasHumanCostApproval: Boolean(hasHumanCostApproval),
    });

    res.status(200).json({
      success: true,
      data: result.task,
      message: result.message,
    });
  } catch (err: any) {
    logger.error('Error triggering Runway pilot:', err);
    res.status(400).json({ success: false, message: err.message });
  }
};

export const getRunwayPilotStatus = async (req: Request, res: Response): Promise<void> => {
  try {
    const { taskId } = req.params;
    if (!taskId) {
      res.status(400).json({ success: false, message: 'taskId is required.' });
      return;
    }

    const status = await mockAiGenService.getRunwayPilotStatus(taskId);
    res.status(200).json({
      success: true,
      data: status,
    });
  } catch (err: any) {
    logger.error('Error querying Runway task status:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

export const composeCampaignAd = async (req: Request, res: Response): Promise<void> => {
  try {
    const { campaignId } = req.body;
    if (!campaignId) {
      res.status(400).json({ success: false, message: 'campaignId is required.' });
      return;
    }

    const result = await mockAiGenService.composeCampaignAd(campaignId);
    res.status(200).json({
      success: true,
      data: result,
      message: `Composed ad video for campaign "${campaignId}" successfully.`,
    });
  } catch (err: any) {
    logger.error('Error composing campaign ad:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

export const composePilotAd = async (_req: Request, res: Response): Promise<void> => {
  try {
    const result = await mockAiGenService.composeStyleMatchPilot();
    res.status(200).json({
      success: true,
      data: result,
      message: 'Composed 12.5s Style-Match Pilot matching reference 1013.mp4 successfully.',
    });
  } catch (err: any) {
    logger.error('Error composing style-match pilot:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

export const serveSandboxFile = async (req: Request, res: Response): Promise<void> => {
  try {
    const subPath = req.params[0] || (req.params as any).path;
    const rootDir = mockAiGenStorage.getRoot();
    const resolvedPath = path.resolve(rootDir, subPath);

    // Security check to avoid path traversal
    if (!resolvedPath.startsWith(path.resolve(rootDir))) {
      res.status(403).json({ success: false, message: 'Forbidden file access.' });
      return;
    }

    if (!fs.existsSync(resolvedPath)) {
      res.status(404).json({ success: false, message: 'File not found in sandbox.' });
      return;
    }

    res.sendFile(resolvedPath);
  } catch (err: any) {
    logger.error('Error serving sandbox file:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

export const resetMockData = async (req: Request, res: Response): Promise<void> => {
  try {
    const result = await mockAiGenService.resetMockData();
    res.status(200).json(result);
  } catch (err: any) {
    logger.error('Error resetting mock data:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};
