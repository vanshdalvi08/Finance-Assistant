import { create } from "zustand";
import { bootstrapSession, signIn, signOut } from "@/auth/auth-service";
import { clearAccessToken, setAccessToken } from "@/auth/session";
import type { AuthSession, LoginCredentials, UserRole } from "@/auth/types";

interface AuthState {
  status: "idle" | "loading" | "authenticated" | "anonymous";
  hydrated: boolean;
  accessToken: string | null;
  user: AuthSession["user"] | null;
  role: UserRole | null;
  userEmail: string;
  isAuthenticated: boolean;
  hydrateFromStorage: () => Promise<void>;
  loginWithSession: (session: AuthSession) => void;
  replaceUser: (user: AuthSession["user"]) => void;
  login: (credentials: LoginCredentials) => Promise<AuthSession>;
  logout: () => Promise<void>;
}

function clearSessionState(set: (partial: Partial<AuthState>) => void, hydrated = true) {
  clearAccessToken();
  set({
    status: "anonymous",
    hydrated,
    accessToken: null,
    user: null,
    role: null,
    userEmail: "",
    isAuthenticated: false,
  });
}

function applySession(set: (partial: Partial<AuthState>) => void, session: AuthSession) {
  setAccessToken(session.accessToken);
  set({
    status: "authenticated",
    hydrated: true,
    accessToken: session.accessToken,
    user: session.user,
    role: session.user.role,
    userEmail: session.user.email,
    isAuthenticated: true,
  });
}

export const useAuthStore = create<AuthState>((set) => ({
  status: "idle",
  hydrated: false,
  accessToken: null,
  user: null,
  role: null,
  userEmail: "",
  isAuthenticated: false,
  hydrateFromStorage: async () => {
    set({ status: "loading" });
    const session = await bootstrapSession();

    if (!session) {
      clearSessionState(set, true);
      return;
    }

    applySession(set, session);
  },
  loginWithSession: (session) => {
    applySession(set, session);
  },
  replaceUser: (user) => {
    set((state) => ({
      user,
      role: user.role,
      userEmail: user.email,
      isAuthenticated: state.isAuthenticated,
      status: state.isAuthenticated ? "authenticated" : state.status,
    }));
  },
  login: async (credentials) => {
    set({ status: "loading" });

    try {
      const session = await signIn(credentials);
      applySession(set, session);
      return session;
    } catch (error) {
      clearSessionState(set, true);
      throw error;
    }
  },
  logout: async () => {
    try {
      await signOut();
    } finally {
      clearSessionState(set, true);
    }
  },
}));
