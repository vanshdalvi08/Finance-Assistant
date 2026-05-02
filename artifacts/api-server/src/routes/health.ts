import { Router, type IRouter } from "express";
import { getRuntimeHealthReport } from "../lib/runtime-health";
import { pool } from "@workspace/db";          // 👈 ADD THIS
import { sql } from "drizzle-orm";           // 👈 ADD THIS

const router: IRouter = Router();

router.get("/healthz", async (_req, res) => {
  const report = await getRuntimeHealthReport();
  res.status(200).json(report);
});

// Newly ADDED THIS BLOCK
router.get("/warmup", async (_req, res) => {
  try {
    await pool.query("select 1");
    res.json({ status: "warm" });
  } catch (err) {
    console.error("Warmup failed:", err);
    res.status(500).json({ status: "error" });
  }
});

export default router;