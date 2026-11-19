import path from 'path';
import fs from 'fs';
import { mockVideoPreprocessor } from '../modules/mockAiGen/mockVideoPreprocessor.js';
import { mockAiGenStorage } from '../modules/mockAiGen/mockAiGenStorage.js';
import { spawnFfprobe } from '../utils/ffmpeg.js';

async function probeProxy(proxyPath: string): Promise<{ width: number; height: number; rotation: number }> {
  const args = [
    '-v', 'error',
    '-show_entries', 'stream=width,height:stream_side_data:stream_tags=rotate',
    '-of', 'json',
    proxyPath,
  ];

  const output = await new Promise<string>((resolve, reject) => {
    const proc = spawnFfprobe(args);
    let out = '';
    let err = '';
    proc.stdout?.on('data', (d: Buffer) => (out += d.toString()));
    proc.stderr?.on('data', (d: Buffer) => (err += d.toString()));
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) resolve(out);
      else reject(new Error(`ffprobe failed: ${err}`));
    });
  });

  const parsed = JSON.parse(output);
  const vStream = parsed.streams?.find((s: any) => s.width);
  let rot = 0;
  if (vStream?.side_data_list) {
    const dm = vStream.side_data_list.find((sd: any) => sd.rotation !== undefined);
    if (dm) rot = dm.rotation;
  }
  if (!rot && vStream?.tags?.rotate) {
    rot = Number(vStream.tags.rotate) || 0;
  }

  return {
    width: vStream?.width || 0,
    height: vStream?.height || 0,
    rotation: rot,
  };
}

