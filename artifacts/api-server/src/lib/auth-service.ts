import { and, desc, eq, gt, isNull, lt } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  mfaTrustedDevicesTable,
  passwordResetTokensTable,
  refreshSessionsTable,
  tenantsTable,
  usersTable,
  type ClientBillingInfo,
  type User,
} from "@workspace/db/schema";
import { DEFAULT_TENANT_ID } from "./tenants";
import { getAppUrl, isProduction, isTest, optionalEnv } from "./env";
import {
  assertStrongPassword,
  decryptMfaSecret,
  encryptMfaSecret,
  generateRandomToken,
  generateTemporaryPassword,
  hashPassword,
  hashSha256,
  isEncryptedMfaSecret,
  verifyPassword,
} from "./security";
import { ACCESS_TOKEN_TTL, REFRESH_TOKEN_TTL, signAccessToken, signMfaToken, signRefreshToken, verifyMfaToken, verifyRefreshToken } from "./jwt";
import { sendMail, type MailPayload } from "./mailer";
import { clientPortalEmailTemplate, onboardingEmailTemplate, passwordResetEmailTemplate, tenantOwnerEmailTemplate } from "./email-templates";
import { createWelcomeNotification } from "./notifications";
import { logger } from "./logger";
import { uploadProfilePhotoDataUrl } from "./storage";
import { authenticator } from "otplib";

const MFA_ISSUER = optionalEnv("MFA_ISSUER_NAME")?.trim() || "Reforix Payroll";
const MFA_TRUST_DAYS = Math.max(1, Number(optionalEnv("MFA_TRUST_DAYS") ?? "7") || 7);
const MAX_ACTIVE_REFRESH_SESSIONS = Math.max(1, Number(optionalEnv("AUTH_MAX_ACTIVE_SESSIONS") ?? "5") || 5);
const REFRESH_REUSE_REVOKE_ALL = String(optionalEnv("AUTH_REVOKE_ON_REFRESH_REUSE") ?? "true").toLowerCase() !== "false";
const MFA_REQUIRED_ROLES = new Set(
  (optionalEnv("MFA_REQUIRED_ROLES") ?? "admin,platform_super_admin")
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value === "admin" || value === "platform_super_admin" || value === "employee" || value === "client"),
);
const MFA_ENFORCED = (() => {
  const override = optionalEnv("MFA_ENFORCE");
  if (override === undefined) {
    return isProduction();
  }
  return String(override).toLowerCase() === "true";
})();

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
  joiningDate: Date | null;
  bankName: string | null;
  bankAccountNumber: string | null;
  uan: string | null;
  pfNumber: string | null;
  esiNumber: string | null;
  profilePhotoUrl: string | null;
  clientInfo: ClientBillingInfo;
  status: "active" | "inactive";
  mfaEnabled: boolean;
  createdAt: Date;
  updatedAt: Date;
  lastLoginAt: Date | null;
}

export interface LoginResult {
  user: PublicUser;
  accessToken: string;
  refreshToken: string;
}

export interface MfaChallenge {
  mfaRequired: true;
  mfaSetupRequired: boolean;
  rememberDeviceAvailable: boolean;
  mfaToken: string;
  mfaSecret?: string;
  otpauthUrl?: string;
}

export type LoginResponse = LoginResult | MfaChallenge;

export interface CreateEmployeeInput {
  tenantId?: string;
  name: string;
  email: string;
  phone: string;
  position: string;
  salary: number;
  payType?: "monthly" | "hourly";
  hourlyRate?: number;
  joiningDate?: string | null;
  bankName?: string | null;
  bankAccountNumber?: string | null;
  uan?: string | null;
  pfNumber?: string | null;
  esiNumber?: string | null;
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
  joiningDate?: string | null;
  bankName?: string | null;
  bankAccountNumber?: string | null;
  uan?: string | null;
  pfNumber?: string | null;
  esiNumber?: string | null;
  profilePhotoUrl?: string | null;
  department?: string | null;
  status?: "active" | "inactive";
}

