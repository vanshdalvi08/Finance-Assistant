import crypto from "node:crypto";
import * as bcrypt from "bcryptjs";
import { isProduction, optionalEnv } from "./env";

const ENCRYPTED_VALUE_PREFIX = "enc:v1";

function getMfaEncryptionKey() {
  const configured = optionalEnv("MFA_ENCRYPTION_KEY")?.trim();
  if (!configured) {
    if (isProduction()) {
      throw new Error("Missing required environment variable: MFA_ENCRYPTION_KEY");
    }
    return crypto.createHash("sha256").update("reforix-development-mfa-key").digest();
  }

  const key = Buffer.from(configured, "base64url");
  if (key.length !== 32) {
    throw new Error("MFA_ENCRYPTION_KEY must be a base64url-encoded 32-byte key");
  }
  return key;
}

export function generateRandomToken(byteLength = 32): string {
  return crypto.randomBytes(byteLength).toString("base64url");
}

export function hashSha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export async function hashPassword(password: string): Promise<string> {
  const salt = await bcrypt.genSalt(12);
  return bcrypt.hash(password, salt);
}

export function verifyPassword(password: string, hashedPassword: string): Promise<boolean> {
  return bcrypt.compare(password, hashedPassword);
}

export function generateTemporaryPassword(): string {
  return `${crypto.randomBytes(3).toString("hex")}-${crypto.randomBytes(3).toString("hex")}`;
}

export function assertStrongPassword(password: string): void {
  const byteLength = Buffer.byteLength(password, "utf8");
  if (password.length < 12 || byteLength > 72) {
    throw new Error("Password must be at least 12 characters and no more than 72 UTF-8 bytes.");
  }
}

export function encryptMfaSecret(value: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", getMfaEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [ENCRYPTED_VALUE_PREFIX, iv.toString("base64url"), tag.toString("base64url"), encrypted.toString("base64url")].join(":");
}

export function decryptMfaSecret(value: string): string {
  if (!value.startsWith(`${ENCRYPTED_VALUE_PREFIX}:`)) {
    return value;
  }

  const [, , ivValue, tagValue, encryptedValue] = value.split(":");
  if (!ivValue || !tagValue || !encryptedValue) {
    throw new Error("Stored MFA secret is malformed");
  }

  const decipher = crypto.createDecipheriv("aes-256-gcm", getMfaEncryptionKey(), Buffer.from(ivValue, "base64url"));
  decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedValue, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

export function isEncryptedMfaSecret(value: string): boolean {
  return value.startsWith(`${ENCRYPTED_VALUE_PREFIX}:`);
}
