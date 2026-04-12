import { Router, type IRouter } from "express";
import { getRuntimeHealthReport } from "../lib/runtime-health";

const router: IRouter = Router();

router.get("/healthz", async (_req, res) => {
  const report = await getRuntimeHealthReport();
  res.status(report.status === "error" ? 503 : 200).json(report);
});

export default router;
