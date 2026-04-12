import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@workspace/db";
import { passwordResetTokensTable, refreshSessionsTable, tenantsTable, usersTable, type ClientBillingInfo, type User } from "@workspace/db/schema";
import { DEFAULT_TENANT_ID } from "./tenants";
import { getAppUrl, getSmtpConfig, isProduction, optionalEnv } from "./env";
import { generateRandomToken, generateTemporaryPassword, hashPassword, hashSha256, verifyPassword } from "./security";
import { ACCESS_TOKEN_TTL, REFRESH_TOKEN_TTL, signAccessToken, signRefreshToken, verifyRefreshToken } from "./jwt";
import { sendMail } from "./mailer";
import { onboardingEmailTemplate, passwordResetEmailTemplate } from "./email-templates";
import { createWelcomeNotification } from "./notifications";
import { logger } from "./logger";
import { uploadProfilePhotoDataUrl } from "./storage";

export interface PublicUser {
  id: string;
  tenantId: string;
  name: string;
  email: string;
  phone: string;
  role: "admin" | "employee" | "client" | "platform_super_admin";
  employeeId: string | null;
  position: string | null;
  department: string | null;
  salary: number;
  payType: "monthly" | "hourly";
  hourlyRate: number;
  profilePhotoUrl: string | null;
  clientInfo: ClientBillingInfo;
  status: "active" | "inactive";
  createdAt: Date;
  updatedAt: Date;
  lastLoginAt: Date | null;
}

export interface LoginResult {
  user: PublicUser;
  accessToken: string;
  refreshToken: string;
}

export interface CreateEmployeeInput {
  tenantId?: string;
  name: string;
  email: string;
  phone: string;
  position: string;
  salary: number;
  payType?: "monthly" | "hourly";
  hourlyRate?: number;
  profilePhotoUrl?: string | null;
  department?: string | null;
  status?: "active" | "inactive";
}

export interface UpdateEmployeeInput {
  id: string;
  tenantId?: string;
  name: string;
  email: string;
  phone: string;
  position: string;
  salary: number;
  payType?: "monthly" | "hourly";
  hourlyRate?: number;
  profilePhotoUrl?: string | null;
  department?: string | null;
  status?: "active" | "inactive";
}

export interface CreateClientInput {
  tenantId?: string;
  name: string;
  email: string;
  phone: string;
  company?: string | null;
  address?: string | null;
  website?: string | null;
  billingEmail?: string | null;
  status?: "active" | "inactive";
}

export interface UpdateClientInput extends CreateClientInput {
  id: string;
}

export interface UpdateOwnProfileInput {
  name: string;
  email: string;
  phone: string;
  position?: string | null;
  department?: string | null;
  profilePhotoUrl?: string | null;
}

