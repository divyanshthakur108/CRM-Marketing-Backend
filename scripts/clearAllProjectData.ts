import mongoose from 'mongoose';
import dotenv from 'dotenv';
import fs from 'fs/promises';
import path from 'path';

dotenv.config();

const COLLECTIONS_TO_CLEAR = [
  'projects',
  'propertyunits',
  'mediaassets',
  'creatives',
  'plans',
  'planitems',
  'approvals',
  'campaigns',
  'budgets',
  'brandprofiles',
  'audiencebriefs',
  'publishedposts',
  'insights',
  'leads',
  'leadactivities',
  'conversations',
  'appointments',
  'notifications',
  'jobs',
  'auditlogs',
  'usageledgers',
  'metaconnections',
];

async function clearAllProjectData() {
  console.log('--- Starting Comprehensive Project & Media Data Cleanup ---');
  if (!process.env.MONGODB_URI) {
    throw new Error('MONGODB_URI environment variable is missing.');
  }

  await mongoose.connect(process.env.MONGODB_URI);
  console.log('✓ Connected to MongoDB');

  const deletionSummary: Record<string, number> = {};

  for (const collectionName of COLLECTIONS_TO_CLEAR) {
    try {
      const collection = mongoose.connection.db.collection(collectionName);
      const countBefore = await collection.countDocuments();
      if (countBefore > 0) {
        await collection.deleteMany({});
      }
      deletionSummary[collectionName] = countBefore;
    } catch (err: unknown) {
      console.warn(`Warning clearing ${collectionName}:`, err instanceof Error ? err.message : err);
      deletionSummary[collectionName] = 0;
    }
  }

  console.log('\n--- Database Deletion Summary ---');
  console.table(deletionSummary);

  // Clear physical files from backend/storage (keeping backup JSON files intact)
  const storageDir = path.resolve(process.cwd(), 'storage');
  console.log(`\n--- Cleaning Storage Directory: ${storageDir} ---`);

  let filesDeleted = 0;
  let dirsDeleted = 0;

  try {
    const entries = await fs.readdir(storageDir, { withFileTypes: true });
    for (const entry of entries) {
      // Never delete safety backup files
      if (entry.isFile() && entry.name.startsWith('backup_') && entry.name.endsWith('.json')) {
        console.log(`  [KEPT] Safety Backup: ${entry.name}`);
        continue;
      }

      const fullPath = path.join(storageDir, entry.name);
      try {
        if (entry.isDirectory()) {
          await fs.rm(fullPath, { recursive: true, force: true });
          dirsDeleted++;
        } else if (entry.isFile()) {
          await fs.unlink(fullPath);
          filesDeleted++;
        }
      } catch (e: unknown) {
        console.warn(`  Could not remove ${entry.name}:`, e instanceof Error ? e.message : e);
      }
    }
    console.log(`✓ Removed ${dirsDeleted} subdirectories and ${filesDeleted} media files from storage.`);
  } catch (err: unknown) {
    console.error('Error during storage folder cleanup:', err instanceof Error ? err.message : err);
  }

  // Verify preserved user accounts and organizations
  const preservedUsers = await mongoose.connection.db.collection('users').countDocuments();
  const preservedOrgs = await mongoose.connection.db.collection('organizations').countDocuments();
  const preservedMemberships = await mongoose.connection.db.collection('memberships').countDocuments();
  const preservedTokens = await mongoose.connection.db.collection('refreshtokens').countDocuments();

  console.log('\n--- Preserved Authentication & Workspace Infrastructure ---');
  console.log(`  Users preserved:        ${preservedUsers}`);
  console.log(`  Organizations preserved: ${preservedOrgs}`);
  console.log(`  Memberships preserved:   ${preservedMemberships}`);
  console.log(`  Active sessions kept:    ${preservedTokens}`);

  await mongoose.disconnect();
  console.log('\n✓ Cleanup complete. Workspace is completely fresh and ready for new data.');
}

clearAllProjectData().catch((err) => {
  console.error('Fatal cleanup error:', err);
  process.exit(1);
});
