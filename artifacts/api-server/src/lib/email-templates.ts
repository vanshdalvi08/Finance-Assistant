function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const reforixRxLogoDataUrl =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAABAAAAAOKCAIAAACK87XkAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGYktHRAD/AP8A/6C9p5MAAAAldEVYdGRhdGU6Y3JlYXRlADIwMjYtMDQtMjVUMTc6NTI6MjgrMDA6MDDddK4KAAAAJXRFWHRkYXRlOm1vZGlmeQAyMDI2LTA0LTI1VDE3OjUyOjI4KzAwOjAwrCkWtgAAACh0RVh0ZGF0ZTp0aW1lc3RhbXAAMjAyNi0wNC0yNVQxNzo1MjoyOSswMDowMF1LPN0AAIAASURBVHja7N13fFRV+j/wc+tMCimEBBJSAF0VCygqLooUpYm6gGJBxd7WsmtFUXfV3RV776Li2jsK9i4qurp2bKu0JKQBISF15rbfH59vzu8aSEhCwp3MfN4vXryGZJjc3Lkz8zznPOc5SlFRkSAiIiIioviiKN5mv64GfWBERERERLTtMAEgIiIiIkogTACIiIiIiBIIEwAiIiIiogTCBICIiIiIKIEwASAiIiIiSiBMAIiIiIiIEggTACIiIiKiBMIEgIiIiIgogTABICIiIiKKQ57HnYCJiIiIiBKJ53mbpgFMAIiIiIiI4lmrHIAJABERERFRAmECQEREREQU5/yTAEwAiIiIiIjin8wB9KCPhIiIiIiIup+iaJv9OmcAiIiIiIgSCGcAiIiIiIjiEPcBICIiIiIiJgBERERERImECQARERERUQJhAkBERERElECYABARERERJRAmAERERERECYQJABERERFRAmECQERERESUQJgAEBERERElECYAREREREQJhAkAEREREVECYQJARERERJRAmAAQERERESUQJgBERERERAmECQARERERUQJhAkBERERElECYABARERERJRAmAERERERECYQJABERERFRAmECQERERESUQJgAEBERERElECYAREREREQJhAkAEREREVECYQJARERERJRAmAAQERERESUQJgBERERERAmECQARERERUQJhAkBERERElECYABARERERJRBdURQhhOd5QR8JERERERF1I3ezX+UMABERERFRAmECQERERESUQJgAEBERERElECYAREREREQJhAkAEREREVECYQJARERERJRAmAAQERERESUQnTsAEBERERHFH+z3tSnOABARERERJRAmAERERERECYQJABERERFRAmECQERERESUQJgAEBERERElECYAREREREQJhAkAEREREVEC0YM+ACIiIiIi6k4tOwBwHwAiIiIiooTHBICIiIiIKIEwASAiIiIiSiBMAIiIiIiIEggTACIiIiKiBMIEgIiIiIgogTABICIiIiJKIKqiKC2NQomIiIiIKM5xBoCIiIiIKIEwASAiIiIiSiBMAIiIiIiIEggTACIiIiKiBMIEgIiIiIgogTABICIiIiJKIEwAiIiIiIgSCBMAIiIiIqIEwgSAiIiIiCiBMAEgIiIiIkogTACIiIiIiBIIEwAiIiIiogTCBICIiIiIKIEwASAiIiIiSiBMAIiIiIiIEojueV7Qx0BERERERNsIZwCIiIiIiBIIEwAiIiIiogTCBICIiIiIKIEwASAiIiIiSiBMAIiIiIiIEggTACIiIiKiBMIEgIiIiIgogTABICIiIiJKIEwAiIiIiIgSCBMAIiIiIqIEwgSAiIiIiCiBMAEgIiIiIkogTACIiIiIiBIIEwAiIiIiogTCBICIiIiIKIHoQR9A1ymK0s53Pc8L+gCJiIiIiLa19oNkwRkAIiIiIqKEwgSAiIiIiCiBMAEgIiIiIkogTACIiIiIiBIIEwAiIiIiogTCBICIiIiIKIEwASAiIiIiSiC9eB+A9qEBKncDICIiIqIEscUdAIAzAERERERE8aCDY99MAIiIiIiIEggTACIiIiKiONGRSQAmAERERERE8cPzvPbTgF6/CLitX6+DayCIiIiIiOKP53ltxcOcASAiIiIiSiBMAIiIiIiIEkgvLgFqv7aJOwAQERERUfvaLxrvvfFk+78XZwCIiIiIKBEl7JJRJgBERERElHASNvoXTACIiIiIiBIKEwAiIiIiSiyJPPwvevUiYCIiIiKiTknw0B84A0BERERECYHRPzABICIiIiJKIKqiKEyGiIiIiIgSBGcAiIiIiIgSCBMAIiIiIkoIndrZt/duA7xF7AJERERERIkCYX37BfBxHPoDZwCIiIiIKLG0E+LHffQvmAAQERERESUUJgBERERElHA2O9KfCMP/ggkAERERESWmVuF+gkT/gouAiYiIiChhxWvQ3/5aZ84AEBERERElECYAREREREQJhAkAEREREVECYQJARERERJRAmAAQERERESUQJgBERERERAmECQARERERUQLhPgBERERERHGlrR0AgDMAREREREQJhAkAEREREVECYQJARERERJRAmAAQERERESUQJgBERERERAmECQARERERUQJhAkBERERElEB0z/OCPgYiIiIiIuo2iPDb2g2AMwBERERERAmECQARERERUQJhAkBERERElECYABARERERJRAmAERERERECYQJABERERFRAmECQERERESUQPSgD4CIqKe01f8YuAsKERHFO3ezX+UMABElqPbTAyIionjFBICIEhdzACIiSkBMAIiIiIiIEggTACJKaJwEICKiRMNFwESU6JADeJ7XVjLA5cJERBRPmAAQUa/XLaP47TxIZxODzh4PEwwiItqWWAJERERERJRAOANAPcJ1XU3THMepq6urr693XVd+vUd/7taM1G7NKCxLR7qmp89bBx9f3q39n2uaZnJysmEYiqLouo4bQghVVRVF8TwP/911XcdxVFVFTRH+1jTNtm15Z/njZN0R7o9/2rat67rnea7rKoqCO/h/BNctUDzxPA+fF3h14JWCi9w0zaampjVr1vhfNR18wQYuRmYOVVXFJ29qampGRoZhGI7j4I3F8zzHcTRNC/pUUQ+S10mrC4wJAPUIVVVVVV27du2kSZNOO+20Pn362LataVpPv1+39Qba1te7KyFp6/E7+8aKT77EEVQCgEvRdV0E67jheV40GrVtu7m5ubGxsaGhobGxsbm52bbt6urqpqYmZLORSCQSiTQ0NDQ0NKxfv76xsTEajQohkpKSUlNTQ6GQEMIwDNd1Ec3gGkMoj5/ufy0YhhGNRmXQjyPBDVVVkQbgnvhbVdVuPD9EMcJxHCGEoiiWZZmmKYSIRCK6rjc0NKxbt+6JJ57Iz893XdcwDMSsm32Q7gqse1p3ve+19TiO4xiGIYRQVbWpqUnXdV3Xbdv+3//+d9ttt23YsEF+13Vd0zTbOp8U35gAUI9AAtDQ0NCnT58//vGPaWlp/oHP2NSRN9/u+hV6ywdVvOrCOLrneZFIpLGxsbGxsb6+fu3atdXV1VVVVbW1tRs2bKivr6+vr6+trcXXKysrN2zYYNu2oih9+vTp06cPrn9MHSArUBTFcRzLsnRdx4AcfpBhGJFIBIkBIiEM1ImWGYPOHjlR7MMFb9t2KBSyLEsIkZyc7DhORUXFueeee8wxx4iWsX+O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";

function brandHeader(): string {
  return `
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;">
      <img src="${reforixRxLogoDataUrl}" alt="Reforix Payroll" width="64" height="64" style="display:block;width:64px;height:64px;border:0;outline:none;text-decoration:none;border-radius:14px;object-fit:cover;" />
      <div>
        <div style="font-size:12px;letter-spacing:0.16em;text-transform:uppercase;color:#93c5fd;font-weight:700;line-height:1;">Reforix</div>
        <div style="font-size:15px;font-weight:700;color:#f8fafc;line-height:1.2;margin-top:2px;">Payroll</div>
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