function runAuthSideEffect(work: Promise<unknown>, label: string) {
  void work.catch((error) => {
    logger.warn({ err: error, label }, "Failed auth side effect");
  });
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function normalizePhone(phone: string): string {
  return phone.trim();
}

async function resolveProfilePhotoUrl(profilePhotoUrl: string | null | undefined, storageDirectory: string) {
  const value = profilePhotoUrl?.trim();
  if (!value) {
    return null;
  }

  if (!value.startsWith("data:")) {
    return value;
  }

  const uploaded = await uploadProfilePhotoDataUrl({
    dataUrl: value,
    fileName: "profile-photo.png",
    actorId: storageDirectory,
  });
  return uploaded.url ?? value;
}

function publicUser(user: User): PublicUser {
  return {
    id: user.id,
    tenantId: user.tenantId,
    name: user.name,
    email: user.email,
    phone: user.phone,
    role: user.role,
    employeeId: user.employeeId ?? null,
    position: user.position ?? null,
    department: user.department ?? null,
    salary: user.salary,
    payType: user.payType,
    hourlyRate: user.hourlyRate,
    profilePhotoUrl: user.profilePhotoUrl ?? null,
    clientInfo: user.clientInfo ?? {},
    status: user.status,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    lastLoginAt: user.lastLoginAt ?? null,
  };
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "23505";
}

async function findUserByEmail(email: string, tenantId?: string): Promise<User | null> {
  const rows = await db
    .select()
    .from(usersTable)
    .where(
      tenantId
        ? and(eq(usersTable.email, normalizeEmail(email)), eq(usersTable.tenantId, tenantId.trim()))
        : eq(usersTable.email, normalizeEmail(email)),
    )
    .limit(1);
  return rows[0] ?? null;
}

async function findUserByPhone(phone: string, tenantId: string): Promise<User | null> {
  const rows = await db
    .select()
    .from(usersTable)
    .where(and(eq(usersTable.phone, normalizePhone(phone)), eq(usersTable.tenantId, tenantId.trim())))
    .limit(1);
  return rows[0] ?? null;
}

async function findUserById(userId: string, tenantId?: string): Promise<User | null> {
  const rows = await db
    .select()
    .from(usersTable)
    .where(tenantId ? and(eq(usersTable.id, userId), eq(usersTable.tenantId, tenantId.trim())) : eq(usersTable.id, userId))
    .limit(1);
  return rows[0] ?? null;
}

async function getNextEmployeeId(tenantId: string): Promise<string> {
  const rows = await db
    .select({ employeeId: usersTable.employeeId })
    .from(usersTable)
    .where(and(eq(usersTable.role, "employee"), eq(usersTable.tenantId, tenantId.trim())))
    .orderBy(desc(usersTable.createdAt));

  const highest = rows.reduce((max, row) => {
    const match = row.employeeId?.match(/(\d+)$/);
    if (!match) {
      return max;
    }

    return Math.max(max, Number(match[1]));
  }, 0);

  return `YOJ-${String(highest + 1).padStart(4, "0")}`;
}

async function createRefreshSession(userId: string) {
  const jti = generateRandomToken(24);
  const refreshToken = signRefreshToken({ sub: userId, jti, typ: "refresh" });
  const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);

  await db.insert(refreshSessionsTable).values({
    userId,
    jtiHash: hashSha256(jti),
    expiresAt,
  });

  return { refreshToken, expiresAt, jti };
}

async function revokeSessionByJtiHash(jtiHash: string) {
  await db
    .update(refreshSessionsTable)
    .set({ revokedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(refreshSessionsTable.jtiHash, jtiHash), isNull(refreshSessionsTable.revokedAt)));
}

async function revokeAllSessions(userId: string) {
  await db
    .update(refreshSessionsTable)
    .set({ revokedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(refreshSessionsTable.userId, userId), isNull(refreshSessionsTable.revokedAt)));
}

async function getRefreshSession(jtiHash: string) {
  const rows = await db
    .select()
    .from(refreshSessionsTable)
    .where(eq(refreshSessionsTable.jtiHash, jtiHash))
    .limit(1);
  return rows[0] ?? null;
}

async function getTenantById(tenantId: string) {
  const rows = await db.select().from(tenantsTable).where(eq(tenantsTable.id, tenantId.trim())).limit(1);
  return rows[0] ?? null;
}

export async function loginWithPassword(email: string, password: string): Promise<LoginResult> {
  const user = await findUserByEmail(email);

  if (!user) {
    throw new Error("Invalid email or password");
  }

  if (user.status !== "active") {
    throw new Error("Your account is inactive");
  }

  const valid = await verifyPassword(password, user.hashedPassword);
  if (!valid) {
    throw new Error("Invalid email or password");
  }

  const tenant = await getTenantById(user.tenantId);
  if (!tenant || tenant.status !== "active") {
    throw new Error("This workspace is inactive");
  }

  const now = new Date();
  await db
    .update(usersTable)
    .set({ lastLoginAt: now, updatedAt: now })
    .where(eq(usersTable.id, user.id));

  const session = await createRefreshSession(user.id);
  const accessToken = signAccessToken({
    sub: user.id,
    tenantId: user.tenantId,
    role: user.role,
    email: user.email,
    name: user.name,
    sessionId: session.jti,
  });

  return {
    user: publicUser(user),
    accessToken,
    refreshToken: session.refreshToken,
  };
}

