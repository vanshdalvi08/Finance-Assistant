import express, { type Express, type NextFunction, type Request, type Response } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { getApiOriginCandidates, isProduction } from "./lib/env";

const app: Express = express();
const REQUEST_BODY_LIMIT = "4mb";

app.disable("x-powered-by");
if (isProduction()) {
  app.set("trust proxy", 1);
}

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(
  cors({
    origin: getApiOriginCandidates(),
    credentials: true,
  }),
);
app.use((_request, response, next) => {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  response.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  next();
});
app.use(cookieParser());
app.use(express.json({ limit: REQUEST_BODY_LIMIT }));
app.use(express.urlencoded({ extended: true, limit: REQUEST_BODY_LIMIT }));

app.use("/api", router);

app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
  if (
    typeof error === "object" &&
    error !== null &&
    "type" in error &&
    (error as { type?: string }).type === "entity.too.large"
  ) {
    response.status(413).json({
      message: "Uploaded payload is too large. Please use a smaller file.",
    });
    return;
  }

  logger.error({ err: error }, "Unhandled error");
  response.status(500).json({
    message: error instanceof Error ? error.message : "Internal server error",
  });
});

export default app;