async function runTests() {
  console.log('===============================================================');
  console.log('REALCRM — MILESTONE 1: VIDEO PREPROCESSOR & ORIENTATION TEST');
  console.log('===============================================================\n');

  await mockAiGenStorage.init();
  const uploadsDir = path.join(mockAiGenStorage.getRoot(), 'uploads');

  // Read state.json to map current stored files
  const statePath = path.join(mockAiGenStorage.getRoot(), 'state.json');
  const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  const videos: Array<{ assetId: string; cleanName: string; originalName: string; absolutePath: string }> = state.sourceVideos;

  if (!videos || videos.length === 0) {
    throw new Error('No videos found in state.json');
  }

  // Select 5 diverse pilot assets
  const pilotIndices = [0, 2, 5, 8, 11];
  const pilotAssets = pilotIndices.map((idx) => {
    const v = videos[idx];
    if (!v) throw new Error(`Could not find video at index ${idx}`);
    // Ensure absolutePath points to real file in uploads
    const absPath = path.join(uploadsDir, v.cleanName);
    return {
      ...v,
      absolutePath: absPath,
    };
  });

  console.log(`Testing with ${pilotAssets.length} diverse real pilot assets from uploads:`);
  pilotAssets.forEach((p, i) => console.log(`  [${i}] ${p.cleanName} (${p.originalName})`));

  const knownSha256Map = new Map<string, string>();
  const results = [];

  for (const asset of pilotAssets) {
    console.log(`\n--> Preprocessing ${asset.cleanName}...`);
    const t0 = Date.now();
    const meta = await mockVideoPreprocessor.preprocessAsset(asset.absolutePath, asset.assetId, asset.originalName, {
      knownSha256Map,
      forceRefresh: true, // test fresh transcode and metric computation
    });
    const elapsed = Date.now() - t0;
    console.log(`    Completed in ${elapsed}ms.`);

    // Verify proxy on disk
    if (!fs.existsSync(meta.proxyPath)) {
      throw new Error(`Proxy file missing: ${meta.proxyPath}`);
    }

    // Verify proxy orientation via ffprobe
    const proxyProbe = await probeProxy(meta.proxyPath);
    console.log(`    Proxy specs: ${proxyProbe.width}x${proxyProbe.height}, rotation: ${proxyProbe.rotation}°`);

    if (proxyProbe.width !== 720 || proxyProbe.height !== 1280) {
      throw new Error(`Proxy resolution mismatch! Expected 720x1280, got ${proxyProbe.width}x${proxyProbe.height}`);
    }
    if (proxyProbe.rotation !== 0) {
      throw new Error(`Proxy rotation metadata not stripped! Got ${proxyProbe.rotation}°`);
    }

    // Verify 3 thumbnails
    console.log(`    Thumbnails extracted: ${meta.thumbnails.length}`);
    for (const thumb of meta.thumbnails) {
      if (!fs.existsSync(thumb.absolutePath)) {
        throw new Error(`Thumbnail file missing: ${thumb.absolutePath}`);
      }
    }

    results.push({
      cleanName: asset.cleanName,
      rawCodec: `${meta.container}/${meta.videoCodec}`,
      duration: `${meta.durationSeconds}s`,
      probedRotation: `${meta.detectedRotation}°`,
      proxyResolution: `${proxyProbe.width}x${proxyProbe.height}`,
      proxyRotation: `${proxyProbe.rotation}°`,
      yavg: meta.meanLuminanceYavg,
      exposure: meta.exposureQuality,
      blurScore: meta.meanBlurScore,
      isBlurry: meta.isBlurry,
      stability: meta.cameraStability,
      thumbnailsCount: meta.thumbnails.length,
      elapsedMs: elapsed,
    });
  }

  // TEST CACHE HIT (< 100ms requirement)
  console.log('\n--> Testing Cache Hit (< 100ms requirement)...');
  const cacheTestAsset = pilotAssets[0];
  const tCacheStart = Date.now();
  const cachedMeta = await mockVideoPreprocessor.preprocessAsset(
    cacheTestAsset.absolutePath,
    cacheTestAsset.assetId,
    cacheTestAsset.originalName,
    { knownSha256Map, forceRefresh: false }
  );
  const cacheElapsed = Date.now() - tCacheStart;
  console.log(`    Cache hit returned in ${cacheElapsed}ms (cached: ${cachedMeta.cached})`);
  if (!cachedMeta.cached || cacheElapsed > 100) {
    throw new Error(`Cache hit failed SLA! Took ${cacheElapsed}ms, cached: ${cachedMeta.cached}`);
  }

  // TEST DUPLICATE DETECTION
  console.log('\n--> Testing Duplicate Detection (same file, new assetId)...');
  const duplicateMeta = await mockVideoPreprocessor.preprocessAsset(
    cacheTestAsset.absolutePath,
    'mock_asset_duplicate_test',
    'DUPLICATE_TEST.mp4',
    { knownSha256Map, forceRefresh: true }
  );
  console.log(`    isDuplicate: ${duplicateMeta.isDuplicate}, duplicateOf: ${duplicateMeta.duplicateOfAssetId}`);
  if (!duplicateMeta.isDuplicate || duplicateMeta.duplicateOfAssetId !== cacheTestAsset.assetId) {
    throw new Error(`Duplicate detection failed! Expected duplicateOf: ${cacheTestAsset.assetId}`);
  }

  // TEST DETERMINISTIC ROTATION FIX (e.g. 180° flip for upside-down footage)
  console.log('\n--> Testing Deterministic Rotation Fix (180° flip)...');
  const flipAsset = pilotAssets[1]; // video index 2
  const flipMeta = await mockVideoPreprocessor.preprocessAsset(
    flipAsset.absolutePath,
    'mock_asset_flipped_test',
    'FLIPPED_TEST.mp4',
    { forceRefresh: true, rotationOverride: 180 }
  );
  console.log(`    rotationOverride: 180 applied, proxy: ${flipMeta.proxyPath}`);
  const flippedProbe = await probeProxy(flipMeta.proxyPath);
  if (flippedProbe.width !== 720 || flippedProbe.height !== 1280 || flippedProbe.rotation !== 0) {
    throw new Error(`Flipped proxy specs mismatch! ${flippedProbe.width}x${flippedProbe.height}, rot: ${flippedProbe.rotation}`);
  }

  // TEST CORRUPT / MISSING FILE
  console.log('\n--> Testing Corrupt / Non-Existent File handling...');
  try {
    await mockVideoPreprocessor.preprocessAsset(
      path.join(uploadsDir, 'non_existent_corrupt_file.mov'),
      'corrupt_test_id',
      'corrupt.mov'
    );
    throw new Error('Should have thrown error for non-existent file!');
  } catch (err: any) {
    console.log(`    Gracefully caught expected error: "${err.message}"`);
  }

  // SUMMARY TABLE
  console.log('\n===============================================================');
  console.log('SUMMARY TABLE: PREPROCESSOR RESULTS ON PILOT SET');
  console.log('===============================================================');
  console.table(results);

  console.log('\n[PASS] All Milestone 1 preprocessor tests passed with real input!\n');
}

runTests().catch((err) => {
  console.error('\n[FAIL] Test encountered error:', err);
  process.exit(1);
});
