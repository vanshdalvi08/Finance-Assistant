import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@workspace/db";
import { passwordResetTokensTable, refreshSessionsTable, usersTable, type User } from "@workspace/db/schema";
import { getAppUrl, isProduction, optionalEnv } from "./env";
import { generateRandomToken, generateTemporaryPassword, hashPassword, hashSha256, verifyPassword } from "./security";
import { ACCESS_TOKEN_TTL, REFRESH_TOKEN_TTL, signAccessToken, signRefreshToken, verifyRefreshToken } from "./jwt";
import { sendMail } from "./mailer";
import { onboardingEmailTemplate, passwordResetEmailTemplate } from "./email-templates";

export interface PublicUser {
  id: string;
  name: string;
  email: string;
  phone: string;
  role: "admin" | "employee";
  employeeId: string | null;
  position: string | null;
  department: string | null;
  salary: number;
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
  name: string;
  email: string;
  phone: string;
  position: string;
  salary: number;
  department?: string | null;
  status?: "active" | "inactive";
}

export interface UpdateEmployeeInput {
  id: string;
  name: string;
  email: string;
  phone: string;
  position: string;
  salary: number;
  department?: string | null;
  status?: "active" | "inactive";
}

export interface UpdateOwnProfileInput {
  name: string;
  email: string;
  phone: string;
  position?: string | null;
  department?: string | null;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function normalizePhone(phone: string): string {
  return phone.trim();
}

function publicUser(user: User): PublicUser {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    role: user.role,
    employeeId: user.employeeId ?? null,
    position: user.position ?? null,
    department: user.department ?? null,
    salary: user.salary,
    status: user.status,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    lastLoginAt: user.lastLoginAt ?? null,
  };
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "23505";
}

async function findUserByEmail(email: string): Promise<User | null> {
  const rows = await db.select().from(usersTable).where(eq(usersTable.email, normalizeEmail(email))).limit(1);
  return rows[0] ?? null;
}

async function findUserById(userId: string): Promise<User | null> {
  const rows = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  return rows[0] ?? null;
}

async function getNextEmployeeId(): Promise<string> {
  const rows = await db
    .select({ employeeId: usersTable.employeeId })
    .from(usersTable)
    .where(eq(usersTable.role, "employee"))
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

  const now = new Date();
  await db
    .update(usersTable)
    .set({ lastLoginAt: now, updatedAt: now })
    .where(eq(usersTable.id, user.id));

  const session = await createRefreshSession(user.id);
  const accessToken = signAccessToken({
    sub: user.id,
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

  await revokeSessionByJtiHash(jtiHash);
  const nextSession = await createRefreshSession(user.id);
  const accessToken = signAccessToken({
    sub: user.id,
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
  const temporaryPassword = generateTemporaryPassword();
  const employeeId = await getNextEmployeeId();
  const hashedPassword = await hashPassword(temporaryPassword);
  const now = new Date();

  let user: User;
  try {
    const rows = await db
      .insert(usersTable)
      .values({
        name: input.name.trim(),
        email,
        phone,
        role: "employee",
        employeeId,
        position: input.position.trim(),
        department: input.department?.trim() || null,
        salary: Math.max(0, Math.round(input.salary)),
        hashedPassword,
        status: input.status ?? "active",
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    user = rows[0]!;
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new Error("Employee email or phone already exists");
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

  let onboardingEmailSent = false;
  try {
    onboardingEmailSent = await sendMail({
      to: user.email,
      subject: onboarding.subject,
      text: onboarding.text,
      html: onboarding.html,
    });
  } catch (error) {
    onboardingEmailSent = false;
    console.error("Failed to send onboarding email", error);
  }

  return {
    user: publicUser(user),
    temporaryPassword,
    onboardingEmailSent,
  };
}

export async function updateEmployeeAccount(input: UpdateEmployeeInput): Promise<{ user: PublicUser }> {
  const id = input.id.trim();
  const email = normalizeEmail(input.email);
  const phone = normalizePhone(input.phone);
  const now = new Date();

  let rows: User[];
  try {
    rows = await db
      .update(usersTable)
      .set({
        name: input.name.trim(),
        email,
        phone,
        position: input.position.trim(),
        department: input.department?.trim() || null,
        salary: Math.max(0, Math.round(input.salary)),
        status: input.status ?? "active",
        updatedAt: now,
      })
      .where(and(eq(usersTable.id, id), eq(usersTable.role, "employee")))
      .returning();
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new Error("Employee email or phone already exists");
    }

    throw error;
  }

  const user = rows[0];
  if (!user) {
    throw new Error("Employee not found");
  }

  return { user: publicUser(user) };
}

export async function deactivateEmployeeAccount(id: string): Promise<{ user: PublicUser }> {
  const now = new Date();
  const rows = await db
    .update(usersTable)
    .set({
      status: "inactive",
      updatedAt: now,
    })
    .where(and(eq(usersTable.id, id.trim()), eq(usersTable.role, "employee")))
    .returning();

  const user = rows[0];
  if (!user) {
    throw new Error("Employee not found");
  }

  await revokeAllSessions(user.id);

  return { user: publicUser(user) };
}

export async function listEmployees() {
  const rows = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.role, "employee"))
    .orderBy(desc(usersTable.createdAt));

  return rows.map(publicUser);
}

export async function updateOwnProfile(userId: string, input: UpdateOwnProfileInput): Promise<{ user: PublicUser }> {
  const existing = await findUserById(userId.trim());
  if (!existing) {
    throw new Error("User not found");
  }

  const now = new Date();

  let rows: User[];
  try {
    rows = await db
      .update(usersTable)
      .set({
        name: input.name.trim(),
        email: normalizeEmail(input.email),
        phone: normalizePhone(input.phone),
        position: input.position?.trim() || existing.position,
        department: input.department?.trim() || existing.department,
        updatedAt: now,
      })
      .where(eq(usersTable.id, existing.id))
      .returning();
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new Error("Email or phone already exists");
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
    console.error("Failed to send password reset email", error);
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
    name: optionalEnv("ADMIN_NAME")?.trim() || "Yojak Admin",
    email,
    phone: optionalEnv("ADMIN_PHONE")?.trim() || "9999999999",
    role: "admin",
    employeeId: null,
    position: optionalEnv("ADMIN_POSITION")?.trim() || "Administrator",
    department: optionalEnv("ADMIN_DEPARTMENT")?.trim() || "Operations",
    salary: 0,
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
