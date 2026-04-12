import { logger } from "./logger";
import { getSmtpConfig } from "./env";

export interface MailPayload {
  to: string;
  subject: string;
  text: string;
  html: string;
}

type MailerModule = typeof import("nodemailer");
type MailTransporter = Awaited<ReturnType<MailerModule["createTransport"]>>;

let mailerModule: MailerModule | null | undefined;
let transporter: MailTransporter | null = null;
let transporterKey: string | null = null;

async function getMailerModule() {
  if (mailerModule !== undefined) {
    return mailerModule;
  }

  try {
    mailerModule = await import("nodemailer");
    return mailerModule;
  } catch (error) {
    logger.error({ error }, "Failed to load nodemailer module. Outbound email will be disabled.");
    mailerModule = null;
    return null;
  }
}

async function getTransport() {
  const smtp = getSmtpConfig();
  if (!smtp) {
    return null;
  }

  const nodemailer = await getMailerModule();
  if (!nodemailer) {
    return null;
  }

  const nextKey = `${smtp.host}:${smtp.port}:${smtp.secure}:${smtp.user}:${smtp.from}`;
  if (!transporter || transporterKey !== nextKey) {
    transporter = nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.secure,
      auth: {
        user: smtp.user,
        pass: smtp.pass,
      },
    });
    transporterKey = nextKey;
  }

  return { smtp, transport: transporter };
}

export async function sendMail(payload: MailPayload): Promise<boolean> {
  const transportContext = await getTransport();
  if (!transportContext) {
    logger.warn({ to: payload.to, subject: payload.subject }, "SMTP is not configured, skipping outbound email");
    return false;
  }

  await transportContext.transport.sendMail({
    from: transportContext.smtp.from,
    to: payload.to,
    subject: payload.subject,
    text: payload.text,
    html: payload.html,
  });

  return true;
}
