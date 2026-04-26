let accessToken: string | null = null;
let csrfToken: string | null = null;
const CSRF_TOKEN_KEY = "yojak.auth.csrf";

export function getAccessToken() {
  return accessToken;
}

export function setAccessToken(token: string | null) {
  accessToken = token;
}

export function clearAccessToken() {
  accessToken = null;
}

export function getCsrfToken() {
  if (csrfToken) {
    return csrfToken;
  }

  if (typeof window === "undefined") {
    return null;
  }

  try {
    const stored = window.sessionStorage.getItem(CSRF_TOKEN_KEY);
    if (stored) {
      csrfToken = stored;
      return stored;
    }
  } catch {
    // Best effort only.
  }

  return null;
}

export function setCsrfToken(token: string | null) {
  csrfToken = token;

  if (typeof window === "undefined") {
    return;
  }

  try {
    if (token) {
      window.sessionStorage.setItem(CSRF_TOKEN_KEY, token);
    } else {
      window.sessionStorage.removeItem(CSRF_TOKEN_KEY);
    }
  } catch {
    // Best effort only.
  }
}

export function clearCsrfToken() {
  setCsrfToken(null);
}