export async function refreshLogin(refreshToken: string): Promise<LoginResult> {
  const payload = verifyRefreshToken(refreshToken);
  if (payload.typ !== "refresh") {
    throw new Error("Invalid refresh token");
  }

  const jtiHash = hashSha256(payload.jti);
  const session = await getRefreshSession(jtiHash);
  if (!session || session.revokedAt || session.expiresAt.getTime() <= Date.now()) {
    throw new Error("Refresh session expired");
  }

  const user = await findUserById(session.userId);
  if (!user || user.status !== "active") {
    throw new Error("User not available");
  }

  const tenant = await getTenantById(user.tenantId);
  if (!tenant || tenant.status !== "active") {
    throw new Error("Workspace is inactive");
  }

  await revokeSessionByJtiHash(jtiHash);
  const nextSession = await createRefreshSession(user.id);
  const accessToken = signAccessToken({
    sub: user.id,
    tenantId: user.tenantId,
    role: user.role,
    email: user.email,
    name: user.name,
    sessionId: nextSession.jti,
  });

  return {
    user: publicUser(user),
    accessToken,
    refreshToken: nextSession.refreshToken,
  };
}

export async function logoutRefreshToken(refreshToken: string): Promise<void> {
  try {
    const payload = verifyRefreshToken(refreshToken);
    if (payload.typ !== "refresh") {
      return;
    }

    await revokeSessionByJtiHash(hashSha256(payload.jti));
  } catch {
    return;
  }
}

