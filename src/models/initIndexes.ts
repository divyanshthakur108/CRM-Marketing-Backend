import {
  Organization,
  User,
  Membership,
  Invitation,
  RefreshToken,
  Project,
  PropertyUnit,
  MediaAsset,
  BrandProfile,
  AudienceBrief,
  Budget,
  Plan,
  PlanItem,
  Creative,
  Approval,
  Job,
  MetaConnection,
  Campaign,
  PublishedPost,
  Insight,
  Lead,
  LeadActivity,
  Conversation,
  Appointment,
  Notification,
  AuditLog,
  UsageLedger,
  Subscription,
} from './index.js';
import { logger } from '../config/logger.js';

export async function initAllIndexes(): Promise<void> {
  const models = [
    Organization,
    User,
    Membership,
    Invitation,
    RefreshToken,
    Project,
    PropertyUnit,
    MediaAsset,
    BrandProfile,
    AudienceBrief,
    Budget,
    Plan,
    PlanItem,
    Creative,
    Approval,
    Job,
    MetaConnection,
    Campaign,
    PublishedPost,
    Insight,
    Lead,
    LeadActivity,
    Conversation,
    Appointment,
    Notification,
    AuditLog,
    UsageLedger,
    Subscription,
  ];

  for (const model of models) {
    try {
      await model.init();
    } catch (err: unknown) {
      const mongoErr = err as { code?: number; codeName?: string };
      if (mongoErr?.code === 86 || mongoErr?.codeName === 'IndexKeySpecsConflict') {
        try {
          await model.syncIndexes();
          logger.info({ modelName: model.modelName }, 'Re-synchronized model indexes after resolving key spec conflict');
        } catch (syncErr) {
          logger.warn({ err: syncErr, modelName: model.modelName }, 'Could not sync model indexes');
        }
      } else {
        logger.error({ err, modelName: model.modelName }, 'Error initializing model indexes');
      }
    }
  }

  logger.info(`Successfully synchronized indexes for ${models.length} Mongoose models`);
}
