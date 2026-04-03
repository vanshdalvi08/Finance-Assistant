function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function baseLayout(title: string, body: string): string {
  return `
    <div style="background:#0f172a;padding:32px 0;font-family:Inter,Arial,sans-serif;color:#e2e8f0;">
      <div style="max-width:640px;margin:0 auto;padding:0 20px;">
        <div style="background:#111827;border:1px solid #1f2937;border-radius:20px;padding:32px;">
          <div style="font-size:12px;letter-spacing:0.18em;text-transform:uppercase;color:#94a3b8;margin-bottom:12px;">Yojak</div>
          <h1 style="margin:0 0 20px;font-size:28px;line-height:1.2;color:#f8fafc;">${title}</h1>
          ${body}
        </div>
        <p style="color:#64748b;font-size:12px;line-height:1.7;margin:16px 4px 0;">This is an automated email from Yojak.</p>
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
    "Your Yojak account is ready.",
    `Login email: ${input.loginEmail}`,
    `Employee ID: ${input.employeeId}`,
    `Temporary password: ${input.temporaryPassword}`,
    `Portal: ${input.portalUrl}`,
    "",
    "Please sign in and change your password after the first login.",
  ].join("\n");

  const html = baseLayout(
    "Your Yojak account is ready",
    `
      <p style="font-size:15px;line-height:1.75;color:#cbd5e1;margin:0 0 24px;">Hello ${escapeHtml(input.name)}, your employee account has been created.</p>
      <div style="background:#0b1220;border:1px solid #243244;border-radius:16px;padding:18px 20px;margin-bottom:20px;">
        <p style="margin:0 0 8px;color:#94a3b8;font-size:12px;text-transform:uppercase;letter-spacing:.12em;">Login details</p>
        <p style="margin:0;color:#e2e8f0;font-size:15px;line-height:1.8;">Email: <strong>${escapeHtml(input.loginEmail)}</strong><br/>Employee ID: <strong>${escapeHtml(input.employeeId)}</strong><br/>Temporary password: <strong>${escapeHtml(input.temporaryPassword)}</strong></p>
      </div>
      <a href="${escapeHtml(input.portalUrl)}" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;padding:12px 18px;border-radius:12px;font-weight:600;">Open Portal</a>
      <p style="font-size:13px;line-height:1.7;color:#94a3b8;margin:20px 0 0;">Please sign in and change your password after the first login.</p>
    `,
  );

  return {
    subject: "Your Yojak Account is Ready",
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
    "We received a request to reset your Yojak password.",
    `Reset your password here: ${input.resetUrl}`,
    "",
    "If you did not request this, you can ignore this email.",
  ].join("\n");

  const html = baseLayout(
    "Reset your Yojak password",
    `
      <p style="font-size:15px;line-height:1.75;color:#cbd5e1;margin:0 0 24px;">We received a request to reset the password on your account.</p>
      <a href="${escapeHtml(input.resetUrl)}" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;padding:12px 18px;border-radius:12px;font-weight:600;">Reset Password</a>
      <p style="font-size:13px;line-height:1.7;color:#94a3b8;margin:20px 0 0;">If you did not request this, you can safely ignore this email.</p>
    `,
  );

  return {
    subject: "Reset your Yojak password",
    text,
    html,
  };
}
