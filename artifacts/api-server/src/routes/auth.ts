import { Router, type IRouter, type Response } from "express";
import { z } from "zod";
import {
  loginWithPassword,
  loginWithOAuthAccount,
  logoutAllSessions,
  logoutRefreshToken,
  refreshLogin,
  requestPasswordReset,
  resetPassword,
  updateOwnProfile,
  verifyMfaChallenge,
} from "../lib/auth-service";
import { requireAuth } from "../middlewares/auth";
import {
  CSRF_COOKIE_NAME,
  MFA_TRUSTED_COOKIE_NAME,
  csrfCookieOptions,
  mfaTrustedCookieOptions,
  REFRESH_COOKIE_NAME,
  refreshCookieOptions,
} from "../lib/cookies";
import {
  rateLimit,
  rateLimitKeyByField,
  rateLimitKeyByRemoteAddress,
  rateLimitKeyByRemoteAddressAndField,
} from "../middlewares/rate-limit";
import { recordPlatformEventSafe } from "../lib/platform";
import { generateRandomToken, hashSha256 } from "../lib/security";
import { requireCsrfToken, requireSameOriginAuthMutation } from "../middlewares/csrf";
import { buildOAuthStartUrl, exchangeOAuthCode, getOAuthRedirectTarget, parseOAuthState, type OAuthProvider } from "../lib/oauth";

const router: IRouter = Router();

const loginIpLimiter = rateLimit({
  name: "auth-login-ip",
  windowMs: 15 * 60 * 1000,
  max: 50,
  message: "Too many login attempts. Please try again later.",
  keyFn: rateLimitKeyByRemoteAddress,
});

const loginAccountLimiter = rateLimit({
  name: "auth-login-account",
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: "Too many login attempts for this account. Please try again later.",
  keyFn: rateLimitKeyByField("email"),
});

const resetRequestLimiter = rateLimit({
  name: "auth-reset-request",
  windowMs: 60 * 60 * 1000,
  max: 5,
  message: "Too many password reset requests. Please try again later.",
  keyFn: rateLimitKeyByRemoteAddressAndField("email"),
});

const resetLimiter = rateLimit({
  name: "auth-reset",
  windowMs: 60 * 60 * 1000,
  max: 10,
  message: "Too many password reset attempts. Please try again later.",
  keyFn: rateLimitKeyByRemoteAddressAndField("token"),
});

const mfaVerifyLimiter = rateLimit({
  name: "auth-mfa-verify",
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: "Too many MFA attempts. Please try again later.",
  keyFn: rateLimitKeyByRemoteAddress,
});

const refreshLimiter = rateLimit({
  name: "auth-refresh",
  windowMs: 15 * 60 * 1000,
  max: 60,
  message: "Too many session refresh attempts. Please try again later.",
  keyFn: rateLimitKeyByRemoteAddress,
});

const logoutLimiter = rateLimit({
  name: "auth-logout",
  windowMs: 15 * 60 * 1000,
  max: 60,
  message: "Too many logout attempts. Please try again later.",
  keyFn: rateLimitKeyByRemoteAddress,
});

const logoutAllLimiter = rateLimit({
  name: "auth-logout-all",
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: "Too many global logout attempts. Please try again later.",
  keyFn: rateLimitKeyByRemoteAddress,
});

const profileUpdateLimiter = rateLimit({
  name: "auth-profile-update",
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: "Too many profile updates. Please try again later.",
});

const oauthLimiter = rateLimit({
  name: "auth-oauth",
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: "Too many OAuth attempts. Please try again later.",
  keyFn: rateLimitKeyByRemoteAddress,
});

const loginSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(8).max(72),
});

const resetRequestSchema = z.object({
  email: z.string().trim().email(),
});

const resetSchema = z.object({
  token: z.string().min(16),
  password: z.string().min(12).max(72),
});

const mfaVerifySchema = z.object({
  mfaToken: z.string().min(16),
  code: z.string().min(6).max(10),
  rememberDevice: z.boolean().optional(),
});

const updateProfileSchema = z.object({
  name: z.string().trim().min(2),
  email: z.string().trim().email(),
  phone: z.string().trim().min(7),
  position: z.string().trim().min(2).optional(),
  department: z.string().trim().min(2).optional(),
  profilePhotoUrl: z.string().trim().max(2_500_000).nullable().optional(),
});

