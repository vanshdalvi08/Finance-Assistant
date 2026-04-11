import type { PublicUser } from "../lib/auth-service";

declare global {
  namespace Express {
    interface Request {
      id?: string;
      auth?: {
        user: PublicUser;
        sessionId: string;
      };
    }
  }
}

export {};
