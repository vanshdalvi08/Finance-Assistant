import test from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";

import {
  signAccessToken,
  signRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
} from "../src/lib/jwt.ts";
import {
  assertStrongPassword,
  decryptMfaSecret,
  encryptMfaSecret,
} from "../src/lib/security.ts";

test("access tokens pin algorithm, issuer, audience, and token type", () => {
  const token = signAccessToken({
    sub: "user-1",
    tenantId: "tenant-1",
    role: "employee",
    email: "employee@example.com",
    name: "Employee",
    sessionId: "session-1",
  });
  const decoded = jwt.decode(token, { complete: true });

  assert.equal(decoded?.header.alg, "HS256");
  assert.equal(decoded?.payload.iss, "reforix-payroll-api");
  assert.equal(decoded?.payload.aud, "reforix-payroll");
  assert.equal(verifyAccessToken(token).typ, "access");
});

test("access and refresh tokens cannot be substituted for each other", () => {
  const refreshToken = signRefreshToken({
    sub: "user-1",
    jti: "refresh-1",
    typ: "refresh",
  });

  assert.equal(verifyRefreshToken(refreshToken).typ, "refresh");
  assert.throws(() => verifyAccessToken(refreshToken));
});

test("MFA secrets are authenticated-encrypted at rest", () => {
  const secret = "JBSWY3DPEHPK3PXP";
  const encrypted = encryptMfaSecret(secret);

  assert.match(encrypted, /^enc:v1:/);
  assert.equal(encrypted.includes(secret), false);
  assert.equal(decryptMfaSecret(encrypted), secret);
});

test("password policy enforces minimum length and bcrypt byte limit", () => {
  assert.throws(() => assertStrongPassword("short"));
  assert.doesNotThrow(() => assertStrongPassword("correct horse battery staple"));
  assert.throws(() => assertStrongPassword("x".repeat(73)));
});
