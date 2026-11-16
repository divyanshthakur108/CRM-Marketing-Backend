import { Request, Response } from 'express';
import { demoService } from './demoService.js';
import { sendSuccess } from '../../utils/response.js';

export class DemoController {
  public submitDemoRequest = async (req: Request, res: Response): Promise<void> => {
    const ipAddress =
      (req.headers['x-forwarded-for'] as string)?.split(',')[0].trim() ||
      req.socket.remoteAddress;
    const userAgent = req.headers['user-agent'];

    const { demoRequest, isDuplicate } = await demoService.createDemoRequest(req.body, {
      ipAddress,
      userAgent,
    });

    sendSuccess(
      res,
      {
        id: demoRequest._id,
        name: demoRequest.name,
        email: demoRequest.email,
        company: demoRequest.company,
        status: demoRequest.status,
        message: isDuplicate
          ? 'Your demo request has already been recorded. Our team will contact you shortly.'
          : 'Thank you! Your personalized VIP demo request has been received.',
      },
      201
    );
  };
}

export const demoController = new DemoController();

