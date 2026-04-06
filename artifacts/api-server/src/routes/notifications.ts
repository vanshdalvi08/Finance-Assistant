import { Router, type IRouter } from "express";
import { z } from "zod";
import { requireAuth } from "../middlewares/auth";
import { listNotificationsForUser, markAllNotificationsRead, markNotificationRead } from "../lib/notifications";

const router: IRouter = Router();

router.use(requireAuth);

router.get("/", async (request, response) => {
  const userId = request.auth?.user.id;
  if (!userId) {
    response.status(401).json({ message: "Unauthorized" });
    return;
  }

  const parsed = z.object({ limit: z.coerce.number().int().min(1).max(100).optional() }).safeParse(request.query);
  const limit = parsed.success ? parsed.data.limit ?? 20 : 20;
  const result = await listNotificationsForUser(userId, limit);
  response.json(result);
});

router.post("/:id/read", async (request, response) => {
  const userId = request.auth?.user.id;
  if (!userId) {
    response.status(401).json({ message: "Unauthorized" });
    return;
  }

  const parsed = z.object({ id: z.string().trim().uuid() }).safeParse(request.params);
  if (!parsed.success) {
    response.status(400).json({ message: "Invalid notification id" });
    return;
  }

  const notification = await markNotificationRead(userId, parsed.data.id);
  if (!notification) {
    response.status(404).json({ message: "Notification not found" });
    return;
  }

  response.json({ notification });
});

router.post("/read-all", async (request, response) => {
  const userId = request.auth?.user.id;
  if (!userId) {
    response.status(401).json({ message: "Unauthorized" });
    return;
  }

  await markAllNotificationsRead(userId);
  response.status(204).send();
});

export default router;
