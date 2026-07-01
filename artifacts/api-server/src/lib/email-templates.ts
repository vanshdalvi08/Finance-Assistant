function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function brandHeader(): string {
  return `
    <div style="margin-bottom:20px;">
      <div style="font-size:32px;font-weight:800;color:#f8fafc;line-height:1.05;letter-spacing:-0.03em;">
        Reforix Payroll
      </div>
    </div>
  `;
}

function baseLayout(title: string, body: string): string {
  return `
    <div style="background:#0f172a;padding:32px 0;font-family:Inter,Arial,sans-serif;color:#e2e8f0;">
      <div style="max-width:640px;margin:0 auto;padding:0 20px;">
        <div style="background:#111827;border:1px solid #1f2937;border-radius:20px;padding:32px;">
          ${brandHeader()}
          <h1 style="margin:0 0 20px;font-size:24px;line-height:1.25;color:#f8fafc;">${title}</h1>
          ${body}
        </div>
        <p style="color:#64748b;font-size:12px;line-height:1.7;margin:16px 4px 0;">This is an automated email from Reforix Payroll.</p>
      </div>
    </div>
  `;
}

export function onboardingEmailTemplate(input: {
  name: string;
  employeeId: string;
  temporaryPassword: string;
  portalUrl: string;
  loginEmail: string;
}): { subject: string; text: string; html: string } {
  const text = [
    `Hello ${input.name},`,
    "",
    "Your Reforix Payroll account is ready.",
    `Login email: ${input.loginEmail}`,
    `Employee ID: ${input.employeeId}`,
    `Temporary password: ${input.temporaryPassword}`,
    `Portal: ${input.portalUrl}`,
    "",
    "Please sign in and change your password after the first login.",
  ].join("\n");

  const html = baseLayout(
    "Your Reforix Payroll account is ready",
    `
      <p style="font-size:15px;line-height:1.75;color:#cbd5e1;margin:0 0 24px;">Hello ${escapeHtml(input.name)}, your employee account has been created.</p>
      <div style="background:#0b1220;border:1px solid #243244;border-radius:16px;padding:18px 20px;margin-bottom:20px;">
        <p style="margin:0 0 8px;color:#94a3b8;font-size:12px;text-transform:uppercase;letter-spacing:.12em;">Login details</p>
        <p style="margin:0;color:#e2e8f0;font-size:15px;line-height:1.8;">Email: <strong>${escapeHtml(input.loginEmail)}</strong><br/>Employee ID: <strong>${escapeHtml(input.employeeId)}</strong><br/>Temporary password: <strong>${escapeHtml(input.temporaryPassword)}</strong></p>
      </div>
      <a href="${escapeHtml(input.portalUrl)}" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;padding:12px 18px;border-radius:12px;font-weight:700;">Go to Dashboard</a>
      <p style="font-size:13px;line-height:1.7;color:#94a3b8;margin:20px 0 0;">Please sign in and change your password after the first login.</p>
    `,
  );

  return {
    subject: "Your Reforix Payroll Account is Ready",
    text,
    html,
  };
}

export function clientPortalEmailTemplate(input: {
  name: string;
  loginEmail: string;
  temporaryPassword: string;
  portalUrl: string;
}): { subject: string; text: string; html: string } {
  const text = [
    `Hello ${input.name},`,
    "",
    "Your Reforix Payroll client portal account has been created.",
    `Login email: ${input.loginEmail}`,
    `Temporary password: ${input.temporaryPassword}`,
    `Portal: ${input.portalUrl}`,
    "",
    "Please sign in and change your password when you first access the portal.",
  ].join("\n");

  const html = baseLayout(
    "Your Reforix Payroll client portal is ready",
    `
      <p style="font-size:15px;line-height:1.75;color:#cbd5e1;margin:0 0 24px;">Hello ${escapeHtml(input.name)}, your client portal account has been created.</p>
      <div style="background:#0b1220;border:1px solid #243244;border-radius:16px;padding:18px 20px;margin-bottom:20px;">
        <p style="margin:0 0 8px;color:#94a3b8;font-size:12px;text-transform:uppercase;letter-spacing:.12em;">Login details</p>
        <p style="margin:0;color:#e2e8f0;font-size:15px;line-height:1.8;">Email: <strong>${escapeHtml(input.loginEmail)}</strong><br/>Temporary password: <strong>${escapeHtml(input.temporaryPassword)}</strong></p>
      </div>
      <a href="${escapeHtml(input.portalUrl)}" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;padding:12px 18px;border-radius:12px;font-weight:700;">Go to Dashboard</a>
      <p style="font-size:13px;line-height:1.7;color:#94a3b8;margin:20px 0 0;">Please sign in and change your password when you first access the portal.</p>
    `,
  );

  return {
    subject: "Your Reforix Payroll client portal is ready",
    text,
    html,
  };
}

