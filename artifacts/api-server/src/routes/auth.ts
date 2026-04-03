import { Router, type IRouter } from "express";
import { z } from "zod";
import { loginWithPassword, logoutRefreshToken, refreshLogin, requestPasswordReset, resetPassword, updateOwnProfile } from "../lib/auth-service";
import { requireAuth } from "../middlewares/auth";
import { REFRESH_COOKIE_NAME, refreshCookieOptions } from "../lib/cookies";

const router: IRouter = Router();

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
});

router.post("/login", async (request, response) => {
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
  } catch (error) {
    response.status(401).json({ message: error instanceof Error ? error.message : "Login failed" });
  }
});

router.post("/refresh", async (request, response) => {
  const refreshToken = request.cookies?.[REFRESH_COOKIE_NAME];
  if (typeof refreshToken !== "string" || !refreshToken) {
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
    response.status(401).json({ message: "Session expired" });
  }
});

router.post("/logout", async (request, response) => {
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

router.post("/request-reset", async (request, response) => {
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

router.post("/reset", async (request, response) => {
  const parsed = resetSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ message: "Invalid reset payload" });
    return;
  }

  try {
    await resetPassword(parsed.data.token, parsed.data.password);
    response.json({ message: "Password reset successfully" });
  } catch (error) {
    response.status(400).json({ message: error instanceof Error ? error.message : "Reset failed" });
  }
});

router.get("/me", requireAuth, (request, response) => {
  response.json({
    user: request.auth?.user ?? null,
  });
});

router.patch("/me", requireAuth, async (request, response) => {
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
