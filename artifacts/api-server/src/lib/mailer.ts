import * as nodemailer from "nodemailer";
import { logger } from "./logger";
import { getSmtpConfig } from "./env";

export interface MailPayload {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export async function sendMail(payload: MailPayload): Promise<boolean> {
  const smtp = getSmtpConfig();

  if (!smtp) {
    logger.warn({ to: payload.to, subject: payload.subject }, "SMTP is not configured, skipping outbound email");
    return false;
  }

  const transport = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    auth: {
      user: smtp.user,
      pass: smtp.pass,
    },
  });

  await transport.sendMail({
    from: smtp.from,
    to: payload.to,
    subject: payload.subject,
    text: payload.text,
    html: payload.html,
  });

  return true;
}
