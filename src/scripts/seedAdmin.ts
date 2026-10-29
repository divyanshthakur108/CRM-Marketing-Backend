import dotenv from 'dotenv';
dotenv.config();

import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { connectDB } from '../config/db.js';
import { env } from '../config/env.js';
import { User } from '../models/User.js';
import { logger } from '../config/logger.js';

/**
 * Idempotent seeder that creates or updates the Platform Admin account
 * based on ADMIN_EMAIL and ADMIN_PASSWORD in .env.
 */
export async function seedAdmin(): Promise<void> {
  const adminEmail = (env.ADMIN_EMAIL || 'admin@realcrm.in').toLowerCase().trim();
  const adminPassword = env.ADMIN_PASSWORD || 'AdminPassword123!';

  logger.info({ adminEmail }, 'Seeding Platform Admin account...');

  if (mongoose.connection.readyState === 0) {
    await connectDB();
  }

  const passwordHash = await bcrypt.hash(adminPassword, 10);

  const existingAdmin = await User.findOne({ email: adminEmail });

  if (existingAdmin) {
    existingAdmin.passwordHash = passwordHash;
    existingAdmin.isPlatformAdmin = true;
    existingAdmin.status = 'active';
    await existingAdmin.save();
    logger.info({ adminEmail, id: existingAdmin._id }, 'Platform Admin updated successfully');
  } else {
    const newAdmin = await User.create({
      email: adminEmail,
      fullName: 'Platform Administrator',
      passwordHash,
      isPlatformAdmin: true,
      status: 'active',
    });
    logger.info({ adminEmail, id: newAdmin._id }, 'Platform Admin created successfully');
  }
}

// Allow direct CLI execution
if (process.argv[1]?.endsWith('seedAdmin.ts') || process.argv[1]?.endsWith('seedAdmin.js')) {
  seedAdmin()
    .then(async () => {
      console.log('✅ Platform Admin seed complete');
      await mongoose.disconnect();
      process.exit(0);
    })
    .catch((err) => {
      console.error('❌ Platform Admin seed failed:', err);
      process.exit(1);
    });
}
