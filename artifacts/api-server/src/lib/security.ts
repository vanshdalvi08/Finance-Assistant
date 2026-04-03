import crypto from "node:crypto";
import * as bcrypt from "bcryptjs";

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

