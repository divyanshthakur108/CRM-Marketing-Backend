import nodemailer, { Transporter } from 'nodemailer';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

export interface SendInviteEmailParams {
  to: string;
  clientName: string;
  organizationName: string;
  inviteLink: string;
}

export interface DemoNotificationData {
  requestId: string;
  name: string;
  email: string;
  phone: string;
  company: string;
  teamSize: string;
  createdAt: Date | string;
}

class EmailService {
  private transporter: Transporter | null = null;

  constructor() {
    if (env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS) {
      this.transporter = nodemailer.createTransport({
        host: env.SMTP_HOST,
        port: env.SMTP_PORT || 587,
        secure: env.SMTP_PORT === 465,
        auth: {
          user: env.SMTP_USER,
          pass: env.SMTP_PASS,
        },
      });
      logger.info('Nodemailer SMTP transporter initialized');
    }
  }

  /**
   * Dispatches an invitation email to a newly created client user.
   */
  public async sendClientInvitation(params: SendInviteEmailParams): Promise<void> {
    const { to, clientName, organizationName, inviteLink } = params;

    const subject = `Welcome to RealCRM: You are invited to lead ${organizationName}`;
    const html = `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>RealCRM Workspace Invitation</title>
      </head>
      <body style="margin: 0; padding: 0; background-color: #0b0f19; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; -webkit-font-smoothing: antialiased;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: #0b0f19; width: 100%; padding: 40px 15px;">
          <tr>
            <td align="center">
              <!-- Outer Card -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width: 580px; background-color: #161f30; border: 1px solid #2d3748; border-radius: 12px; overflow: hidden; box-shadow: 0 10px 25px rgba(0, 0, 0, 0.5);">
                <!-- Top Accent Line -->
                <tr>
                  <td style="height: 4px; background: #2563eb; background: linear-gradient(90deg, #2563eb, #6366f1, #38bdf8);"></td>
                </tr>
                
                <!-- Header -->
                <tr>
                  <td style="padding: 28px 32px 20px 32px; border-bottom: 1px solid #1e293b;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td align="left">
                          <span style="font-size: 18px; font-weight: 900; letter-spacing: 2px; color: #ffffff; text-transform: uppercase;">
                            REAL<span style="color: #38bdf8;">CRM</span>
                          </span>
                        </td>
                        <td align="right">
                          <span style="background-color: rgba(37, 99, 235, 0.2); border: 1px solid rgba(56, 189, 248, 0.4); color: #38bdf8; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; padding: 4px 10px; border-radius: 20px; font-family: monospace;">
                            INVITATION
                          </span>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>

                <!-- Body Content -->
                <tr>
                  <td style="padding: 32px 32px 24px 32px; color: #e2e8f0;">
                    <h1 style="margin: 0 0 16px 0; font-size: 22px; font-weight: 800; color: #ffffff; letter-spacing: -0.5px;">
                      Activate Your Agency Workspace
                    </h1>
                    <p style="margin: 0 0 20px 0; font-size: 14px; line-height: 1.6; color: #cbd5e1;">
                      Dear <strong style="color: #ffffff;">${clientName}</strong>,
                    </p>
                    <p style="margin: 0 0 24px 0; font-size: 14px; line-height: 1.6; color: #94a3b8;">
                      You have been designated as the owner administrator for <strong style="color: #ffffff;">${organizationName}</strong> on the RealCRM marketing automation and AI creative management platform.
                    </p>

                    <!-- Details Callout Box -->
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: #0d1524; border: 1px solid #202e47; border-radius: 8px; margin-bottom: 28px;">
                      <tr>
                        <td style="padding: 16px 20px;">
                          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                            <tr>
                              <td style="padding: 4px 0; font-size: 12px; color: #64748b; font-family: monospace; text-transform: uppercase; width: 35%;">Organization:</td>
                              <td style="padding: 4px 0; font-size: 13px; color: #38bdf8; font-weight: 700;">${organizationName}</td>
                            </tr>
                            <tr>
                              <td style="padding: 4px 0; font-size: 12px; color: #64748b; font-family: monospace; text-transform: uppercase;">Assigned Role:</td>
                              <td style="padding: 4px 0; font-size: 13px; color: #ffffff; font-weight: 600;">Workspace Administrator</td>
                            </tr>
                            <tr>
                              <td style="padding: 4px 0; font-size: 12px; color: #64748b; font-family: monospace; text-transform: uppercase;">Link Validity:</td>
                              <td style="padding: 4px 0; font-size: 13px; color: #f59e0b; font-weight: 600;">48 Hours (Single-use)</td>
                            </tr>
                          </table>
                        </td>
                      </tr>
                    </table>

                    <!-- Primary Action Button -->
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom: 28px;">
                      <tr>
                        <td align="center">
                          <a href="${inviteLink}" target="_blank" style="background-color: #2563eb; color: #ffffff !important; display: inline-block; padding: 14px 32px; font-size: 13px; font-weight: 700; text-decoration: none; text-transform: uppercase; letter-spacing: 0.5px; border-radius: 6px; border: 1px solid #3b82f6; box-shadow: 0 4px 12px rgba(37, 99, 235, 0.4);">
                            Activate Account &amp; Set Password &rarr;
                          </a>
                        </td>
                      </tr>
                    </table>

                    <!-- Fallback Link -->
                    <p style="margin: 0 0 8px 0; font-size: 12px; color: #64748b;">
                      Button not working? Copy and paste this URL into your browser:
                    </p>
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: #0b0f19; border: 1px solid #1e293b; border-radius: 6px; margin-bottom: 24px;">
                      <tr>
                        <td style="padding: 12px 14px; font-family: monospace; font-size: 11px; color: #94a3b8; word-break: break-all; line-height: 1.5;">
                          ${inviteLink}
                        </td>
                      </tr>
                    </table>

                    <p style="margin: 0; font-size: 11px; color: #475569; line-height: 1.5;">
                      &#128274; <strong>Security Notice:</strong> This activation link is intended solely for <strong style="color: #64748b;">${to}</strong>. If you did not expect this invitation, please disregard this email.
                    </p>
                  </td>
                </tr>

                <!-- Footer -->
                <tr>
                  <td style="padding: 20px 32px; background-color: #0f172a; border-top: 1px solid #1e293b; text-align: center;">
                    <p style="margin: 0 0 4px 0; font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: 1px;">
                      REALCRM &bull; AI REAL ESTATE MARKETING PLATFORM
                    </p>
                    <p style="margin: 0; font-size: 10px; color: #475569;">
                      Automated platform dispatch &bull; Do not reply to this email
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
      </html>
    `;

    if (this.transporter) {
      try {
        await this.transporter.sendMail({
          from: env.SMTP_FROM,
          to,
          subject,
          html,
          text: `Welcome to RealCRM! You are invited to lead ${organizationName}. Set your password at: ${inviteLink}`,
        });
        logger.info({ to, organizationName }, 'Invitation email dispatched via SMTP');
      } catch (err: unknown) {
        logger.error({ err, to }, 'Failed to dispatch invitation email via SMTP');
      }
    } else {
      // SMTP not configured: Log invite link in development and test environments
      if (env.NODE_ENV !== 'production') {
        console.log('\n========================================================================');
        console.log('✉️  [NODEMAILER DEV DISPATCH: CLIENT INVITATION]');
        console.log(`   Recipient:    ${to} (${clientName})`);
        console.log(`   Organization: ${organizationName}`);
        console.log(`   Invite Link:  ${inviteLink}`);
        console.log(`   Valid For:    48 Hours`);
        console.log('========================================================================\n');
      } else {
        logger.warn(
          { to, organizationName },
          'SMTP not configured in production. Invitation email could not be dispatched.'
        );
      }
    }
  }

