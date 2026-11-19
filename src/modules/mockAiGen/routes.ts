import { Router } from 'express';
import multer from 'multer';
import {
  getMockProject,
  updateMockProject,
  getMockState,
  uploadMockPhoto,
  uploadMockVideo,
  updateAssetClassification,
  mapMockSlot,
  autoMapMockSlots,
  getMockCampaigns,
  triggerRunwayPilot,
  getRunwayPilotStatus,
  composeCampaignAd,
  composePilotAd,
  serveSandboxFile,
  resetMockData,
  rotateMockAsset,
  preprocessAllVideos,
} from './controller.js';

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 150 * 1024 * 1024 }, // 150MB limit for raw phone video clips
});

// Mock Property & State inspection & editing
router.get('/project', getMockProject);
router.put('/project', updateMockProject);
router.get('/state', getMockState);

// Media mapping, video analysis & EXIF GPS stripping
router.post('/upload', upload.single('file'), uploadMockPhoto);
router.post('/upload-video', upload.single('file'), uploadMockVideo);
router.post('/update-classification', updateAssetClassification);
router.post('/rotate-asset', rotateMockAsset);
router.post('/preprocess-all', preprocessAllVideos);
router.post('/map-slot', mapMockSlot);
router.post('/auto-map', autoMapMockSlots);

// Campaigns & Creative Direction
router.get('/campaigns', getMockCampaigns);

// Runway pilot image-to-video with strict cost gate
router.post('/runway-pilot', triggerRunwayPilot);
router.get('/runway-status/:taskId', getRunwayPilotStatus);

// Complete ad composition (FFmpeg + safe zones + vector typography + ambient audio)
router.post('/compose-ad', composeCampaignAd);
router.post('/compose-pilot', composePilotAd);

// Reset & completely delete all mock AI sandbox data
router.post('/reset', resetMockData);
router.delete('/reset', resetMockData);

// Isolated sandbox file serving (images, thumbnails, raw videos, rendered MP4s)
router.get('/files/*', serveSandboxFile);

export default router;