const oauthProviderSchema = z.enum(["google", "microsoft"]);
const oauthStartSchema = z.object({
  returnTo: z.string().trim().optional(),
});

function issueCsrfToken(response: Response) {
  const csrfToken = generateRandomToken(24);
  response.cookie(CSRF_COOKIE_NAME, csrfToken, csrfCookieOptions());
  return csrfToken;
}

router.use(requireSameOriginAuthMutation);

router.get("/csrf", (_request, response) => {
  const csrfToken = issueCsrfToken(response);
  response.json({ csrfToken });
});

router.get("/oauth/:provider/start", oauthLimiter, async (request, response) => {
  const providerResult = oauthProviderSchema.safeParse(request.params.provider);
  if (!providerResult.success) {
    response.status(400).json({ message: "Invalid OAuth provider" });
    return;
  }

  const parsed = oauthStartSchema.safeParse(request.query);
  if (!parsed.success) {
    response.status(400).json({ message: "Invalid OAuth start payload" });
    return;
  }

  try {
    const startUrl = buildOAuthStartUrl(providerResult.data, parsed.data.returnTo ?? "/");
    response.redirect(302, startUrl);
  } catch (error) {
    await recordPlatformEventSafe({
      severity: "warning",
      category: "auth",
      title: "OAuth start rejected",
      message: error instanceof Error ? error.message : "OAuth start failed",
      path: `/api/auth/oauth/${providerResult.data}/start`,
      method: "GET",
      statusCode: 503,
      metadata: {
        provider: providerResult.data,
      },
    });
    response.status(503).json({
      message: `${providerResult.data === "google" ? "Google" : "Microsoft"} sign-in is not configured yet.`,
    });
  }
});

router.get("/oauth/:provider/callback", oauthLimiter, async (request, response) => {
  const providerResult = oauthProviderSchema.safeParse(request.params.provider);
  if (!providerResult.success) {
    response.status(400).json({ message: "Invalid OAuth provider" });
    return;
  }

  const code = typeof request.query.code === "string" ? request.query.code : "";
  const state = typeof request.query.state === "string" ? request.query.state : "";
  if (!code || !state) {
    response.status(400).json({ message: "Missing OAuth callback data" });
    return;
  }

  try {
    const statePayload = parseOAuthState(state, providerResult.data);
    const profile = await exchangeOAuthCode(providerResult.data, code);
    const session = await loginWithOAuthAccount(profile.email, {
      trustedDeviceToken:
        typeof request.cookies?.[MFA_TRUSTED_COOKIE_NAME] === "string"
          ? request.cookies[MFA_TRUSTED_COOKIE_NAME]
          : null,
      userAgent: request.header("user-agent") ?? null,
    });
    await recordPlatformEventSafe({
      severity: "info",
      category: "auth",
      title: "OAuth login succeeded",
      message: "User completed OAuth authentication.",
      path: `/api/auth/oauth/${providerResult.data}/callback`,
      method: "GET",
      statusCode: 302,
      tenantId: session.user.tenantId,
      actorUserId: session.user.id,
      requestId: String(request.id ?? ""),
      metadata: {
        provider: providerResult.data,
        role: session.user.role,
      },
    });
    response.cookie(REFRESH_COOKIE_NAME, session.refreshToken, refreshCookieOptions());
    issueCsrfToken(response);
    response.redirect(302, getOAuthRedirectTarget(statePayload.redirectPath ?? "/"));
  } catch (error) {
    await recordPlatformEventSafe({
      severity: "warning",
      category: "auth",
      title: "OAuth login rejected",
      message: error instanceof Error ? error.message : "OAuth login failed",
      path: `/api/auth/oauth/${providerResult.data}/callback`,
      method: "GET",
      statusCode: 401,
      metadata: {
        provider: providerResult.data,
      },
    });
    response.redirect(302, getOAuthRedirectTarget("/"));
  }
});

