import { DemoRequest, IDemoRequest } from '../../models/DemoRequest.js';
import { CreateDemoRequestInput } from './demoValidation.js';
import { emailService } from '../../services/emailService.js';
import { logger } from '../../config/logger.js';

class DemoService {
  /**
   * Processes a public VIP Demo booking submission.
   * Persists to MongoDB first, then attempts asynchronous email dispatch.
   */
  public async createDemoRequest(
    input: CreateDemoRequestInput,
    metadata?: { ipAddress?: string; userAgent?: string }
  ): Promise<{ demoRequest: IDemoRequest; isDuplicate: boolean }> {
    // 1. Silent spam bot trap: if hidden honeypot is populated, gracefully simulate success
    if (input.hp_field && input.hp_field.trim().length > 0) {
      logger.warn({ ip: metadata?.ipAddress, email: input.email }, 'Spam bot caught via honeypot');
      const fakeDoc = new DemoRequest({
        name: input.name,
        email: input.email,
        phone: input.phone,
        company: input.company,
        teamSize: input.teamSize,
        status: 'Closed',
      });
      return { demoRequest: fakeDoc, isDuplicate: false };
    }

    const normalizedEmail = input.email.trim().toLowerCase();

    // 2. Prevent rapid duplicate submissions within 5 minutes
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    const existingRecent = await DemoRequest.findOne({
      email: normalizedEmail,
      createdAt: { $gte: fiveMinutesAgo },
    });

    if (existingRecent) {
      logger.info(
        { email: normalizedEmail, existingId: existingRecent._id },
        'Duplicate demo request detected within 5-minute cooldown; returning existing record'
      );
      return { demoRequest: existingRecent, isDuplicate: true };
    }

    // 3. Persist to MongoDB
    const demoRequest = await DemoRequest.create({
      name: input.name.trim(),
      email: normalizedEmail,
      phone: input.phone.trim(),
      company: input.company.trim(),
      teamSize: input.teamSize.trim(),
      source: 'Website Demo Request',
      status: 'New',
      ipAddress: metadata?.ipAddress,
      userAgent: metadata?.userAgent,
      adminNotified: false,
      customerConfirmed: false,
    });

    logger.info(
      { demoRequestId: demoRequest._id, email: normalizedEmail },
      'VIP Demo booking successfully persisted in MongoDB'
    );

    // 4. Asynchronous email notifications (Non-blocking)
    const emailPayload = {
      requestId: demoRequest._id.toString(),
      name: demoRequest.name,
      email: demoRequest.email,
      phone: demoRequest.phone,
      company: demoRequest.company,
      teamSize: demoRequest.teamSize,
      createdAt: demoRequest.createdAt,
    };

    // Execute email dispatches safely; persistence is already guaranteed
    (async () => {
      try {
        const [adminSuccess, customerSuccess] = await Promise.allSettled([
          emailService.sendDemoBookingNotification(emailPayload),
          emailService.sendDemoConfirmationToVisitor(emailPayload),
        ]);

        const adminSent = adminSuccess.status === 'fulfilled' && adminSuccess.value;
        const customerSent = customerSuccess.status === 'fulfilled' && customerSuccess.value;

        await DemoRequest.findByIdAndUpdate(demoRequest._id, {
          adminNotified: adminSent,
          customerConfirmed: customerSent,
          ...(!adminSent && !customerSent
            ? { notificationError: 'SMTP dispatch failed or SMTP unconfigured' }
            : {}),
        });
      } catch (err: unknown) {
        logger.error({ err, demoRequestId: demoRequest._id }, 'Background email dispatch error for demo request');
      }
    })();

    return { demoRequest, isDuplicate: false };
  }
}

export const demoService = new DemoService();

