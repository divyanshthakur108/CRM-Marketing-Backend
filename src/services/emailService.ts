import nodemailer, { Transporter } from 'nodemailer';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

export interface SendInviteEmailParams {
  to: string;
  clientName: string;
  organizationName: string;
  inviteLink: string;
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
}

export const emailService = new EmailService();