export async function createEmployeeAccount(input: CreateEmployeeInput): Promise<{ user: PublicUser; temporaryPassword: string; onboardingEmailSent: boolean }> {
  const email = normalizeEmail(input.email);
  const phone = normalizePhone(input.phone);
  const tenantId = input.tenantId?.trim() || DEFAULT_TENANT_ID;
  const existingEmail = await findUserByEmail(email);
  if (existingEmail) {
    throw new Error("Employee email already exists");
  }
  const existingPhone = await findUserByPhone(phone, tenantId);
  if (existingPhone) {
    throw new Error("Employee phone already exists in this workspace");
  }
  const temporaryPassword = generateTemporaryPassword();
  const employeeId = await getNextEmployeeId(tenantId);
  const hashedPassword = await hashPassword(temporaryPassword);
  const now = new Date();
  const profilePhotoUrl = await resolveProfilePhotoUrl(input.profilePhotoUrl, `employees/${employeeId}`);

  let user: User;
  try {
    const rows = await db
      .insert(usersTable)
      .values({
        tenantId,
        name: input.name.trim(),
        email,
        phone,
        role: "employee",
        employeeId,
        position: input.position.trim(),
        department: input.department?.trim() || null,
        salary: Math.max(0, Math.round(input.salary)),
        payType: input.payType ?? "monthly",
        hourlyRate: Math.max(0, Math.round(input.hourlyRate ?? 0)),
        profilePhotoUrl,
        hashedPassword,
        status: input.status ?? "active",
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    user = rows[0]!;
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new Error("Employee email already exists or phone is already used in this workspace");
    }

    throw error;
  }

  const portalUrl = getAppUrl();
  const onboarding = onboardingEmailTemplate({
    name: user.name,
    employeeId,
    temporaryPassword,
    portalUrl,
    loginEmail: user.email,
  });

  const onboardingEmailSent = Boolean(getSmtpConfig());

  if (onboardingEmailSent) {
    runAuthSideEffect(
      sendMail({
        to: user.email,
        subject: onboarding.subject,
        text: onboarding.text,
        html: onboarding.html,
      }),
      `send onboarding email to ${user.email}`,
    );
  }

  runAuthSideEffect(createWelcomeNotification(user.id), `create welcome notification for ${user.id}`);

  return {
    user: publicUser(user),
    temporaryPassword,
    onboardingEmailSent,
  };
}

export async function createClientAccount(input: CreateClientInput): Promise<{ user: PublicUser; temporaryPassword: string; onboardingEmailSent: boolean }> {
  const email = normalizeEmail(input.email);
  const phone = normalizePhone(input.phone);
  const tenantId = input.tenantId?.trim() || DEFAULT_TENANT_ID;
  const existingEmail = await findUserByEmail(email);
  if (existingEmail) {
    throw new Error("Client email already exists");
  }
  const existingPhone = await findUserByPhone(phone, tenantId);
  if (existingPhone) {
    throw new Error("Client phone already exists in this workspace");
  }
  const temporaryPassword = generateTemporaryPassword();
  const hashedPassword = await hashPassword(temporaryPassword);
  const now = new Date();
  const clientInfo: ClientBillingInfo = {
    companyName: input.company?.trim() || input.name.trim(),
    address: input.address?.trim() || "",
    phone,
    email: input.billingEmail?.trim() || email,
    website: input.website?.trim() || "",
  };

  let user: User;
  try {
    const rows = await db
      .insert(usersTable)
      .values({
        tenantId,
        name: input.name.trim(),
        email,
        phone,
        role: "client",
        employeeId: null,
        position: "Client",
        department: input.company?.trim() || null,
        salary: 0,
        payType: "monthly",
        hourlyRate: 0,
        profilePhotoUrl: null,
        clientInfo,
        hashedPassword,
        status: input.status ?? "active",
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    user = rows[0]!;
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new Error("Client email already exists or phone is already used in this workspace");
    }

    throw error;
  }

  const portalUrl = getAppUrl();
  const subject = "Your Yojak client portal is ready";
  const text = [
    `Hello ${user.name},`,
    "",
    "Your Yojak client portal account has been created.",
    `Login email: ${user.email}`,
    `Temporary password: ${temporaryPassword}`,
    `Portal: ${portalUrl}`,
    "",
    "Please sign in and change your password when you first access the portal.",
  ].join("\n");

  const onboardingEmailSent = Boolean(getSmtpConfig());
  if (onboardingEmailSent) {
    runAuthSideEffect(
      sendMail({
        to: user.email,
        subject,
        text,
        html: text.replace(/\n/g, "<br />"),
      }),
      `send client onboarding email to ${user.email}`,
    );
  }

  return {
    user: publicUser(user),
    temporaryPassword,
    onboardingEmailSent,
  };
}

export async function updateEmployeeAccount(input: UpdateEmployeeInput): Promise<{ user: PublicUser }> {
  const id = input.id.trim();
  const tenantId = input.tenantId?.trim() || DEFAULT_TENANT_ID;
  const email = normalizeEmail(input.email);
  const phone = normalizePhone(input.phone);
  const now = new Date();
  const existing = await findUserById(id, tenantId);

  if (!existing || existing.role !== "employee") {
    throw new Error("Employee not found");
  }

  const existingEmail = await findUserByEmail(email);
  if (existingEmail && existingEmail.id !== existing.id) {
    throw new Error("Employee email already exists");
  }
  const existingPhone = await findUserByPhone(phone, tenantId);
  if (existingPhone && existingPhone.id !== existing.id) {
    throw new Error("Employee phone already exists in this workspace");
  }

  let rows: User[];
  try {
    const profilePhotoUrl =
      input.profilePhotoUrl === undefined
        ? existing.profilePhotoUrl ?? null
        : await resolveProfilePhotoUrl(input.profilePhotoUrl, `employees/${existing.employeeId ?? existing.id}`);

    rows = await db
      .update(usersTable)
      .set({
        name: input.name.trim(),
        email,
        phone,
        position: input.position.trim(),
        department: input.department?.trim() || null,
        salary: Math.max(0, Math.round(input.salary)),
        payType: input.payType ?? existing.payType ?? "monthly",
        hourlyRate: Math.max(0, Math.round(input.hourlyRate ?? existing.hourlyRate ?? 0)),
        profilePhotoUrl,
        status: input.status ?? "active",
        updatedAt: now,
      })
      .where(and(eq(usersTable.id, id), eq(usersTable.role, "employee"), eq(usersTable.tenantId, tenantId)))
      .returning();
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new Error("Employee email already exists or phone is already used in this workspace");
    }

    throw error;
  }

  const user = rows[0];
  if (!user) {
    throw new Error("Employee not found");
  }

  return { user: publicUser(user) };
}

export async function updateClientAccount(input: UpdateClientInput): Promise<{ user: PublicUser }> {
  const id = input.id.trim();
  const tenantId = input.tenantId?.trim() || DEFAULT_TENANT_ID;
  const email = normalizeEmail(input.email);
  const phone = normalizePhone(input.phone);
  const now = new Date();
  const existing = await findUserById(id, tenantId);

  if (!existing || existing.role !== "client") {
    throw new Error("Client not found");
  }

  const existingEmail = await findUserByEmail(email);
  if (existingEmail && existingEmail.id !== existing.id) {
    throw new Error("Client email already exists");
  }
  const existingPhone = await findUserByPhone(phone, tenantId);
  if (existingPhone && existingPhone.id !== existing.id) {
    throw new Error("Client phone already exists in this workspace");
  }

  let rows: User[];
  try {
    rows = await db
      .update(usersTable)
      .set({
        name: input.name.trim(),
        email,
        phone,
        department: input.company?.trim() || null,
        clientInfo: {
          companyName: input.company?.trim() || input.name.trim(),
          address: input.address?.trim() || "",
          phone,
          email: input.billingEmail?.trim() || email,
          website: input.website?.trim() || "",
        },
        status: input.status ?? "active",
        updatedAt: now,
      })
      .where(and(eq(usersTable.id, id), eq(usersTable.role, "client"), eq(usersTable.tenantId, tenantId)))
      .returning();
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new Error("Client email already exists or phone is already used in this workspace");
    }

    throw error;
  }

  const user = rows[0];
  if (!user) {
    throw new Error("Client not found");
  }

  return { user: publicUser(user) };
}

