import crypto from "node:crypto";
import { env, getAppUrl, isProduction, optionalEnv } from "./env";
import { generateRandomToken } from "./security";

export type OAuthProvider = "google" | "microsoft";

export interface OAuthProfile {
  email: string;
  name: string;
  providerSubject: string;
  providerDisplayName: string | null;
  pictureUrl: string | null;
}

interface OAuthProviderConfig {
  provider: OAuthProvider;
  authorizationUrl: string;
  tokenUrl: string;
  userInfoUrl: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scopes: string[];
}

interface OAuthStatePayload {
  provider: OAuthProvider;
  redirectPath: string;
  nonce: string;
  exp: number;
}

function oauthStateSecret() {
  const secret = optionalEnv("AUTH_OAUTH_STATE_SECRET");
  if (secret) {
    return secret;
  }

  if (isProduction()) {
    throw new Error("Missing required environment variable: AUTH_OAUTH_STATE_SECRET");
  }

  return "reforix-dev-oauth-state-secret";
}

function providerName(provider: OAuthProvider) {
  return provider === "google" ? "Google" : "Microsoft";
}

function safeRedirectPath(pathname?: string | null) {
  const value = (pathname ?? "/").trim();
  if (!value.startsWith("/") || value.startsWith("//")) {
    return "/";
  }

  return value;
}

function signState(payload: OAuthStatePayload) {
  const serialized = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = crypto.createHmac("sha256", oauthStateSecret()).update(serialized).digest("base64url");
  return `${serialized}.${signature}`;
}

function verifyState(state: string, expectedProvider: OAuthProvider): OAuthStatePayload {
  const [serialized, signature] = state.split(".");
  if (!serialized || !signature) {
    throw new Error("Invalid OAuth state");
  }

  const expectedSignature = crypto.createHmac("sha256", oauthStateSecret()).update(serialized).digest("base64url");
  const expectedBuffer = Buffer.from(expectedSignature);
  const actualBuffer = Buffer.from(signature);
  if (expectedBuffer.length !== actualBuffer.length || !crypto.timingSafeEqual(expectedBuffer, actualBuffer)) {
    throw new Error("Invalid OAuth state");
  }

  const parsed = JSON.parse(Buffer.from(serialized, "base64url").toString("utf8")) as OAuthStatePayload;
  if (parsed.provider !== expectedProvider || parsed.exp < Date.now()) {
    throw new Error("OAuth state expired");
  }

  return parsed;
}

function requireConfig(provider: OAuthProvider): OAuthProviderConfig {
  if (provider === "google") {
    return {
      provider,
      authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth",
      tokenUrl: "https://oauth2.googleapis.com/token",
      userInfoUrl: "https://openidconnect.googleapis.com/v1/userinfo",
      clientId: env("GOOGLE_OAUTH_CLIENT_ID"),
      clientSecret: env("GOOGLE_OAUTH_CLIENT_SECRET"),
      redirectUri: env("GOOGLE_OAUTH_REDIRECT_URI"),
      scopes: ["openid", "email", "profile"],
    };
  }

  return {
    provider,
    authorizationUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    tokenUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    userInfoUrl: "https://graph.microsoft.com/v1.0/me?$select=id,displayName,mail,userPrincipalName",
    clientId: env("MICROSOFT_OAUTH_CLIENT_ID"),
    clientSecret: env("MICROSOFT_OAUTH_CLIENT_SECRET"),
    redirectUri: env("MICROSOFT_OAUTH_REDIRECT_URI"),
    scopes: ["openid", "profile", "email", "User.Read"],
  };
}

async function readJsonResponse<T>(response: Response, provider: OAuthProvider) {
  const payload = (await response.json().catch(() => null)) as T | null;
  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && "error_description" in payload && typeof payload.error_description === "string"
        ? payload.error_description
        : payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string"
          ? payload.error
          : `${providerName(provider)} OAuth request failed`;
    throw new Error(message);
  }

  if (!payload) {
    throw new Error("OAuth provider returned an empty response");
  }

  return payload;
}

export function buildOAuthStartUrl(provider: OAuthProvider, redirectPath = "/") {
  const config = requireConfig(provider);
  const state = signState({
    provider,
    redirectPath: safeRedirectPath(redirectPath),
    nonce: generateRandomToken(18),
    exp: Date.now() + 10 * 60 * 1000,
  });

  const url = new URL(config.authorizationUrl);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", config.scopes.join(" "));
  url.searchParams.set("state", state);

  if (provider === "google") {
    url.searchParams.set("prompt", "select_account");
    url.searchParams.set("access_type", "online");
    url.searchParams.set("include_granted_scopes", "true");
  } else {
    url.searchParams.set("prompt", "select_account");
    url.searchParams.set("response_mode", "query");
  }

  return url.toString();
}

export function parseOAuthState(state: string, provider: OAuthProvider) {
  return verifyState(state, provider);
}

export function getOAuthRedirectTarget(redirectPath: string) {
  return new URL(safeRedirectPath(redirectPath), getAppUrl()).toString();
}

export async function exchangeOAuthCode(provider: OAuthProvider, code: string): Promise<OAuthProfile> {
  const config = requireConfig(provider);
  const tokenResponse = await fetch(config.tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      grant_type: "authorization_code",
      redirect_uri: config.redirectUri,
    }),
  });

  const tokenPayload = (await readJsonResponse<{
    access_token?: string;
    token_type?: string;
    expires_in?: number;
    id_token?: string;
  }>(tokenResponse, provider)) as {
    access_token?: string;
    token_type?: string;
    expires_in?: number;
    id_token?: string;
  };

  const accessToken = tokenPayload.access_token;
  if (!accessToken) {
    throw new Error("OAuth provider did not return an access token");
  }

  if (provider === "google") {
    const profileResponse = await fetch(config.userInfoUrl, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
    });

    const profile = (await readJsonResponse<{
      sub?: string;
      email?: string;
      email_verified?: boolean;
      name?: string;
      picture?: string;
    }>(profileResponse, provider)) as {
      sub?: string;
      email?: string;
      email_verified?: boolean;
      name?: string;
      picture?: string;
    };

    if (!profile.email || !profile.email_verified || !profile.sub) {
      throw new Error("Google account email is not verified");
    }

    return {
      email: profile.email.trim().toLowerCase(),
      name: (profile.name?.trim() || profile.email.trim()).trim(),
      providerSubject: profile.sub,
      providerDisplayName: "Google",
      pictureUrl: profile.picture?.trim() || null,
    };
  }

  const profileResponse = await fetch(config.userInfoUrl, {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
  });

  const profile = (await readJsonResponse<{
    id?: string;
    displayName?: string;
    mail?: string;
    userPrincipalName?: string;
  }>(profileResponse, provider)) as {
    id?: string;
    displayName?: string;
    mail?: string;
    userPrincipalName?: string;
  };

  const email = (profile.mail ?? profile.userPrincipalName ?? "").trim().toLowerCase();
  if (!email || !profile.id) {
    throw new Error("Microsoft account did not return a usable email address");
  }

  return {
    email,
    name: (profile.displayName?.trim() || email).trim(),
    providerSubject: profile.id,
    providerDisplayName: "Microsoft",
    pictureUrl: null,
  };
}
