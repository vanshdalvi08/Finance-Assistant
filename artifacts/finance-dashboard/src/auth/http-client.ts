import axios, { AxiosError, type AxiosRequestConfig, type InternalAxiosRequestConfig } from "axios";
import { clearAccessToken, getAccessToken, setAccessToken } from "./session";
import type { AuthSession } from "./types";

const DEFAULT_DEV_API_BASE_URL = "http://localhost:3001/api";
const DEFAULT_PROD_API_BASE_URL = "https://finance-assistant-api-nmc7.onrender.com/api";
const TAB_SESSION_USER_KEY = "yojak.auth.tab.user";

function getApiBaseUrl() {
  const configuredBaseUrl = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, "");
  if (configuredBaseUrl) {
    return configuredBaseUrl;
  }

  return import.meta.env.PROD ? DEFAULT_PROD_API_BASE_URL : DEFAULT_DEV_API_BASE_URL;
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
  headers: {
    Accept: "application/json",
  },
});

const authlessAxios = axios.create({
  baseURL: getApiBaseUrl(),
  withCredentials: true,
  headers: {
    Accept: "application/json",
  },
});

let refreshPromise: Promise<AuthSession> | null = null;

function shouldSkipRefresh(config?: AxiosRequestConfig) {
  const url = config?.url ?? "";
  return url.includes("/auth/login") || url.includes("/auth/refresh") || url.includes("/auth/logout");
}

async function performRefresh(): Promise<AuthSession> {
  if (!refreshPromise) {
    refreshPromise = authlessAxios
      .post<AuthSession>("/auth/refresh")
      .then((response) => {
        const tabSessionUserId = getTabSessionUserId();
        if (tabSessionUserId && tabSessionUserId !== response.data.user.id) {
          clearAccessToken();
          throw new Error("Session changed in another tab. Please sign in again.");
        }
        setAccessToken(response.data.accessToken);
        return response.data;
      })
      .finally(() => {
        refreshPromise = null;
      });
  }

  return refreshPromise;
}

authAxios.interceptors.request.use((config) => {
  const token = getAccessToken();
  if (token) {
    config.headers.set("Authorization", `Bearer ${token}`);
  }

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
      throw new Error("Your session expired. Please sign in again.");
    }
  },
);

export async function refreshAccessToken(): Promise<AuthSession> {
  try {
    return await performRefresh();
  } catch (error) {
    clearAccessToken();
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