export async function deactivateEmployeeAccount(id: string, tenantId = DEFAULT_TENANT_ID): Promise<{ user: PublicUser }> {
  const rows = await db
    .delete(usersTable)
    .where(and(eq(usersTable.id, id.trim()), eq(usersTable.role, "employee"), eq(usersTable.tenantId, tenantId)))
    .returning();

  const user = rows[0];
  if (!user) {
    throw new Error("Employee not found");
  }

  return { user: publicUser(user) };
}

export async function deactivateClientAccount(id: string, tenantId = DEFAULT_TENANT_ID): Promise<{ user: PublicUser }> {
  const rows = await db
    .delete(usersTable)
    .where(and(eq(usersTable.id, id.trim()), eq(usersTable.role, "client"), eq(usersTable.tenantId, tenantId)))
    .returning();

  const user = rows[0];
  if (!user) {
    throw new Error("Client not found");
  }

  return { user: publicUser(user) };
}

export async function listEmployees(tenantId = DEFAULT_TENANT_ID) {
  const rows = await db
    .select()
    .from(usersTable)
    .where(and(eq(usersTable.role, "employee"), eq(usersTable.tenantId, tenantId)))
    .orderBy(desc(usersTable.createdAt));

  return rows.map(publicUser);
}

export async function listClients(tenantId = DEFAULT_TENANT_ID) {
  const rows = await db
    .select()
    .from(usersTable)
    .where(and(eq(usersTable.role, "client"), eq(usersTable.tenantId, tenantId)))
    .orderBy(desc(usersTable.createdAt));

  return rows.map(publicUser);
}

export async function updateOwnProfile(userId: string, input: UpdateOwnProfileInput): Promise<{ user: PublicUser }> {
  const existing = await findUserById(userId.trim());
  if (!existing) {
    throw new Error("User not found");
  }

  const now = new Date();
  const normalizedEmail = normalizeEmail(input.email);
  const normalizedPhone = normalizePhone(input.phone);
  const existingEmail = await findUserByEmail(normalizedEmail);
  if (existingEmail && existingEmail.id !== existing.id) {
    throw new Error("Email already exists");
  }
  const existingPhone = await findUserByPhone(normalizedPhone, existing.tenantId);
  if (existingPhone && existingPhone.id !== existing.id) {
    throw new Error("Phone already exists in this workspace");
  }

  let rows: User[];
  try {
    const profilePhotoUrl =
      input.profilePhotoUrl === undefined
        ? existing.profilePhotoUrl ?? null
        : await resolveProfilePhotoUrl(input.profilePhotoUrl, `employees/${existing.employeeId ?? existing.id}`);

    rows = await db
      .update(usersTable)
      .set({
        name: input.name.trim(),
        email: normalizedEmail,
        phone: normalizedPhone,
        position: input.position?.trim() || existing.position,
        department: input.department?.trim() || existing.department,
        profilePhotoUrl,
        updatedAt: now,
      })
      .where(eq(usersTable.id, existing.id))
      .returning();
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new Error("Email already exists or phone is already used in this workspace");
    }

    throw error;
  }

  return { user: publicUser(rows[0]!) };
}

