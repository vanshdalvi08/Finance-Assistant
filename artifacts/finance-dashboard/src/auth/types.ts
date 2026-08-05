export type UserRole = "admin" | "employee" | "client" | "platform_super_admin";

export interface AuthUser {
  id: string;
  tenantId?: string;
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
  joiningDate?: string | null;
  bankName?: string | null;
  bankAccountNumber?: string | null;
  ifscCode?: string | null;
  bankBranch?: string | null;
  uan?: string | null;
  pfNumber?: string | null;
  esiNumber?: string | null;
  profilePhotoUrl?: string | null;
  clientInfo?: {
    companyName?: string;
    address?: string;
    phone?: string;
    email?: string;
    website?: string;
    gstin?: string;
  };
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
  csrfToken?: string;
}

export interface MfaChallenge {
  mfaRequired: true;
  mfaSetupRequired: boolean;
  rememberDeviceAvailable: boolean;
  mfaToken: string;
  mfaSecret?: string;
  otpauthUrl?: string;
}

export type LoginResponse = AuthSession | MfaChallenge;

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
  joiningDate?: string | null;
  bankName?: string | null;
  bankAccountNumber?: string | null;
  ifscCode?: string | null;
  bankBranch?: string | null;
  uan?: string | null;
  pfNumber?: string | null;
  esiNumber?: string | null;
  profilePhotoUrl?: string | null;
  department?: string;
  status?: "active" | "inactive";
}

export interface CreateAdminAccountPayload {
  name: string;
  email: string;
  phone: string;
  position?: string;
  department?: string;
  status?: "active" | "inactive";
}

export interface UpdateAdminAccountPayload extends CreateAdminAccountPayload {
  id: string;
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
  joiningDate?: string | null;
  bankName?: string | null;
  bankAccountNumber?: string | null;
  ifscCode?: string | null;
  bankBranch?: string | null;
  uan?: string | null;
  pfNumber?: string | null;
  esiNumber?: string | null;
  profilePhotoUrl?: string | null;
  department?: string;
  status?: "active" | "inactive";
}

export interface CreateClientAccountPayload {
  name: string;
  email: string;
  phone: string;
  company?: string;
  address?: string;
  gstin?: string;
  website?: string;
  billingEmail?: string;
  status?: "active" | "inactive";
}

export interface UpdateClientAccountPayload extends CreateClientAccountPayload {
  id: string;
}

export interface UpdateCurrentUserProfilePayload {
  name: string;
  email: string;
  phone: string;
  position?: string;
  department?: string;
  profilePhotoUrl?: string | null;
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

export interface AdminAccountsListResult {
  admins: AuthUser[];
}

export interface ClientAccountsListResult {
  clients: AuthUser[];
}