export function tenantOwnerEmailTemplate(input: {
  name: string;
  loginEmail: string;
  temporaryPassword: string;
  portalUrl: string;
}): { subject: string; text: string; html: string } {
  const text = [
    `Hello ${input.name},`,
    "",
    "Your Reforix Payroll tenant admin account has been created.",
    `Login email: ${input.loginEmail}`,
    `Temporary password: ${input.temporaryPassword}`,
    `Portal: ${input.portalUrl}`,
    "",
    "Please sign in and change your password when you first access the dashboard.",
  ].join("\n");

  const html = baseLayout(
    "Your Reforix Payroll tenant is ready",
    `
      <p style="font-size:15px;line-height:1.75;color:#cbd5e1;margin:0 0 24px;">Hello ${escapeHtml(input.name)}, your tenant admin account has been created.</p>
      <div style="background:#0b1220;border:1px solid #243244;border-radius:16px;padding:18px 20px;margin-bottom:20px;">
        <p style="margin:0 0 8px;color:#94a3b8;font-size:12px;text-transform:uppercase;letter-spacing:.12em;">Login details</p>
        <p style="margin:0;color:#e2e8f0;font-size:15px;line-height:1.8;">Email: <strong>${escapeHtml(input.loginEmail)}</strong><br/>Temporary password: <strong>${escapeHtml(input.temporaryPassword)}</strong></p>
      </div>
      <a href="${escapeHtml(input.portalUrl)}" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;padding:12px 18px;border-radius:12px;font-weight:700;">Go to Dashboard</a>
      <p style="font-size:13px;line-height:1.7;color:#94a3b8;margin:20px 0 0;">Please sign in and change your password when you first access the dashboard.</p>
    `,
  );

  return {
    subject: "Your Reforix Payroll tenant is ready",
    text,
    html,
  };
}

export function passwordResetEmailTemplate(input: {
  name: string;
  resetUrl: string;
}): { subject: string; text: string; html: string } {
  const text = [
    `Hello ${input.name},`,
    "",
    "We received a request to reset your Reforix Payroll password.",
    `Reset your password here: ${input.resetUrl}`,
    "",
    "If you did not request this, you can ignore this email.",
  ].join("\n");

  const html = baseLayout(
    "Reset your Reforix Payroll password",
    `
      <p style="font-size:15px;line-height:1.75;color:#cbd5e1;margin:0 0 24px;">We received a request to reset the password on your account.</p>
      <a href="${escapeHtml(input.resetUrl)}" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;padding:12px 18px;border-radius:12px;font-weight:700;">Reset Password</a>
      <p style="font-size:13px;line-height:1.7;color:#94a3b8;margin:20px 0 0;">If you did not request this, you can safely ignore this email.</p>
    `,
  );

  return {
    subject: "Reset your Reforix Payroll password",
    text,
    html,
  };
}

