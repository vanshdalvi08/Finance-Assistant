import pino from "pino";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: [
    "req.headers.authorization",
    "req.headers.cookie",
    "req.body.password",
    "req.body.ownerPassword",
    "req.body.token",
    "req.query.token",
    "res.headers['set-cookie']",
  ],
});