export async function requestPasswordReset(email: string): Promise<{ sent: boolean }> {
  const user = await findUserByEmail(email);
  if (!user) {
    return { sent: false };
  }

  const resetToken = generateRandomToken(32);
  const tokenHash = hashSha256(resetToken);
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
  const now = new Date();

  await db
    .update(passwordResetTokensTable)
    .set({ usedAt: now })
    .where(and(eq(passwordResetTokensTable.userId, user.id), isNull(passwordResetTokensTable.usedAt)));

  await db.insert(passwordResetTokensTable).values({
    userId: user.id,
    tokenHash,
    expiresAt,
  });

  const resetUrl = `${getAppUrl()}/reset?token=${encodeURIComponent(resetToken)}`;
  const message = passwordResetEmailTemplate({
    name: user.name,
    resetUrl,
  });

  try {
    await sendMail({
      to: user.email,
      subject: message.subject,
      text: message.text,
      html: message.html,
    });
    return { sent: true };
  } catch (error) {
    logger.warn({ err: error }, "Failed to send password reset email");
    return { sent: false };
  }
}

export async function resetPassword(token: string, password: string): Promise<void> {
  const tokenHash = hashSha256(token.trim());
  const rows = await db.select().from(passwordResetTokensTable).where(eq(passwordResetTokensTable.tokenHash, tokenHash)).limit(1);
  const resetRow = rows[0];

  if (!resetRow || resetRow.usedAt || resetRow.expiresAt.getTime() <= Date.now()) {
    throw new Error("Reset token is invalid or has expired");
  }

  const hashedPassword = await hashPassword(password);
  const now = new Date();

  await db.transaction(async (trx) => {
    await trx
      .update(usersTable)
      .set({ hashedPassword, updatedAt: now })
      .where(eq(usersTable.id, resetRow.userId));

    await trx
      .update(passwordResetTokensTable)
      .set({ usedAt: now })
      .where(eq(passwordResetTokensTable.userId, resetRow.userId));

    await trx
      .update(refreshSessionsTable)
      .set({ revokedAt: now, updatedAt: now })
      .where(eq(refreshSessionsTable.userId, resetRow.userId));
  });
}

export async function ensureInitialAdmin(): Promise<void> {
  const email = optionalEnv("ADMIN_EMAIL")?.trim().toLowerCase() ?? (!isProduction() ? "admin@yojak.in" : undefined);
  const password = optionalEnv("ADMIN_PASSWORD") ?? (!isProduction() ? "yojak123" : undefined);

  if (!email || !password) {
    return;
  }

  const existing = await findUserByEmail(email);
  if (existing) {
    return;
  }

  const hashedPassword = await hashPassword(password);
  const now = new Date();

  await db.insert(usersTable).values({
    tenantId: DEFAULT_TENANT_ID,
    name: optionalEnv("ADMIN_NAME")?.trim() || "Yojak Admin",
    email,
    phone: optionalEnv("ADMIN_PHONE")?.trim() || "9999999999",
    role: "admin",
    employeeId: null,
    position: optionalEnv("ADMIN_POSITION")?.trim() || "Administrator",
    department: optionalEnv("ADMIN_DEPARTMENT")?.trim() || "Operations",
    salary: 0,
    profilePhotoUrl: null,
    hashedPassword,
    status: "active",
    createdAt: now,
    updatedAt: now,
  });
}

export function getAccessTokenTtl() {
  return ACCESS_TOKEN_TTL;
}

export function getRefreshTokenTtl() {
  return REFRESH_TOKEN_TTL;
}
