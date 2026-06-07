import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import adminRouter from "./admin";
import businessRouter from "./business";
import platformRouter from "./platform";
import notificationsRouter from "./notifications";
import uploadsRouter from "./uploads";
import securityRouter from "./security";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/auth", authRouter);
router.use("/admin", adminRouter);
router.use("/business", businessRouter);
router.use("/platform", platformRouter);
router.use("/notifications", notificationsRouter);
router.use("/uploads", uploadsRouter);
router.use("/security", securityRouter);

export default router;
