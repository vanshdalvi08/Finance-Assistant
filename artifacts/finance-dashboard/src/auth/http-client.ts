import axios, { AxiosError, type AxiosRequestConfig, type InternalAxiosRequestConfig } from "axios";
import {
  clearAccessToken,
  clearCsrfToken,
  getAccessToken,
  getCsrfToken,
  setAccessToken,
  setCsrfToken,
} from "./session";
import type { AuthSession } from "./types";

const DEFAULT_DEV_API_BASE_URL = "http://localhost:3001/api";
const DEFAULT_PROD_API_BASE_URL = "https://finance-assistant-api-nmc7.onrender.com/api";
const TAB_SESSION_USER_KEY = "yojak.auth.tab.user";
const CSRF_HEADER_NAME = "X-CSRF-Token";
const SAME_SITE_FRONTEND_HOST = "payroll.reforix.com";
const SAME_SITE_API_BASE_URL = "https://api.payroll.reforix.com/api";
const LOCAL_DEV_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);
const API_REQUEST_TIMEOUT_MS = 30_000;

function getSameSiteApiBaseUrl() {
  if (typeof window === "undefined") {
    return null;
  }

  const hostname = window.location.hostname.trim().toLowerCase();
  if (hostname === SAME_SITE_FRONTEND_HOST) {
    return SAME_SITE_API_BASE_URL;
  }

  return null;
}

function getLocalDevApiBaseUrl(configuredBaseUrl: string | undefined) {
  if (typeof window === "undefined") {
    return configuredBaseUrl ?? DEFAULT_DEV_API_BASE_URL;
  }

  const hostname = window.location.hostname.trim().toLowerCase();
  if (!LOCAL_DEV_HOSTS.has(hostname)) {
    return configuredBaseUrl ?? DEFAULT_DEV_API_BASE_URL;
  }

  const protocol = window.location.protocol === "https:" ? "https:" : "http:";
  const hostPart = hostname.includes(":") ? `[${hostname}]` : hostname;
  return `${protocol}//${hostPart}:3001/api`;
}

function getApiBaseUrl() {
  const configuredBaseUrl = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, "");

  // Keep production auth cookies same-site even if an older Render API URL
  // remains configured in the frontend environment.
  const sameSiteBaseUrl = getSameSiteApiBaseUrl();
  if (sameSiteBaseUrl) {
    return sameSiteBaseUrl;
  }

  if (configuredBaseUrl) {
    if (typeof window !== "undefined") {
      const configuredHost = (() => {
        try {
          return new URL(configuredBaseUrl).hostname.trim().toLowerCase();
        } catch {
          return null;
        }
      })();

      if (configuredHost && LOCAL_DEV_HOSTS.has(configuredHost)) {
        const localDevBaseUrl = getLocalDevApiBaseUrl(configuredBaseUrl);
        if (localDevBaseUrl) {
          return localDevBaseUrl;
        }
      }
    }

    return configuredBaseUrl;
  }

  const localDevBaseUrl = getLocalDevApiBaseUrl(undefined);
  if (localDevBaseUrl) {
    return localDevBaseUrl;
  }

  return import.meta.env.PROD ? DEFAULT_PROD_API_BASE_URL : DEFAULT_DEV_API_BASE_URL;
}

export type OAuthProvider = "google" | "microsoft";

export function buildOAuthStartUrl(provider: OAuthProvider, returnTo = "/") {
  const url = new URL(getApiBaseUrl());
  url.pathname = `${url.pathname.replace(/\/$/, "")}/auth/oauth/${provider}/start`;
  url.searchParams.set("returnTo", returnTo);
  return url.toString();
}

function toErrorMessage(error: unknown, fallback: string) {
  if (axios.isAxiosError(error)) {
    const message = error.response?.data?.message;
    if (typeof message === "string" && message.trim()) {
      return message;
    }
  }

  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  return fallback;
}

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

type RetriableRequestConfig = InternalAxiosRequestConfig & {
  _retry?: boolean;
};

const authAxios = axios.create({
  baseURL: getApiBaseUrl(),
  withCredentials: true,
  timeout: API_REQUEST_TIMEOUT_MS,
  headers: {
    Accept: "application/json",
  },
});

const authlessAxios = axios.create({
  baseURL: getApiBaseUrl(),
  withCredentials: true,
  timeout: API_REQUEST_TIMEOUT_MS,
  headers: {
    Accept: "application/json",
  },
});

let refreshPromise: Promise<AuthSession> | null = null;
let csrfBootstrapPromise: Promise<void> | null = null;

function shouldSkipRefresh(config?: AxiosRequestConfig) {
  const url = config?.url ?? "";
  return url.includes("/auth/login") || url.includes("/auth/refresh") || url.includes("/auth/logout");
}

function isMutatingMethod(method?: string) {
  const value = (method ?? "GET").toUpperCase();
  return value === "POST" || value === "PUT" || value === "PATCH" || value === "DELETE";
}

