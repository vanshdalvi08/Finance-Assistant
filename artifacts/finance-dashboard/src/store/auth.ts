import { create } from "zustand";
import { bootstrapSession, signIn, signOut } from "@/auth/auth-service";
import { clearAccessToken, clearCsrfToken, setAccessToken, setCsrfToken } from "@/auth/session";
import type { AuthSession, LoginCredentials, LoginResponse, UserRole } from "@/auth/types";

const TAB_SESSION_USER_KEY = "yojak.auth.tab.user";

function getTabSessionUserId() {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    return window.sessionStorage.getItem(TAB_SESSION_USER_KEY);
  } catch {
    return null;
  }
}

function setTabSessionUserId(userId: string) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.sessionStorage.setItem(TAB_SESSION_USER_KEY, userId);
  } catch {
    // Best effort only.
  }
}

function clearTabSessionUserId() {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.sessionStorage.removeItem(TAB_SESSION_USER_KEY);
  } catch {
    // Best effort only.
  }
}

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
  login: (credentials: LoginCredentials) => Promise<LoginResponse>;
  logout: () => Promise<void>;
}

function clearSessionState(
  set: (partial: Partial<AuthState>) => void,
  hydrated = true,
  options?: { keepTabSessionUser?: boolean },
) {
  clearAccessToken();
  clearCsrfToken();
  if (!options?.keepTabSessionUser) {
    clearTabSessionUserId();
  }
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
  if (session.csrfToken) {
    setCsrfToken(session.csrfToken);
  }
  setTabSessionUserId(session.user.id);
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
    const tabSessionUser = getTabSessionUserId();
    const session = await bootstrapSession();

    if (!session) {
      clearSessionState(set, true);
      return;
    }

    if (tabSessionUser && tabSessionUser !== session.user.id) {
      // Prevent silent identity/role switching in this tab.
      clearAccessToken();
      clearCsrfToken();
      clearSessionState(set, true, { keepTabSessionUser: true });
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
      if ("mfaRequired" in session) {
        set({
          status: "anonymous",
          hydrated: true,
          accessToken: null,
          user: null,
          role: null,
          userEmail: "",
          isAuthenticated: false,
        });
        return session;
      }
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
