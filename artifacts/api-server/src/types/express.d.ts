import type { PublicUser } from "../lib/auth-service";

declare global {
  namespace Express {
    interface Request {
      auth?: {
        user: PublicUser;
        sessionId: string;
      };
    }
  }
}

export {};
