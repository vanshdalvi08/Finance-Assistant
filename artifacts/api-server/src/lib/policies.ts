import { DEFAULT_TENANT_ID } from "./tenants";

export function normalizeTenantId(value?: string | null) {
  return value?.trim() || DEFAULT_TENANT_ID;
}

export function assertActorRoleAccess<TError extends Error>(
  requesterRole: string | undefined,
  allowedRoles: readonly string[],
  errorFactory: () => TError,
) {
  const normalizedRole = typeof requesterRole === "string" ? requesterRole.trim() : "";
  if (!normalizedRole || !allowedRoles.includes(normalizedRole)) {
    throw errorFactory();
  }
}

export function assertTenantAccess<TError extends Error>(
  recordTenantId: string | null | undefined,
  actorTenantId: string,
  errorFactory: () => TError,
) {
  if (normalizeTenantId(recordTenantId) !== normalizeTenantId(actorTenantId)) {
    throw errorFactory();
  }
}

export function assertEmployeeSelfAccess<TError extends Error>(
  recordEmployeeId: string | null | undefined,
  requesterRole: string | undefined,
  requesterUserId: string | undefined,
  errorFactory: () => TError,
) {
  if (requesterRole === "employee" && recordEmployeeId && recordEmployeeId !== requesterUserId) {
    throw errorFactory();
  }
}

export function assertClientSelfAccess<TError extends Error>(
  recordClientId: string | null | undefined,
  requesterRole: string | undefined,
  requesterUserId: string | undefined,
  errorFactory: () => TError,
) {
  if (requesterRole === "client" && recordClientId && recordClientId !== requesterUserId) {
    throw errorFactory();
  }
}

export function assertTenantEmployeeAccess<TError extends Error>(
  recordEmployeeId: string | null | undefined,
  tenantEmployeeIds: ReadonlySet<string>,
  requesterRole: string | undefined,
  requesterUserId: string | undefined,
  errorFactory: () => TError,
) {
  if (!recordEmployeeId || !tenantEmployeeIds.has(recordEmployeeId)) {
    throw errorFactory();
  }

  assertEmployeeSelfAccess(recordEmployeeId, requesterRole, requesterUserId, errorFactory);
}
