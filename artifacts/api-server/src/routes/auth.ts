import { Router, type IRouter } from "express";
import { z } from "zod";
import { loginWithPassword, logoutRefreshToken, refreshLogin, requestPasswordReset, resetPassword, updateOwnProfile } from "../lib/auth-service";
import { requireAuth } from "../middlewares/auth";
import { REFRESH_COOKIE_NAME, refreshCookieOptions } from "../lib/cookies";
import { rateLimit, rateLimitKeyByRemoteAddress, rateLimitKeyByRemoteAddressAndField } from "../middlewares/rate-limit";
import { recordPlatformEventSafe } from "../lib/platform";

const router: IRouter = Router();

const loginLimiter = rateLimit({
  name: "auth-login",
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: "Too many login attempts. Please try again later.",
  keyFn: rateLimitKeyByRemoteAddressAndField("email"),
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

const profileUpdateLimiter = rateLimit({
  name: "auth-profile-update",
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: "Too many profile updates. Please try again later.",
});

const loginSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(8),
});

const resetRequestSchema = z.object({
  email: z.string().trim().email(),
});

const resetSchema = z.object({
  token: z.string().min(16),
  password: z.string().min(8),
});

const updateProfileSchema = z.object({
  name: z.string().trim().min(2),
  email: z.string().trim().email(),
  phone: z.string().trim().min(7),
  position: z.string().trim().min(2).optional(),
  department: z.string().trim().min(2).optional(),
  profilePhotoUrl: z.string().trim().max(2_500_000).nullable().optional(),
});

router.post("/login", loginLimiter, async (request, response) => {
  const parsed = loginSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ message: "Invalid login payload" });
    return;
  }

  try {
    const result = await loginWithPassword(parsed.data.email, parsed.data.password);
    response.cookie(REFRESH_COOKIE_NAME, result.refreshToken, refreshCookieOptions());
    response.json({
      accessToken: result.accessToken,
      user: result.user,
    });
  } catch {
    await recordPlatformEventSafe({
      severity: "warning",
      category: "auth",
      title: "Login rejected",
      message: `Rejected login attempt for ${parsed.data.email.trim().toLowerCase()}.`,
      path: "/api/auth/login",
      method: "POST",
      statusCode: 401,
      metadata: {
        email: parsed.data.email.trim().toLowerCase(),
      },
    });
    response.status(401).json({ message: "Invalid email or password" });
  }
});

router.post("/refresh", refreshLimiter, async (request, response) => {
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
    response.json({
      accessToken: result.accessToken,
      user: result.user,
    });
  } catch {
    response.clearCookie(REFRESH_COOKIE_NAME, refreshCookieOptions());
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

router.post("/logout", logoutLimiter, async (request, response) => {
  const refreshToken = request.cookies?.[REFRESH_COOKIE_NAME];
  if (typeof refreshToken === "string" && refreshToken) {
    try {
      await logoutRefreshToken(refreshToken);
    } catch {
      // Best-effort logout. Cookie is cleared below either way.
    }
  }

  response.clearCookie(REFRESH_COOKIE_NAME, refreshCookieOptions());
  response.status(204).send();
});

router.post("/request-reset", resetRequestLimiter, async (request, response) => {
  const parsed = resetRequestSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ message: "Invalid reset request" });
    return;
  }

  await requestPasswordReset(parsed.data.email);
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
    await resetPassword(parsed.data.token, parsed.data.password);
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