export function notificationPreviewEmailTemplate(input: {
  name: string;
  title: string;
  message: string;
  actionUrl?: string;
  actionLabel?: string;
}): { subject: string; text: string; html: string } {
  const safeName = input.name.trim() || "there";
  const safeTitle = input.title.trim() || "You have a new Reforix Payroll notification";
  const safeMessage = input.message.trim() || "There is a new update in your Reforix Payroll workspace.";
  const actionLabel = input.actionLabel?.trim() || "Go to Dashboard";

  const text = [
    `Hello ${safeName},`,
    "",
    safeTitle,
    safeMessage,
    input.actionUrl ? `Go to Dashboard: ${input.actionUrl}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const html = baseLayout(
    safeTitle,
    `
      <p style="font-size:15px;line-height:1.75;color:#cbd5e1;margin:0 0 20px;">Hello ${escapeHtml(safeName)},</p>
      <div style="background:#0b1220;border:1px solid #243244;border-radius:16px;padding:18px 20px;">
        <p style="margin:0;color:#e2e8f0;font-size:15px;line-height:1.8;">${escapeHtml(safeMessage)}</p>
      </div>
      ${
        input.actionUrl
          ? `<a href="${escapeHtml(input.actionUrl)}" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;padding:12px 18px;border-radius:12px;font-weight:700;margin-top:20px;">${escapeHtml(actionLabel)}</a>`
          : ""
      }
    `,
  );

  return {
    subject: safeTitle,
    text,
    html,
  };
}

export function notificationEmailTemplate(input: {
    recipientName: string;
    title: string;
    body: string;
    link?: string | null;
    appUrl: string;
}): { subject: string; text: string; html: string } {
  const link = input.link?.trim();
  const resolvedLink = link ? (link.startsWith("http") ? link : `${input.appUrl.replace(/\/$/, "")}${link}`) : input.appUrl;
  const text = [
    `Hello ${input.recipientName},`,
    "",
    input.title,
    input.body,
    link ? `Open it here: ${resolvedLink}` : `Open your portal: ${resolvedLink}`,
    "",
    "This is an automated notification from Reforix Payroll.",
  ].join("\n");

  const html = baseLayout(
    escapeHtml(input.title),
    `
      <p style="font-size:15px;line-height:1.75;color:#cbd5e1;margin:0 0 18px;">Hello ${escapeHtml(input.recipientName)},</p>
      <p style="font-size:15px;line-height:1.8;color:#e2e8f0;margin:0 0 12px;">${escapeHtml(input.body)}</p>
      <a href="${escapeHtml(resolvedLink)}" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;padding:12px 18px;border-radius:12px;font-weight:700;">Go to Dashboard</a>
      <p style="font-size:13px;line-height:1.7;color:#94a3b8;margin:20px 0 0;">This is an automated notification from Reforix Payroll.</p>
    `,
  );

  return {
    subject: input.title,
    text,
    html,
  };
}

export function salaryPaymentEmailTemplate(input: {
  employeeName: string;
  payPeriod: string;
  paymentDate: string;
  grossAmount: number;
  deductions: number;
  netAmount: number;
}): { subject: string; text: string; html: string } {
  const money = (value: number) => `INR ${Math.round(value).toLocaleString("en-IN")}`;
  const text = [
    `Hello ${input.employeeName},`,
    "",
    `Your salary for ${input.payPeriod} has been processed successfully.`,
    `Payment date: ${input.paymentDate}`,
    `Gross earnings: ${money(input.grossAmount)}`,
    `Deductions: ${money(input.deductions)}`,
    `Net salary: ${money(input.netAmount)}`,
    "",
    "Your salary slip PDF is attached and is also saved in your employee portal.",
  ].join("\n");

  const html = baseLayout(
    "Salary payment processed",
    `
      <p style="font-size:15px;line-height:1.7;color:#cbd5e1;margin:0 0 18px;">Hello ${escapeHtml(input.employeeName)}, your salary for <strong>${escapeHtml(input.payPeriod)}</strong> has been processed successfully.</p>
      <div style="background:linear-gradient(135deg,#1d4ed8,#0f766e);border-radius:18px;padding:22px 24px;margin:0 0 18px;">
        <p style="margin:0 0 8px;color:#dbeafe;font-size:12px;text-transform:uppercase;letter-spacing:.12em;">Net salary credited</p>
        <p style="margin:0;color:#ffffff;font-size:32px;line-height:1.1;font-weight:800;">${money(input.netAmount)}</p>
        <p style="margin:10px 0 0;color:#dbeafe;font-size:13px;">Payment date: ${escapeHtml(input.paymentDate)}</p>
      </div>
      <table style="width:100%;border-collapse:separate;border-spacing:0;background:#0b1220;border:1px solid #243244;border-radius:14px;overflow:hidden;">
        <tr>
          <td style="padding:12px 14px;color:#94a3b8;border-bottom:1px solid #243244;">Pay period</td>
          <td style="padding:12px 14px;color:#f8fafc;text-align:right;border-bottom:1px solid #243244;font-weight:700;">${escapeHtml(input.payPeriod)}</td>
        </tr>
        <tr>
          <td style="padding:12px 14px;color:#94a3b8;border-bottom:1px solid #243244;">Gross earnings</td>
          <td style="padding:12px 14px;color:#f8fafc;text-align:right;border-bottom:1px solid #243244;">${money(input.grossAmount)}</td>
        </tr>
        <tr>
          <td style="padding:12px 14px;color:#94a3b8;border-bottom:1px solid #243244;">Deductions</td>
          <td style="padding:12px 14px;color:#f8fafc;text-align:right;border-bottom:1px solid #243244;">${money(input.deductions)}</td>
        </tr>
        <tr>
          <td style="padding:12px 14px;color:#e2e8f0;font-weight:700;">Attached document</td>
          <td style="padding:12px 14px;color:#f8fafc;text-align:right;font-weight:700;">Salary slip PDF</td>
        </tr>
      </table>
      <p style="font-size:13px;line-height:1.7;color:#94a3b8;margin:18px 0 0;">The attached PDF is your official salary slip. A permanent copy is also available in your employee portal.</p>
    `,
  );

  return { subject: `Salary credited - ${input.payPeriod}`, text, html };
}
