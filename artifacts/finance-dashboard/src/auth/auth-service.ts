import { clearAccessToken, setAccessToken } from "./session";
import { rawAuthRequest, refreshAccessToken, requestJson } from "./http-client";
import type {
  AuthSession,
  CreateEmployeeAccountPayload,
  EmployeeAccountsListResult,
  EmployeeAccountProvisionResult,
  EmployeeAccountUpdateResult,
  LoginCredentials,
  PasswordResetPayload,
  PasswordResetRequest,
  UpdateCurrentUserProfilePayload,
  UpdateEmployeeAccountPayload,
} from "./types";

export async function signIn(credentials: LoginCredentials): Promise<AuthSession> {
  const session = await rawAuthRequest<AuthSession>("/auth/login", {
    method: "POST",
    data: {
      email: credentials.email.trim().toLowerCase(),
      password: credentials.password,
    },
  });

  setAccessToken(session.accessToken);
  return session;
}

export async function bootstrapSession(): Promise<AuthSession | null> {
  try {
    const session = await refreshAccessToken();
    setAccessToken(session.accessToken);
    return session;
  } catch {
    clearAccessToken();
    return null;
  }
}

export async function signOut(): Promise<void> {
  try {
    await rawAuthRequest<void>("/auth/logout", { method: "POST" });
  } catch {
    // Session is cleared locally even if revocation fails.
  } finally {
    clearAccessToken();
  }
}

export async function requestPasswordReset(payload: PasswordResetRequest) {
  return rawAuthRequest<{ message?: string }>("/auth/request-reset", {
    method: "POST",
    data: { email: payload.email.trim().toLowerCase() },
  });
}

export async function resetPassword(payload: PasswordResetPayload) {
  return rawAuthRequest<{ message?: string }>("/auth/reset", {
    method: "POST",
    data: {
      token: payload.token.trim(),
      password: payload.password,
    },
  });
}

export async function createEmployeeAccount(payload: CreateEmployeeAccountPayload) {
  return requestJson<EmployeeAccountProvisionResult>("/admin/employees", {
    method: "POST",
    data: {
      name: payload.name.trim(),
      email: payload.email.trim().toLowerCase(),
      phone: payload.phone.trim(),
      position: payload.position.trim(),
      salary: payload.salary,
      payType: payload.payType,
      hourlyRate: payload.hourlyRate,
      profilePhotoUrl: payload.profilePhotoUrl === undefined ? undefined : payload.profilePhotoUrl,
      department: payload.department?.trim() || undefined,
      status: payload.status ?? "active",
    },
  });
}

export async function updateEmployeeAccount(payload: UpdateEmployeeAccountPayload) {
  return requestJson<EmployeeAccountUpdateResult>(`/admin/employees/${payload.id}`, {
    method: "PATCH",
    data: {
      name: payload.name.trim(),
      email: payload.email.trim().toLowerCase(),
      phone: payload.phone.trim(),
      position: payload.position.trim(),
      salary: payload.salary,
      payType: payload.payType,
      hourlyRate: payload.hourlyRate,
      profilePhotoUrl: payload.profilePhotoUrl === undefined ? undefined : payload.profilePhotoUrl,
      department: payload.department?.trim() || undefined,
      status: payload.status ?? "active",
    },
  });
}

export async function deactivateEmployeeAccount(id: string) {
  return requestJson<EmployeeAccountUpdateResult>(`/admin/employees/${id}`, {
    method: "DELETE",
  });
}

export async function listEmployeeAccounts() {
  return requestJson<EmployeeAccountsListResult>("/admin/employees");
}

export async function updateCurrentUserProfile(payload: UpdateCurrentUserProfilePayload) {
  return requestJson<EmployeeAccountUpdateResult>("/auth/me", {
    method: "PATCH",
    data: {
      name: payload.name.trim(),
      email: payload.email.trim().toLowerCase(),
      phone: payload.phone.trim(),
      position: payload.position?.trim() || undefined,
      department: payload.department?.trim() || undefined,
      profilePhotoUrl: payload.profilePhotoUrl === undefined ? undefined : payload.profilePhotoUrl,
    },
  });
}
