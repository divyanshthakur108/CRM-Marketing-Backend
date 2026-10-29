import { Request, Response } from 'express';
import { Notification } from '../../models/Notification.js';
import { sendSuccess } from '../../utils/response.js';
import { AppError } from '../../utils/AppError.js';

export class NotificationsController {
  public getNotifications = async (req: Request, res: Response): Promise<void> => {
    const organizationId = req.organizationId;
    if (!organizationId) {
      throw AppError.unauthorized('Organization context required');
    }

    const docs = await Notification.find({ organizationId })
      .sort({ createdAt: -1 })
      .limit(50);

    const items = docs.map((doc) => ({
      id: doc._id.toString(),
      title: doc.title,
      message: doc.message,
      category: doc.category,
      timestamp: doc.createdAt ? doc.createdAt.toISOString() : new Date().toISOString(),
      read: doc.read,
      link: doc.link,
    }));

    sendSuccess(res, items);
  };

  public markAllRead = async (req: Request, res: Response): Promise<void> => {
    const organizationId = req.organizationId;
    if (!organizationId) {
      throw AppError.unauthorized('Organization context required');
    }

    await Notification.updateMany({ organizationId, read: false }, { $set: { read: true } });
    sendSuccess(res, { success: true, message: 'All notifications marked as read' });
  };

  public toggleRead = async (req: Request, res: Response): Promise<void> => {
    const organizationId = req.organizationId;
    const { id } = req.params;

    if (!organizationId) {
      throw AppError.unauthorized('Organization context required');
    }

    const doc = await Notification.findOne({ _id: id, organizationId });
    if (!doc) {
      throw AppError.notFound('Notification not found');
    }

    doc.read = !doc.read;
    await doc.save();

    sendSuccess(res, {
      id: doc._id.toString(),
      read: doc.read,
    });
  };
}

export const notificationsController = new NotificationsController();