function shouldAttachCsrfHeader(config: AxiosRequestConfig) {
  const url = config.url ?? "";
  if (!isMutatingMethod(config.method)) {
    return false;
  }

  if (url.includes("/auth/csrf")) {
    return false;
  }

  return url.includes("/auth/refresh") || url.includes("/auth/logout");
}

async function ensureCsrfTokenCookie(force = false) {
  if (!force && getCsrfToken()) {
    return;
  }

  if (!csrfBootstrapPromise) {
    csrfBootstrapPromise = authlessAxios
      .get<{ csrfToken: string }>("/auth/csrf")
      .then((response) => {
        if (response.data.csrfToken) {
          setCsrfToken(response.data.csrfToken);
        }
      })
      .finally(() => {
        csrfBootstrapPromise = null;
      });
  }

  await csrfBootstrapPromise;
}

async function postRefreshSession() {
  try {
    return await authlessAxios.post<AuthSession>("/auth/refresh");
  } catch (error) {
    if (!axios.isAxiosError(error) || error.response?.status !== 403) {
      throw error;
    }

    // A restored browser tab can retain a readable CSRF value after its
    // matching cookie has changed. Re-bootstrap once before expiring login.
    clearCsrfToken();
    await ensureCsrfTokenCookie(true);
    return authlessAxios.post<AuthSession>("/auth/refresh");
  }
}

async function withCsrfHeader(config: InternalAxiosRequestConfig) {
  if (!shouldAttachCsrfHeader(config)) {
    return config;
  }

  if (!getCsrfToken()) {
    await ensureCsrfTokenCookie();
  }

  const token = getCsrfToken();
  if (token) {
    config.headers.set(CSRF_HEADER_NAME, token);
  }

  return config;
}

async function performRefresh(): Promise<AuthSession> {
  if (!refreshPromise) {
    refreshPromise = postRefreshSession()
      .then((response) => {
        const tabSessionUserId = getTabSessionUserId();
        if (tabSessionUserId && tabSessionUserId !== response.data.user.id) {
          clearAccessToken();
          throw new Error("Session changed in another tab. Please sign in again.");
        }
        setAccessToken(response.data.accessToken);
        if (response.data.csrfToken) {
          setCsrfToken(response.data.csrfToken);
        }
        return response.data;
      })
      .finally(() => {
        refreshPromise = null;
      });
  }

  return refreshPromise;
}

authAxios.interceptors.request.use(async (config) => {
  await withCsrfHeader(config);
  const token = getAccessToken();
  if (token) {
    config.headers.set("Authorization", `Bearer ${token}`);
  }

  return config;
});

authlessAxios.interceptors.request.use(async (config) => {
  await withCsrfHeader(config);
  return config;
});

authAxios.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const config = error.config as RetriableRequestConfig | undefined;

    if (!config || config._retry || error.response?.status !== 401 || shouldSkipRefresh(config)) {
      throw new Error(toErrorMessage(error, "Request failed."));
    }

    try {
      config._retry = true;
      const session = await performRefresh();
      config.headers.set("Authorization", `Bearer ${session.accessToken}`);
      return await authAxios.request(config);
    } catch {
      clearAccessToken();
      clearCsrfToken();
      throw new Error("Your session expired. Please sign in again.");
    }
  },
);

export async function refreshAccessToken(): Promise<AuthSession> {
  try {
    return await performRefresh();
  } catch (error) {
    clearAccessToken();
    clearCsrfToken();
    throw new Error(toErrorMessage(error, "Your session expired. Please sign in again."));
  }
}

export async function requestJson<T>(
  path: string,
  config: AxiosRequestConfig = {},
  options: { auth?: boolean } = {},
): Promise<T> {
  const client = options.auth === false ? authlessAxios : authAxios;

  try {
    const response = await client.request<T>({
      url: path,
      ...config,
    });
    return response.data;
  } catch (error) {
    const wrapped = new Error(toErrorMessage(error, "Request failed.")) as Error & { status?: number };
    if (axios.isAxiosError(error)) {
      wrapped.status = error.response?.status;
    }

    throw wrapped;
  }
}

export async function requestFormData<T>(
  path: string,
  data: FormData,
  config: AxiosRequestConfig = {},
  options: { auth?: boolean } = {},
): Promise<T> {
  const client = options.auth === false ? authlessAxios : authAxios;

  try {
    const response = await client.request<T>({
      url: path,
      method: config.method ?? "POST",
      ...config,
      data,
    });
    return response.data;
  } catch (error) {
    const wrapped = new Error(toErrorMessage(error, "Upload failed.")) as Error & { status?: number };
    if (axios.isAxiosError(error)) {
      wrapped.status = error.response?.status;
    }

    throw wrapped;
  }
}

export async function rawAuthRequest<T>(path: string, config: AxiosRequestConfig = {}): Promise<T> {
  return requestJson<T>(path, config, { auth: false });
}

export async function requestBinary<T>(path: string, file: File, headers: Record<string, string> = {}): Promise<T> {
  return requestJson<T>(path, {
    method: "POST",
    data: file,
    headers: {
      "Content-Type": file.type || "application/octet-stream",
      ...headers,
    },
  });
}