export interface CreateAdminInput {
  tenantId?: string;
  name: string;
  email: string;
  phone: string;
  position?: string | null;
  department?: string | null;
  status?: "active" | "inactive";
}

export interface UpdateAdminInput extends CreateAdminInput {
  id: string;
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

async function sendAccountProvisioningEmail(payload: MailPayload, label: string): Promise<boolean> {
  try {
    return await sendMail(payload);
  } catch (error) {
    logger.warn({ err: error, label }, "Failed to send account provisioning email");
    return false;
  }
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
    joiningDate: user.joiningDate ?? null,
    bankName: user.bankName ?? null,
    bankAccountNumber: user.bankAccountNumber ?? null,
    uan: user.uan ?? null,
    pfNumber: user.pfNumber ?? null,
    esiNumber: user.esiNumber ?? null,
    profilePhotoUrl: user.profilePhotoUrl ?? null,
    clientInfo: user.clientInfo ?? {},
    status: user.status,
    mfaEnabled: Boolean(user.mfaEnabled),
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

export async function findUserById(userId: string, tenantId?: string): Promise<User | null> {
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
  const jtiHash = hashSha256(jti);

  await db.insert(refreshSessionsTable).values({
    userId,
    jtiHash,
    expiresAt,
  });

  await enforceRefreshSessionCap(userId, jtiHash);

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

async function enforceRefreshSessionCap(userId: string, keepJtiHash: string) {
  if (MAX_ACTIVE_REFRESH_SESSIONS < 1) {
    return;
  }

  const activeSessions = await db
    .select()
    .from(refreshSessionsTable)
    .where(
      and(
        eq(refreshSessionsTable.userId, userId),
        isNull(refreshSessionsTable.revokedAt),
        gt(refreshSessionsTable.expiresAt, new Date()),
      ),
    )
    .orderBy(desc(refreshSessionsTable.createdAt));

  if (activeSessions.length <= MAX_ACTIVE_REFRESH_SESSIONS) {
    return;
  }

  const keep = new Set(
    activeSessions
      .slice(0, MAX_ACTIVE_REFRESH_SESSIONS)
      .map((session) => session.jtiHash)
      .concat(keepJtiHash),
  );

  const sessionsToRevoke = activeSessions.filter((session) => !keep.has(session.jtiHash));
  if (sessionsToRevoke.length === 0) {
    return;
  }

  for (const session of sessionsToRevoke) {
    await revokeSessionByJtiHash(session.jtiHash);
  }
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

function shouldRequireMfa(user: User): boolean {
  if (!MFA_ENFORCED) {
    return false;
  }
  return MFA_REQUIRED_ROLES.has(user.role);
}

function buildOtpAuthUrl(email: string, secret: string): string {
  return authenticator.keyuri(email, MFA_ISSUER, secret);
}

async function ensureMfaSecret(user: User): Promise<string> {
  if (user.mfaSecret) {
    const secret = decryptMfaSecret(user.mfaSecret);
    if (!isEncryptedMfaSecret(user.mfaSecret)) {
      await db
        .update(usersTable)
        .set({ mfaSecret: encryptMfaSecret(secret), mfaUpdatedAt: new Date(), updatedAt: new Date() })
        .where(eq(usersTable.id, user.id));
    }
    return secret;
  }

  const secret = authenticator.generateSecret();
  const now = new Date();
  await db
    .update(usersTable)
    .set({ mfaSecret: encryptMfaSecret(secret), mfaUpdatedAt: now, updatedAt: now })
    .where(eq(usersTable.id, user.id));
  return secret;
}

async function issueSession(user: User): Promise<LoginResult> {
  const now = new Date();
  await db.update(usersTable).set({ lastLoginAt: now, updatedAt: now }).where(eq(usersTable.id, user.id));

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

async function findTrustedDevice(userId: string, token?: string | null) {
  if (!token) {
    return null;
  }

  const tokenHash = hashSha256(token);
  const rows = await db
    .select()
    .from(mfaTrustedDevicesTable)
    .where(and(eq(mfaTrustedDevicesTable.userId, userId), eq(mfaTrustedDevicesTable.tokenHash, tokenHash)))
    .limit(1);
  const record = rows[0];
  if (!record) {
    return null;
  }
  if (record.expiresAt.getTime() <= Date.now()) {
    return null;
  }

  return record;
}

async function touchTrustedDevice(id: string) {
  await db
    .update(mfaTrustedDevicesTable)
    .set({ lastUsedAt: new Date() })
    .where(eq(mfaTrustedDevicesTable.id, id));
}

async function createTrustedDevice(userId: string, token: string, meta: { userAgent?: string | null; ipAddress?: string | null }) {
  const now = new Date();
  const expiresAt = new Date(Date.now() + MFA_TRUST_DAYS * 24 * 60 * 60 * 1000);
  await db.insert(mfaTrustedDevicesTable).values({
    userId,
    tokenHash: hashSha256(token),
    expiresAt,
    createdAt: now,
    lastUsedAt: now,
    userAgent: meta.userAgent?.trim() || null,
    ipAddress: meta.ipAddress?.trim() || null,
  });
  return { expiresAt };
}

async function pruneExpiredTrustedDevices() {
  await db.delete(mfaTrustedDevicesTable).where(lt(mfaTrustedDevicesTable.expiresAt, new Date()));
}

export async function loginWithPassword(
  email: string,
  password: string,
  options?: { trustedDeviceToken?: string | null; userAgent?: string | null },
): Promise<LoginResponse> {
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

  if (shouldRequireMfa(user)) {
    await pruneExpiredTrustedDevices();
    const trusted = await findTrustedDevice(user.id, options?.trustedDeviceToken ?? null);
    if (trusted) {
      if (trusted.userAgent && trusted.userAgent !== (options?.userAgent?.trim() || null)) {
        await db.delete(mfaTrustedDevicesTable).where(eq(mfaTrustedDevicesTable.id, trusted.id));
        throw new Error("Trusted device validation failed");
      }
      await touchTrustedDevice(trusted.id);
      return issueSession(user);
    }

    const mfaToken = signMfaToken({
      sub: user.id,
      jti: generateRandomToken(16),
      typ: "mfa",
    });

    if (!user.mfaEnabled) {
      const secret = await ensureMfaSecret(user);
      return {
        mfaRequired: true,
        mfaSetupRequired: true,
        rememberDeviceAvailable: true,
        mfaToken,
        mfaSecret: secret,
        otpauthUrl: buildOtpAuthUrl(user.email, secret),
      };
    }

    return {
      mfaRequired: true,
      mfaSetupRequired: false,
      rememberDeviceAvailable: true,
      mfaToken,
    };
  }

  return issueSession(user);
}

export async function loginWithOAuthAccount(
  email: string,
  options?: { trustedDeviceToken?: string | null; userAgent?: string | null },
): Promise<LoginResult> {
  const user = await findUserByEmail(email);

  if (!user) {
    throw new Error("No account is linked to this email. Ask your administrator to create your account first.");
  }

  if (user.status !== "active") {
    throw new Error("Your account is inactive");
  }

  const tenant = await getTenantById(user.tenantId);
  if (!tenant || tenant.status !== "active") {
    throw new Error("This workspace is inactive");
  }

  if (shouldRequireMfa(user)) {
    const trusted = await findTrustedDevice(user.id, options?.trustedDeviceToken ?? null);
    if (
      !trusted
      || (trusted.userAgent && trusted.userAgent !== (options?.userAgent?.trim() || null))
    ) {
      throw new Error("Complete password and MFA sign-in before using OAuth on this device.");
    }
    await touchTrustedDevice(trusted.id);
  }

  return issueSession(user);
}

export async function refreshLogin(refreshToken: string): Promise<LoginResult> {
  const payload = verifyRefreshToken(refreshToken);
  if (payload.typ !== "refresh") {
    throw new Error("Invalid refresh token");
  }

  const jtiHash = hashSha256(payload.jti);
  const session = await getRefreshSession(jtiHash);
  if (!session || session.userId !== payload.sub || session.revokedAt || session.expiresAt.getTime() <= Date.now()) {
    if (REFRESH_REUSE_REVOKE_ALL) {
      await revokeAllSessions(payload.sub);
    }
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

export async function verifyMfaChallenge(input: {
  mfaToken: string;
  code: string;
  rememberDevice?: boolean;
  userAgent?: string | null;
  ipAddress?: string | null;
}): Promise<{ session: LoginResult; trustedDeviceToken?: string }> {
  const payload = verifyMfaToken(input.mfaToken);
  if (payload.typ !== "mfa") {
    throw new Error("Invalid MFA token");
  }

  const user = await findUserById(payload.sub);
  if (!user || user.status !== "active") {
    throw new Error("User not available");
  }

  if (!shouldRequireMfa(user)) {
    return { session: await issueSession(user) };
  }

  if (!user.mfaSecret) {
    throw new Error("MFA is not configured for this account");
  }
  const secret = decryptMfaSecret(user.mfaSecret);

  const normalizedCode = input.code.trim().replace(/\s+/g, "");
  const valid = authenticator.check(normalizedCode, secret);
  if (!valid) {
    throw new Error("Invalid MFA code");
  }

  if (!user.mfaEnabled) {
    const now = new Date();
    await db
      .update(usersTable)
      .set({ mfaEnabled: true, mfaEnrolledAt: now, mfaUpdatedAt: now, updatedAt: now })
      .where(eq(usersTable.id, user.id));
  }

  const session = await issueSession(user);
  if (!input.rememberDevice) {
    return { session };
  }

  const token = generateRandomToken(24);
  await createTrustedDevice(user.id, token, {
    userAgent: input.userAgent ?? null,
    ipAddress: input.ipAddress ?? null,
  });

  return { session, trustedDeviceToken: token };
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

export async function logoutAllSessions(userId: string): Promise<void> {
  await revokeAllSessions(userId.trim());
  await db.delete(mfaTrustedDevicesTable).where(eq(mfaTrustedDevicesTable.userId, userId.trim()));
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
        joiningDate: input.joiningDate ? new Date(input.joiningDate) : null,
        bankName: input.bankName?.trim() || null,
        bankAccountNumber: input.bankAccountNumber?.trim() || null,
        uan: input.uan?.trim() || null,
        pfNumber: input.pfNumber?.trim() || null,
        esiNumber: input.esiNumber?.trim() || null,
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

  const onboardingEmailSent = await sendAccountProvisioningEmail(
    {
      to: user.email,
      subject: onboarding.subject,
      text: onboarding.text,
      html: onboarding.html,
    },
    `send onboarding email to ${user.email}`,
  );

  runAuthSideEffect(createWelcomeNotification(user.id), `create welcome notification for ${user.id}`);

  return {
    user: publicUser(user),
    temporaryPassword,
    onboardingEmailSent,
  };
}

export async function createAdminAccount(
  input: CreateAdminInput,
): Promise<{ user: PublicUser; temporaryPassword: string; onboardingEmailSent: boolean }> {
  const email = normalizeEmail(input.email);
  const phone = normalizePhone(input.phone);
  const tenantId = input.tenantId?.trim() || DEFAULT_TENANT_ID;
  const existingEmail = await findUserByEmail(email);
  if (existingEmail) {
    throw new Error("Admin email already exists");
  }
  const existingPhone = await findUserByPhone(phone, tenantId);
  if (existingPhone) {
    throw new Error("Admin phone already exists in this workspace");
  }

  const temporaryPassword = generateTemporaryPassword();
  const hashedPassword = await hashPassword(temporaryPassword);
  const now = new Date();

  let user: User;
  try {
    const rows = await db
      .insert(usersTable)
      .values({
        tenantId,
        name: input.name.trim(),
        email,
        phone,
        role: "admin",
        employeeId: null,
        position: input.position?.trim() || "Administrator",
        department: input.department?.trim() || "Operations",
        salary: 0,
        payType: "monthly",
        hourlyRate: 0,
        profilePhotoUrl: null,
        clientInfo: {},
        hashedPassword,
        status: input.status ?? "active",
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    user = rows[0]!;
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new Error("Admin email already exists or phone is already used in this workspace");
    }

    throw error;
  }

  const portalUrl = getAppUrl();
  const onboarding = tenantOwnerEmailTemplate({
    name: user.name,
    loginEmail: user.email,
    temporaryPassword,
    portalUrl,
  });

  const onboardingEmailSent = await sendAccountProvisioningEmail(
    {
      to: user.email,
      subject: onboarding.subject,
      text: onboarding.text,
      html: onboarding.html,
    },
    `send tenant admin onboarding email to ${user.email}`,
  );

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
  const clientPortal = clientPortalEmailTemplate({
    name: user.name,
    loginEmail: user.email,
    temporaryPassword,
    portalUrl,
  });

  const onboardingEmailSent = await sendAccountProvisioningEmail(
    {
      to: user.email,
      subject: clientPortal.subject,
      text: clientPortal.text,
      html: clientPortal.html,
    },
    `send client onboarding email to ${user.email}`,
  );

  return {
    user: publicUser(user),
    temporaryPassword,
    onboardingEmailSent,
  };
}

export async function updateAdminAccount(input: UpdateAdminInput): Promise<{ user: PublicUser }> {
  const id = input.id.trim();
  const tenantId = input.tenantId?.trim() || DEFAULT_TENANT_ID;
  const email = normalizeEmail(input.email);
  const phone = normalizePhone(input.phone);
  const now = new Date();
  const existing = await findUserById(id, tenantId);

  if (!existing || existing.role !== "admin") {
    throw new Error("Admin not found");
  }

  const existingEmail = await findUserByEmail(email);
  if (existingEmail && existingEmail.id !== existing.id) {
    throw new Error("Admin email already exists");
  }
  const existingPhone = await findUserByPhone(phone, tenantId);
  if (existingPhone && existingPhone.id !== existing.id) {
    throw new Error("Admin phone already exists in this workspace");
  }

  let rows: User[];
  try {
    rows = await db
      .update(usersTable)
      .set({
        name: input.name.trim(),
        email,
        phone,
        position: input.position?.trim() || existing.position || "Administrator",
        department: input.department?.trim() || existing.department || "Operations",
        status: input.status ?? "active",
        updatedAt: now,
      })
      .where(and(eq(usersTable.id, id), eq(usersTable.role, "admin"), eq(usersTable.tenantId, tenantId)))
      .returning();
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new Error("Admin email already exists or phone is already used in this workspace");
    }

    throw error;
  }

  const user = rows[0];
  if (!user) {
    throw new Error("Admin not found");
  }

  return { user: publicUser(user) };
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
        joiningDate:
          input.joiningDate === undefined
            ? existing.joiningDate
            : input.joiningDate
              ? new Date(input.joiningDate)
              : null,
        bankName: input.bankName === undefined ? existing.bankName : input.bankName?.trim() || null,
        bankAccountNumber:
          input.bankAccountNumber === undefined
            ? existing.bankAccountNumber
            : input.bankAccountNumber?.trim() || null,
        uan: input.uan === undefined ? existing.uan : input.uan?.trim() || null,
        pfNumber: input.pfNumber === undefined ? existing.pfNumber : input.pfNumber?.trim() || null,
        esiNumber: input.esiNumber === undefined ? existing.esiNumber : input.esiNumber?.trim() || null,
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

export async function deactivateAdminAccount(
  id: string,
  tenantId = DEFAULT_TENANT_ID,
  actorUserId?: string,
): Promise<{ user: PublicUser }> {
  const targetId = id.trim();
  if (actorUserId?.trim() === targetId) {
    throw new Error("You cannot remove your own admin account.");
  }

  const admins = await db
    .select()
    .from(usersTable)
    .where(and(eq(usersTable.role, "admin"), eq(usersTable.tenantId, tenantId)));

  if (!admins.some((admin) => admin.id === targetId)) {
    throw new Error("Admin not found");
  }

  if (admins.length <= 1) {
    throw new Error("This workspace must always have at least one admin.");
  }

  const rows = await db
    .delete(usersTable)
    .where(and(eq(usersTable.id, targetId), eq(usersTable.role, "admin"), eq(usersTable.tenantId, tenantId)))
    .returning();

  const user = rows[0];
  if (!user) {
    throw new Error("Admin not found");
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

export async function listAdmins(tenantId = DEFAULT_TENANT_ID) {
  const rows = await db
    .select()
    .from(usersTable)
    .where(and(eq(usersTable.role, "admin"), eq(usersTable.tenantId, tenantId)))
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

export async function resetPassword(
  token: string,
  password: string,
): Promise<{ userId: string; tenantId: string }> {
  assertStrongPassword(password);
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

    await trx.delete(mfaTrustedDevicesTable).where(eq(mfaTrustedDevicesTable.userId, resetRow.userId));
  });

  const user = await findUserById(resetRow.userId);
  if (!user) {
    throw new Error("Password was reset, but the account could not be loaded");
  }
  return { userId: user.id, tenantId: user.tenantId };
}

export async function ensureInitialAdmin(): Promise<void> {
  const email = optionalEnv("ADMIN_EMAIL")?.trim().toLowerCase() ?? (isTest() ? "admin@reforix.com" : undefined);
  const password = optionalEnv("ADMIN_PASSWORD") ?? (isTest() ? "reforix123" : undefined);
  const phone = optionalEnv("ADMIN_PHONE")?.trim() || "9999999999";
  const name = optionalEnv("ADMIN_NAME")?.trim() || "Reforix Admin";
  const position = optionalEnv("ADMIN_POSITION")?.trim() || "Administrator";
  const department = optionalEnv("ADMIN_DEPARTMENT")?.trim() || "Operations";

  if (!email || !password) {
    return;
  }

  const hashedPassword = await hashPassword(password);
  const now = new Date();
  const adminFields = {
    tenantId: DEFAULT_TENANT_ID,
    name,
    email,
    phone,
    role: "admin" as const,
    employeeId: null,
    position,
    department,
    salary: 0,
    profilePhotoUrl: null,
    hashedPassword,
    status: "active" as const,
    updatedAt: now,
  };

  const existingByIdentity = (await findUserByEmail(email)) ?? (await findUserByPhone(phone, DEFAULT_TENANT_ID));
  if (existingByIdentity) {
    return;
  }

  try {
    await db.insert(usersTable).values({
      ...adminFields,
      createdAt: now,
    });
  } catch (error) {
    if (!isUniqueViolation(error)) {
      throw error;
    }

    const fallbackExisting = (await findUserByEmail(email)) ?? (await findUserByPhone(phone, DEFAULT_TENANT_ID));
    if (fallbackExisting) {
      return;
    }

    throw error;
  }
}

export function getAccessTokenTtl() {
  return ACCESS_TOKEN_TTL;
}

export function getRefreshTokenTtl() {
  return REFRESH_TOKEN_TTL;
}