router.post("/login", loginIpLimiter, loginAccountLimiter, async (request, response) => {
  const parsed = loginSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ message: "Invalid login payload" });
    return;
  }

  try {
    const trustedDevice = request.cookies?.[MFA_TRUSTED_COOKIE_NAME];
    const result = await loginWithPassword(parsed.data.email, parsed.data.password, {
      trustedDeviceToken: typeof trustedDevice === "string" ? trustedDevice : null,
      userAgent: request.header("user-agent") ?? null,
    });

    if ("mfaRequired" in result) {
      await recordPlatformEventSafe({
        severity: "info",
        category: "auth",
        title: "MFA challenge issued",
        message: "Password verification succeeded and MFA verification is required.",
        path: "/api/auth/login",
        method: "POST",
        statusCode: 202,
        metadata: {
          accountHash: hashSha256(parsed.data.email.trim().toLowerCase()),
        },
      });
      response.status(202).json(result);
      return;
    }

    await recordPlatformEventSafe({
      severity: "info",
      category: "auth",
      title: "Login succeeded",
      message: "User completed password authentication.",
      path: "/api/auth/login",
      method: "POST",
      statusCode: 200,
      tenantId: result.user.tenantId,
      actorUserId: result.user.id,
      requestId: String(request.id ?? ""),
      metadata: {
        role: result.user.role,
        method: "password",
      },
    });
    response.cookie(REFRESH_COOKIE_NAME, result.refreshToken, refreshCookieOptions());
    const csrfToken = issueCsrfToken(response);
    response.json({
      accessToken: result.accessToken,
      user: result.user,
      csrfToken,
    });
  } catch {
    await recordPlatformEventSafe({
      severity: "warning",
      category: "auth",
      title: "Login rejected",
      message: "Rejected password login attempt.",
      path: "/api/auth/login",
      method: "POST",
      statusCode: 401,
      metadata: {
        accountHash: hashSha256(parsed.data.email.trim().toLowerCase()),
      },
    });
    response.status(401).json({ message: "Invalid email or password" });
  }
});

router.post("/mfa/verify", mfaVerifyLimiter, async (request, response) => {
  const parsed = mfaVerifySchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ message: "Invalid MFA payload" });
    return;
  }

  try {
    const result = await verifyMfaChallenge({
      mfaToken: parsed.data.mfaToken,
      code: parsed.data.code,
      rememberDevice: parsed.data.rememberDevice,
      userAgent: request.header("user-agent") ?? null,
      ipAddress: request.ip ?? null,
    });
    response.cookie(REFRESH_COOKIE_NAME, result.session.refreshToken, refreshCookieOptions());
    if (result.trustedDeviceToken) {
      response.cookie(MFA_TRUSTED_COOKIE_NAME, result.trustedDeviceToken, mfaTrustedCookieOptions());
    }
    const csrfToken = issueCsrfToken(response);
    await recordPlatformEventSafe({
      severity: "info",
      category: "auth",
      title: "MFA login succeeded",
      message: "User completed multi-factor authentication.",
      path: "/api/auth/mfa/verify",
      method: "POST",
      statusCode: 200,
      tenantId: result.session.user.tenantId,
      actorUserId: result.session.user.id,
      requestId: String(request.id ?? ""),
      metadata: {
        role: result.session.user.role,
        trustedDeviceCreated: Boolean(result.trustedDeviceToken),
      },
    });
    response.json({
      accessToken: result.session.accessToken,
      user: result.session.user,
      csrfToken,
    });
  } catch (error) {
    await recordPlatformEventSafe({
      severity: "warning",
      category: "auth",
      title: "MFA verification rejected",
      message: "A multi-factor authentication challenge was rejected.",
      path: "/api/auth/mfa/verify",
      method: "POST",
      statusCode: 401,
      requestId: String(request.id ?? ""),
    });
    response.status(401).json({ message: error instanceof Error ? error.message : "Invalid MFA code" });
  }
});

router.post("/refresh", refreshLimiter, requireCsrfToken, async (request, response) => {
  const refreshToken = request.cookies?.[REFRESH_COOKIE_NAME];
  if (typeof refreshToken !== "string" || !refreshToken) {
    await recordPlatformEventSafe({
      severity: "warning",
      category: "auth",
      title: "Refresh denied",
      message: "Session refresh attempted without a refresh token cookie.",
      path: "/api/auth/refresh",
      method: "POST",
      statusCode: 401,
    });
    response.status(401).json({ message: "Missing refresh token" });
    return;
  }

  try {
    const result = await refreshLogin(refreshToken);
    response.cookie(REFRESH_COOKIE_NAME, result.refreshToken, refreshCookieOptions());
    const csrfToken = issueCsrfToken(response);
    response.json({
      accessToken: result.accessToken,
      user: result.user,
      csrfToken,
    });
  } catch {
    response.clearCookie(REFRESH_COOKIE_NAME, refreshCookieOptions());
    response.clearCookie(CSRF_COOKIE_NAME, csrfCookieOptions());
    await recordPlatformEventSafe({
      severity: "warning",
      category: "auth",
      title: "Refresh rejected",
      message: "Session refresh token was rejected or expired.",
      path: "/api/auth/refresh",
      method: "POST",
      statusCode: 401,
    });
    response.status(401).json({ message: "Session expired" });
  }
});

