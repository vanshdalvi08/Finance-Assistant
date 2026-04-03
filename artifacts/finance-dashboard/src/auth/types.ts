export type UserRole = "admin" | "employee";

export interface AuthUser {
  id: string;
  email: string;
  role: UserRole;
  name?: string;
  phone?: string;
  employeeId?: string;
  position?: string;
  department?: string;
  salary?: number;
  payType?: "monthly" | "hourly";
  hourlyRate?: number;
  status?: "active" | "inactive";
  createdAt?: string;
  updatedAt?: string;
  lastLoginAt?: string | null;
}

export interface JwtPayload {
  id: string;
  email: string;
  role: UserRole;
  name?: string;
  exp?: number;
  iat?: number;
}

export interface LoginCredentials {
  email: string;
  password: string;
}

export interface AuthSession {
  user: AuthUser;
  accessToken: string;
}

export interface PasswordResetRequest {
  email: string;
}

export interface PasswordResetPayload {
  token: string;
  password: string;
}

export interface CreateEmployeeAccountPayload {
  name: string;
  email: string;
  phone: string;
  position: string;
  salary: number;
  payType?: "monthly" | "hourly";
  hourlyRate?: number;
  department?: string;
  status?: "active" | "inactive";
}

export interface UpdateEmployeeAccountPayload {
  id: string;
  name: string;
  email: string;
  phone: string;
  position: string;
  salary: number;
  payType?: "monthly" | "hourly";
  hourlyRate?: number;
  department?: string;
  status?: "active" | "inactive";
}

export interface UpdateCurrentUserProfilePayload {
  name: string;
  email: string;
  phone: string;
  position?: string;
  department?: string;
}

export interface EmployeeAccountProvisionResult {
  user: AuthUser;
  employeeId?: string | null;
  onboardingEmailSent: boolean;
  temporaryPassword?: string;
}

export interface EmployeeAccountUpdateResult {
  user: AuthUser;
}

export interface EmployeeAccountsListResult {
  employees: AuthUser[];
}