  /**
   * Dispatches an alert to the internal sales/growth team about a new VIP Demo Request.
   */
  public async sendDemoBookingNotification(data: DemoNotificationData): Promise<boolean> {
    const recipient = env.DEMO_NOTIFICATION_EMAIL || env.ADMIN_EMAIL;
    const subject = `New VIP Demo Booking – RealCRM`;
    const formattedDate = new Date(data.createdAt).toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata',
      dateStyle: 'medium',
      timeStyle: 'short',
    });
    const cleanPhone = data.phone.replace(/[^0-9]/g, '');

    const html = `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>New VIP Demo Booking – RealCRM</title>
      </head>
      <body style="margin: 0; padding: 0; background-color: #f1f5f9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; -webkit-font-smoothing: antialiased;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: #f1f5f9; width: 100%; padding: 40px 15px;">
          <tr>
            <td align="center">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width: 580px; background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -2px rgba(0, 0, 0, 0.05);">
                
                <!-- Header with Logo and VIP Badge -->
                <tr>
                  <td style="padding: 24px 32px; border-bottom: 1px solid #f1f5f9;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td align="left" style="vertical-align: middle;">
                          <table role="presentation" cellpadding="0" cellspacing="0">
                            <tr>
                              <td style="width: 32px; height: 32px; background-color: #0a0a0a; border-radius: 8px; text-align: center; vertical-align: middle; color: #ffffff; font-weight: 800; font-size: 14px; letter-spacing: 0.5px;">
                                RC
                              </td>
                              <td style="padding-left: 10px; font-size: 18px; font-weight: 800; color: #0f172a; letter-spacing: -0.5px; vertical-align: middle;">
                                RealCRM
                              </td>
                            </tr>
                          </table>
                        </td>
                        <td align="right" style="vertical-align: middle;">
                          <span style="display: inline-block; padding: 4px 10px; border-radius: 20px; font-size: 11px; font-weight: 700; background-color: #fef3c7; color: #b45309; border: 1px solid #fde68a; text-transform: uppercase; letter-spacing: 0.5px;">
                            VIP Demo Lead
                          </span>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>

                <!-- Content Body -->
                <tr>
                  <td style="padding: 32px;">
                    <h1 style="margin: 0 0 6px 0; font-size: 20px; font-weight: 800; color: #0f172a; letter-spacing: -0.5px; line-height: 1.3;">
                      New Demo Request
                    </h1>
                    <p style="margin: 0 0 24px 0; font-size: 14px; color: #64748b; line-height: 1.5;">
                      A new high-intent property professional has submitted a VIP Demo booking request.
                    </p>

                    <!-- Details Card -->
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; overflow: hidden; margin-bottom: 24px;">
                      <tr>
                        <td style="padding: 12px 18px; border-bottom: 1px solid #f1f5f9; color: #64748b; font-size: 13px; font-weight: 500; width: 38%;">
                          Full Name
                        </td>
                        <td style="padding: 12px 18px; border-bottom: 1px solid #f1f5f9; color: #0f172a; font-size: 14px; font-weight: 700;">
                          ${data.name}
                        </td>
                      </tr>
                      <tr>
                        <td style="padding: 12px 18px; border-bottom: 1px solid #f1f5f9; color: #64748b; font-size: 13px; font-weight: 500;">
                          Work Email
                        </td>
                        <td style="padding: 12px 18px; border-bottom: 1px solid #f1f5f9; font-size: 14px;">
                          <a href="mailto:${data.email}" style="color: #2563eb; font-weight: 600; text-decoration: none;">
                            ${data.email}
                          </a>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding: 12px 18px; border-bottom: 1px solid #f1f5f9; color: #64748b; font-size: 13px; font-weight: 500;">
                          Phone (WhatsApp)
                        </td>
                        <td style="padding: 12px 18px; border-bottom: 1px solid #f1f5f9; font-size: 14px;">
                          <a href="tel:${data.phone}" style="color: #0f172a; font-weight: 600; text-decoration: none;">
                            ${data.phone}
                          </a>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding: 12px 18px; border-bottom: 1px solid #f1f5f9; color: #64748b; font-size: 13px; font-weight: 500;">
                          Company / Brokerage
                        </td>
                        <td style="padding: 12px 18px; border-bottom: 1px solid #f1f5f9; color: #0f172a; font-size: 14px; font-weight: 600;">
                          ${data.company}
                        </td>
                      </tr>
                      <tr>
                        <td style="padding: 12px 18px; border-bottom: 1px solid #f1f5f9; color: #64748b; font-size: 13px; font-weight: 500;">
                          Broker Team Size
                        </td>
                        <td style="padding: 12px 18px; border-bottom: 1px solid #f1f5f9; color: #334155; font-size: 14px; font-weight: 500;">
                          ${data.teamSize}
                        </td>
                      </tr>
                      <tr>
                        <td style="padding: 12px 18px; border-bottom: 1px solid #f1f5f9; color: #64748b; font-size: 13px; font-weight: 500;">
                          Request ID
                        </td>
                        <td style="padding: 12px 18px; border-bottom: 1px solid #f1f5f9; font-size: 12px;">
                          <span style="font-family: ui-monospace, Menlo, Monaco, Consolas, monospace; background-color: #e2e8f0; padding: 2px 6px; border-radius: 4px; color: #334155;">
                            ${data.requestId}
                          </span>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding: 12px 18px; color: #64748b; font-size: 13px; font-weight: 500;">
                          Submission Time
                        </td>
                        <td style="padding: 12px 18px; color: #475569; font-size: 13px;">
                          ${formattedDate}
                        </td>
                      </tr>
                    </table>

                    <!-- Action Buttons -->
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="padding-right: 8px;" width="50%">
                          <a href="https://wa.me/${cleanPhone}" style="display: block; text-align: center; background-color: #16a34a; color: #ffffff; font-weight: 600; font-size: 14px; text-decoration: none; padding: 12px 20px; border-radius: 8px;">
                            Chat on WhatsApp
                          </a>
                        </td>
                        <td style="padding-left: 8px;" width="50%">
                          <a href="mailto:${data.email}?subject=Your%20RealCRM%20VIP%20Tour%20Scheduling" style="display: block; text-align: center; background-color: #0f172a; color: #ffffff; font-weight: 600; font-size: 14px; text-decoration: none; padding: 12px 20px; border-radius: 8px;">
                            Reply via Email
                          </a>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>

                <!-- Footer -->
                <tr>
                  <td style="padding: 20px 32px; background-color: #f8fafc; border-top: 1px solid #e2e8f0; text-align: center;">
                    <p style="margin: 0 0 4px 0; font-size: 12px; color: #64748b;">
                      Automated VIP Booking Alert &bull; RealCRM Inbound Notification Engine
                    </p>
                    <p style="margin: 0; font-size: 11px; color: #94a3b8;">
                      &copy; ${new Date().getFullYear()} RealCRM Platform. All rights reserved.
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
      </html>
    `;

    const plainText = `
New VIP Demo Booking – RealCRM

Request ID: ${data.requestId}
Full Name: ${data.name}
Work Email: ${data.email}
Phone (WhatsApp): ${data.phone}
Company / Brokerage: ${data.company}
Broker Team Size: ${data.teamSize}
Submitted At: ${formattedDate}
    `.trim();

    if (this.transporter) {
      try {
        await this.transporter.sendMail({
          from: env.SMTP_FROM,
          to: recipient,
          subject,
          html,
          text: plainText,
        });
        logger.info({ recipient, requestId: data.requestId }, 'Demo booking admin alert dispatched via SMTP');
        return true;
      } catch (err: unknown) {
        logger.error({ err, recipient, requestId: data.requestId }, 'Failed to dispatch demo booking admin email via SMTP');
        return false;
      }
    } else {
      if (env.NODE_ENV !== 'production') {
        console.log('\n========================================================================');
        console.log('✉️  [NODEMAILER DEV DISPATCH: VIP DEMO NOTIFICATION]');
        console.log(`   Recipient:    ${recipient}`);
        console.log(`   Lead Name:    ${data.name} (${data.company})`);
        console.log(`   Contact:      ${data.phone} / ${data.email}`);
        console.log(`   Team Size:    ${data.teamSize}`);
        console.log('========================================================================\n');
      } else {
        logger.warn(
          { recipient, requestId: data.requestId },
          'SMTP not configured in production. Demo notification email could not be dispatched.'
        );
      }
      return false;
    }
  }

  /**
   * Dispatches a customer confirmation email acknowledging their VIP Demo booking request.
   */
  public async sendDemoConfirmationToVisitor(data: DemoNotificationData): Promise<boolean> {
    const subject = `Your RealCRM VIP Demo Request Has Been Received`;
    const formattedDate = new Date(data.createdAt).toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata',
      dateStyle: 'medium',
      timeStyle: 'short',
    });

    const html = `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Your RealCRM VIP Demo Request Has Been Received</title>
      </head>
      <body style="margin: 0; padding: 0; background-color: #f1f5f9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; -webkit-font-smoothing: antialiased;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: #f1f5f9; width: 100%; padding: 40px 15px;">
          <tr>
            <td align="center">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width: 580px; background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -2px rgba(0, 0, 0, 0.05);">
                
                <!-- Header with Logo and Status Badge -->
                <tr>
                  <td style="padding: 24px 32px; border-bottom: 1px solid #f1f5f9;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td align="left" style="vertical-align: middle;">
                          <table role="presentation" cellpadding="0" cellspacing="0">
                            <tr>
                              <td style="width: 32px; height: 32px; background-color: #0a0a0a; border-radius: 8px; text-align: center; vertical-align: middle; color: #ffffff; font-weight: 800; font-size: 14px; letter-spacing: 0.5px;">
                                RC
                              </td>
                              <td style="padding-left: 10px; font-size: 18px; font-weight: 800; color: #0f172a; letter-spacing: -0.5px; vertical-align: middle;">
                                RealCRM
                              </td>
                            </tr>
                          </table>
                        </td>
                        <td align="right" style="vertical-align: middle;">
                          <span style="display: inline-block; padding: 4px 10px; border-radius: 20px; font-size: 11px; font-weight: 700; background-color: #ecfdf5; color: #047857; border: 1px solid #a7f3d0; text-transform: uppercase; letter-spacing: 0.5px;">
                            DEMO REQUEST CONFIRMED
                          </span>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>

                <!-- Content Body -->
                <tr>
                  <td style="padding: 32px;">
                    <h1 style="margin: 0 0 12px 0; font-size: 22px; font-weight: 800; color: #0f172a; letter-spacing: -0.5px; line-height: 1.3;">
                      Thank You for Choosing RealCRM!
                    </h1>
                    <p style="margin: 0 0 16px 0; font-size: 15px; font-weight: 600; color: #1e293b;">
                      Hi ${data.name},
                    </p>
                    <p style="margin: 0 0 24px 0; font-size: 14px; color: #475569; line-height: 1.6;">
                      We have successfully received your VIP Demo request for <strong>${data.company}</strong>. Our real estate solutions consultant is preparing a personalized walkthrough of the AI Video Lab, automated WhatsApp marketing pipelines, and lead conversion workflows tailored to your team.
                    </p>

                    <!-- Booking Details Card -->
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; overflow: hidden; margin-bottom: 24px;">
                      <tr>
                        <td colspan="2" style="padding: 14px 18px 8px 18px; font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px;">
                          Booking Summary
                        </td>
                      </tr>
                      <tr>
                        <td style="padding: 10px 18px; border-top: 1px solid #f1f5f9; color: #64748b; font-size: 13px; font-weight: 500; width: 38%;">
                          Full Name
                        </td>
                        <td style="padding: 10px 18px; border-top: 1px solid #f1f5f9; color: #0f172a; font-size: 14px; font-weight: 700;">
                          ${data.name}
                        </td>
                      </tr>
                      <tr>
                        <td style="padding: 10px 18px; border-top: 1px solid #f1f5f9; color: #64748b; font-size: 13px; font-weight: 500;">
                          Work Email
                        </td>
                        <td style="padding: 10px 18px; border-top: 1px solid #f1f5f9; color: #334155; font-size: 14px; font-weight: 500;">
                          ${data.email}
                        </td>
                      </tr>
                      <tr>
                        <td style="padding: 10px 18px; border-top: 1px solid #f1f5f9; color: #64748b; font-size: 13px; font-weight: 500;">
                          Phone (WhatsApp)
                        </td>
                        <td style="padding: 10px 18px; border-top: 1px solid #f1f5f9; color: #0f172a; font-size: 14px; font-weight: 600;">
                          ${data.phone}
                        </td>
                      </tr>
                      <tr>
                        <td style="padding: 10px 18px; border-top: 1px solid #f1f5f9; color: #64748b; font-size: 13px; font-weight: 500;">
                          Company / Brokerage
                        </td>
                        <td style="padding: 10px 18px; border-top: 1px solid #f1f5f9; color: #0f172a; font-size: 14px; font-weight: 600;">
                          ${data.company}
                        </td>
                      </tr>
                      <tr>
                        <td style="padding: 10px 18px; border-top: 1px solid #f1f5f9; color: #64748b; font-size: 13px; font-weight: 500;">
                          Broker Team Size
                        </td>
                        <td style="padding: 10px 18px; border-top: 1px solid #f1f5f9; color: #334155; font-size: 14px; font-weight: 500;">
                          ${data.teamSize}
                        </td>
                      </tr>
                      <tr>
                        <td style="padding: 10px 18px; border-top: 1px solid #f1f5f9; color: #64748b; font-size: 13px; font-weight: 500;">
                          Request ID
                        </td>
                        <td style="padding: 10px 18px; border-top: 1px solid #f1f5f9; font-size: 12px;">
                          <span style="font-family: ui-monospace, Menlo, Monaco, Consolas, monospace; background-color: #e2e8f0; padding: 2px 6px; border-radius: 4px; color: #334155;">
                            ${data.requestId}
                          </span>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding: 10px 18px; border-top: 1px solid #f1f5f9; color: #64748b; font-size: 13px; font-weight: 500;">
                          Submission Date
                        </td>
                        <td style="padding: 10px 18px; border-top: 1px solid #f1f5f9; color: #475569; font-size: 13px;">
                          ${formattedDate}
                        </td>
                      </tr>
                    </table>

                    <!-- What's Next Callout -->
                    <div style="background-color: #eff6ff; border-left: 3px solid #2563eb; border-radius: 0 8px 8px 0; padding: 16px 20px; margin-bottom: 24px;">
                      <div style="font-size: 13px; font-weight: 700; color: #1e40af; margin-bottom: 4px;">
                        What Happens Next?
                      </div>
                      <p style="margin: 0; font-size: 13px; color: #2563eb; line-height: 1.5;">
                        Our dedicated real estate specialist will reach out to coordinate a convenient time for your interactive walkthrough. You will see firsthand how property developers and brokerages use RealCRM to capture, engage, and close transactions faster.
                      </p>
                    </div>

                    <p style="margin: 0 0 4px 0; font-size: 14px; color: #475569;">
                      Warm regards,
                    </p>
                    <p style="margin: 0; font-size: 14px; font-weight: 700; color: #0f172a;">
                      The RealCRM Team
                    </p>
                  </td>
                </tr>

                <!-- Footer -->
                <tr>
                  <td style="padding: 24px 32px; background-color: #f8fafc; border-top: 1px solid #e2e8f0; text-align: center;">
                    <p style="margin: 0 0 6px 0; font-size: 12px; color: #64748b; font-weight: 500;">
                      RealCRM &mdash; The AI Operating System for Modern Real Estate Teams
                    </p>
                    <p style="margin: 0; font-size: 11px; color: #94a3b8;">
                      &copy; ${new Date().getFullYear()} RealCRM Platform. All rights reserved.
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
      </html>
    `;

    const plainText = `
Hello ${data.name},

Thank you for choosing RealCRM!

We have received your VIP Demo request for ${data.company} (${data.teamSize}).

Booking Summary:
- Request ID: ${data.requestId}
- Full Name: ${data.name}
- Work Email: ${data.email}
- Phone: ${data.phone}
- Company: ${data.company}
- Team Size: ${data.teamSize}
- Submission Date: ${formattedDate}

What Happens Next:
Our team will reach out directly to coordinate a convenient time for your personalized product walkthrough.

Warm regards,
The RealCRM Team
    `.trim();

    if (this.transporter) {
      try {
        await this.transporter.sendMail({
          from: env.SMTP_FROM,
          to: data.email,
          subject,
          html,
          text: plainText,
        });
        logger.info({ to: data.email, requestId: data.requestId }, 'Demo confirmation email sent to visitor');
        return true;
      } catch (err: unknown) {
        logger.error({ err, to: data.email, requestId: data.requestId }, 'Failed to dispatch demo confirmation email to visitor');
        return false;
      }
    } else {
      if (env.NODE_ENV !== 'production') {
        console.log('\n========================================================================');
        console.log('✉️  [NODEMAILER DEV DISPATCH: VISITOR CONFIRMATION]');
        console.log(`   Recipient:    ${data.email} (${data.name})`);
        console.log(`   Subject:      ${subject}`);
        console.log('========================================================================\n');
      }
      return false;
    }
  }
}

export const emailService = new EmailService();