router.post("/logout", logoutLimiter, requireCsrfToken, async (request, response) => {
  const refreshToken = request.cookies?.[REFRESH_COOKIE_NAME];
  if (typeof refreshToken === "string" && refreshToken) {
    try {
      await logoutRefreshToken(refreshToken);
    } catch {
      // Best-effort logout. Cookie is cleared below either way.
    }
  }

  response.clearCookie(REFRESH_COOKIE_NAME, refreshCookieOptions());
  response.clearCookie(MFA_TRUSTED_COOKIE_NAME, mfaTrustedCookieOptions());
  response.clearCookie(CSRF_COOKIE_NAME, csrfCookieOptions());
  response.status(204).send();
});

router.post("/logout-all", requireAuth, logoutAllLimiter, requireCsrfToken, async (request, response) => {
  if (!request.auth?.user.id) {
    response.status(401).json({ message: "Unauthorized" });
    return;
  }

  try {
    await logoutAllSessions(request.auth.user.id);
  } finally {
    response.clearCookie(REFRESH_COOKIE_NAME, refreshCookieOptions());
    response.clearCookie(MFA_TRUSTED_COOKIE_NAME, mfaTrustedCookieOptions());
    response.clearCookie(CSRF_COOKIE_NAME, csrfCookieOptions());
  }

  response.status(204).send();
});

router.post("/request-reset", resetRequestLimiter, async (request, response) => {
  const parsed = resetRequestSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ message: "Invalid reset request" });
    return;
  }

  await requestPasswordReset(parsed.data.email);
  await recordPlatformEventSafe({
    severity: "info",
    category: "auth",
    title: "Password reset requested",
    message: "A password reset request was processed with an enumeration-safe response.",
    path: "/api/auth/request-reset",
    method: "POST",
    statusCode: 200,
    requestId: String(request.id ?? ""),
    metadata: {
      accountHash: hashSha256(parsed.data.email.trim().toLowerCase()),
    },
  });
  response.json({
    message: "If the account exists, reset instructions have been sent.",
  });
});

router.post("/reset", resetLimiter, async (request, response) => {
  const parsed = resetSchema.safeParse(request.body);
  if (!parsed.success) {
    await recordPlatformEventSafe({
      severity: "warning",
      category: "auth",
      title: "Password reset rejected",
      message: "Password reset payload failed validation.",
      path: "/api/auth/reset",
      method: "POST",
      statusCode: 400,
    });
    response.status(400).json({ message: "Invalid reset payload" });
    return;
  }

  try {
    const reset = await resetPassword(parsed.data.token, parsed.data.password);
    await recordPlatformEventSafe({
      severity: "info",
      category: "auth",
      title: "Password reset succeeded",
      message: "Password reset completed and existing sessions were revoked.",
      path: "/api/auth/reset",
      method: "POST",
      statusCode: 200,
      tenantId: reset.tenantId,
      actorUserId: reset.userId,
      requestId: String(request.id ?? ""),
    });
    response.json({ message: "Password reset successfully" });
  } catch (error) {
    await recordPlatformEventSafe({
      severity: "warning",
      category: "auth",
      title: "Password reset failed",
      message: error instanceof Error ? error.message : "Reset failed",
      path: "/api/auth/reset",
      method: "POST",
      statusCode: 400,
    });
    response.status(400).json({ message: error instanceof Error ? error.message : "Reset failed" });
  }
});

router.get("/me", requireAuth, (request, response) => {
  response.json({
    user: request.auth?.user ?? null,
  });
});

router.patch("/me", requireAuth, profileUpdateLimiter, async (request, response) => {
  const parsed = updateProfileSchema.safeParse(request.body);
  if (!parsed.success || !request.auth?.user.id) {
    response.status(400).json({ message: "Invalid profile payload" });
    return;
  }

  try {
    const result = await updateOwnProfile(request.auth.user.id, parsed.data);
    response.json({ user: result.user });
  } catch (error) {
    response.status(409).json({ message: error instanceof Error ? error.message : "Profile update failed" });
  }
});

export default router;
