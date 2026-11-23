import dotenv from 'dotenv';
dotenv.config();

import fs from 'fs/promises';
import path from 'path';
import mongoose from 'mongoose';
import { connectDB } from '../config/db.js';
import { defaultStorage } from '../storage/localStorage.adapter.js';
import { creativeLabService } from '../modules/creativelab/service.js';

/**
 * Publishes finished POC reels to a Creative Lab test project, so every admin sees them under
 * "Generated results" (files go to Cloudinary when it's configured, records to the lab database).
 *
 *   npm run creative-lab:publish -- [manifest] [--dir <videos folder>] [--dry-run]
 *
 * Defaults: manifest poc/creative-lab/results.json, videos folder ../poc-output.
 * Safe to run again: a file that is already published only gets its title/notes updated.
 */
interface ManifestEntry {
  file: string;
  title: string;
  notes?: string;
  aiDisclosure?: string;
  tags?: string[];
  verdict?: 'USE' | 'CHECK' | 'DONT_USE';
}

async function main() {
  const args = process.argv.slice(2);
  const flag = (name: string) => {
    const i = args.indexOf(name);
    return i >= 0 ? args.splice(i, 2)[1] : undefined;
  };
  const dryRun = args.includes('--dry-run');
  const dir = path.resolve(flag('--dir') || '../poc-output');
  const manifestPath = path.resolve(args.find((a) => !a.startsWith('--')) || 'poc/creative-lab/results.json');
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8')) as { project: string; results: ManifestEntry[] };

  for (const r of manifest.results) await fs.access(path.join(dir, r.file)); // fail early on a missing file
  console.log(`${manifest.results.length} file(s) found in ${dir}. Storage: ${defaultStorage.isCloudinary ? 'Cloudinary' : 'LOCAL DISK ONLY (others will not see the videos)'}`);
  if (dryRun) return;

  await connectDB();
  for (const r of manifest.results) {
    const buffer = await fs.readFile(path.join(dir, r.file));
    const doc = await creativeLabService.addResult(manifest.project, { buffer, filename: r.file }, { ...r, source: 'poc-script' });
    console.log(`✓ ${r.file} → ${doc.url}`);
  }
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
