import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import {
  MockPropertyProjectSchema,
  MockPropertyProject,
} from '../src/modules/mockAiGen/mockPropertySchema.js';
import { mockAiGenStorage } from '../src/modules/mockAiGen/mockAiGenStorage.js';
import { mockAiGenService } from '../src/modules/mockAiGen/mockAiGenService.js';
import { mockRunwayClient } from '../src/modules/mockAiGen/mockRunwayClient.js';
import { mockAdComposer } from '../src/modules/mockAiGen/mockAdComposer.js';

describe('Mock AI Gen Module — Isolated Sandbox Proof-of-Concept', () => {
  let projectFixture: MockPropertyProject;

  beforeAll(async () => {
    await mockAiGenStorage.init();
    projectFixture = await mockAiGenService.init();
  });

  describe('1. Test-Property JSON Loader & Zod Validation', () => {
    it('should successfully parse and strictly validate mock_property_project.json', () => {
      expect(projectFixture).toBeDefined();
      expect(projectFixture.schemaVersion).toBe('1.0.0');
      expect(projectFixture.datasetType).toBe('SYNTHETIC_DEMO_DO_NOT_PUBLISH');
    });

    it('should reflect accurate residential facts and shared rooftop status', () => {
      const config = projectFixture.project.configuration;
      expect(config.bhk).toBe(3);
      expect(config.bedrooms).toBe(3);
      expect(config.bathrooms).toBe(2);
      expect(config.rooftopAccess).toBe('shared_common_area'); // NOT private!
    });

    it('should confirm unverified commercial facts are strictly null or empty', () => {
      const comm = projectFixture.project.commercialFacts;
      expect(comm.priceInr).toBeNull();
      expect(comm.reraNumber).toBeNull();
      expect(comm.contactPhone).toBeNull();
    });

    it('should list all 11 required areas and media asset slots', () => {
      expect(projectFixture.areas.length).toBe(11);
      const livingArea = projectFixture.areas.find((a) => a.id === 'living');
      expect(livingArea).toBeDefined();
      expect(livingArea?.name).toBe('Living & Dining');

      const terraceArea = projectFixture.areas.find((a) => a.id === 'terrace');
      expect(terraceArea?.name).toBe('Shared Rooftop Terrace');

      expect(projectFixture.media.assets.length).toBe(13);
    });
  });

  describe('2. Mapping UI & EXIF GPS Stripping Storage', () => {
    it('should strip EXIF GPS metadata while preserving high quality image bytes', async () => {
      // Create a test image with Sharp
      const sampleBuffer = await sharp({
        create: {
          width: 800,
          height: 600,
          channels: 3,
          background: { r: 30, g: 41, b: 59 },
        },
      })
        .jpeg()
        .toBuffer();

      const stored = await mockAiGenStorage.saveUploadedFile({
        buffer: sampleBuffer,
        originalname: 'test_living_room.jpg',
        mimetype: 'image/jpeg',
      });

      expect(stored.assetId).toContain('mock_asset_');
      expect(stored.hasExifGpsRemoved).toBe(true);
      expect(stored.sizeBytes).toBeGreaterThan(0);
      expect(fs.existsSync(stored.absolutePath)).toBe(true);
    });

    it('should map an uploaded asset to a specific media slot', async () => {
      const sampleBuffer = await sharp({
        create: {
          width: 1080,
          height: 1920,
          channels: 3,
          background: { r: 208, g: 177, b: 125 },
        },
      })
        .jpeg()
        .toBuffer();

      const uploaded = await mockAiGenService.uploadAsset(
        sampleBuffer,
        'master_bed_photo.jpg',
        'image/jpeg'
      );

      const mapping = await mockAiGenService.mapAssetToSlot('master_wide', uploaded.assetId);

      expect(mapping.slotId).toBe('master_wide');
      expect(mapping.areaId).toBe('master');
      expect(mapping.assetId).toBe(uploaded.assetId);

      const state = await mockAiGenService.getState();
      expect(state.slotMappings['master_wide']).toBeDefined();
    });

    it('should support auto-mapping all uploaded media to slots', async () => {
      const mappings = await mockAiGenService.autoMapSlots();
      expect(Object.keys(mappings).length).toBe(13);
      expect(mappings['living_wide']).toBeDefined();
    });
  });

  describe('3. Property JSON Validation & Update', () => {
    it('should allow valid updates to property configuration', async () => {
      const current = await mockAiGenService.getProject();
      const updated = await mockAiGenService.updateProjectJson({
        ...current,
        project: {
          ...current.project,
          name: 'Updated Luxury Flat Demo',
        },
      });
      expect(updated.project.name).toBe('Updated Luxury Flat Demo');
    });

    it('should reject invalid property updates violating Zod schema', async () => {
      const current = await mockAiGenService.getProject();
      await expect(
        mockAiGenService.updateProjectJson({
          ...current,
          datasetType: 'INVALID_TYPE_SHOULD_FAIL', // Must be SYNTHETIC_DEMO_DO_NOT_PUBLISH
        })
      ).rejects.toThrow();
    });
  });

  describe('3. Creative Direction & Runway Budget Gate', () => {
    it('should load two distinct campaigns with different profiles and languages', async () => {
      const campaigns = await mockAiGenService.getCampaigns();
      expect(campaigns.length).toBe(2);

      const camp1 = campaigns.find((c) => c.id === 'fb-2026-12-04');
      const camp2 = campaigns.find((c) => c.id === 'fb-2026-12-15');

      expect(camp1?.designProfile).toBe('LUXURY_EDITORIAL');
      expect(camp1?.language).toBe('Hinglish / English');
      expect(camp1?.durationSeconds).toBe(25);

      expect(camp2?.designProfile).toBe('MODERN_ARCHITECTURAL');
      expect(camp2?.language).toBe('Hindi');
      expect(camp2?.durationSeconds).toBe(26);
    });

    it('STRICT BUDGET GATE: should block Runway API call when human cost approval is false', async () => {
      const result = await mockRunwayClient.createImageToVideoTask({
        promptImageUrl: 'dummy.jpg',
        promptText: 'Cinematic push',
        model: 'seedance2_5',
        ratio: '720:1280',
        durationSeconds: 5,
        hasHumanCostApproval: false, // HARD GATE
      });

      expect(result.status).toBe('BLOCKED');
      expect(result.error).toContain('Human budget approval required');
      expect(result.estimatedCostCredits).toBe(5);
      expect(result.estimatedCostUsd).toBe(0.25);
    });
  });

  describe('4. Safe Zones & Vector Typography Composer', () => {
    it('should render a valid 1080x1920 overlay plate respecting safe zones', async () => {
      const overlayPng = await mockAdComposer.renderSceneOverlaySvg({
        sceneText: 'Space jo har din special banaye',
        sublabel: 'Skyline Demo Residence',
        profile: 'LUXURY_EDITORIAL',
        accentColor: '#D0B17D',
        hasLogo: false,
      });

      expect(overlayPng).toBeDefined();
      const meta = await sharp(overlayPng).metadata();
      expect(meta.width).toBe(1080);
      expect(meta.height).toBe(1920);
      expect(meta.format).toBe('png');
    });
  });
});

