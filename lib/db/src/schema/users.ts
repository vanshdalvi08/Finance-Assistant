import { createInsertSchema } from "drizzle-zod";
import { boolean, index, integer, jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { tenantsTable } from "./tenants";

export const userRoleEnum = pgEnum("user_role", ["admin", "employee", "client", "platform_super_admin"]);
export const userStatusEnum = pgEnum("user_status", ["active", "inactive"]);
export const userPayTypeEnum = pgEnum("user_pay_type", ["monthly", "hourly"]);

export interface ClientBillingInfo {
  companyName?: string;
  address?: string;
  phone?: string;
  email?: string;
  website?: string;
}

export const usersTable = pgTable(
  "users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    email: text("email").notNull(),
    phone: text("phone").notNull(),
    role: userRoleEnum("role").notNull(),
    employeeId: text("employee_id"),
    position: text("position"),
    department: text("department"),
    salary: integer("salary").notNull().default(0),
    payType: userPayTypeEnum("pay_type").notNull().default("monthly"),
    hourlyRate: integer("hourly_rate").notNull().default(0),
    joiningDate: timestamp("joining_date", { withTimezone: true }),
    bankName: text("bank_name"),
    bankAccountNumber: text("bank_account_number"),
    uan: text("uan"),
    pfNumber: text("pf_number"),
    esiNumber: text("esi_number"),
    profilePhotoUrl: text("profile_photo_url"),
    clientInfo: jsonb("client_info").$type<ClientBillingInfo>().notNull().default({}),
    hashedPassword: text("hashed_password").notNull(),
    status: userStatusEnum("status").notNull().default("active"),
    mfaEnabled: boolean("mfa_enabled").notNull().default(false),
    mfaSecret: text("mfa_secret"),
    mfaEnrolledAt: timestamp("mfa_enrolled_at", { withTimezone: true }),
    mfaUpdatedAt: timestamp("mfa_updated_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  },
  (table) => ({
    tenantIndex: index("users_tenant_index").on(table.tenantId),
    emailUnique: uniqueIndex("users_email_unique").on(table.email),
    phoneTenantUnique: uniqueIndex("users_tenant_phone_unique").on(table.tenantId, table.phone),
    employeeIdTenantUnique: uniqueIndex("users_tenant_employee_id_unique").on(table.tenantId, table.employeeId),
    roleIndex: index("users_role_index").on(table.role),
    statusIndex: index("users_status_index").on(table.status),
  }),
);

export const insertUserSchema = createInsertSchema(usersTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  lastLoginAt: true,
});

export type User = typeof usersTable.$inferSelect;
export type InsertUser = typeof usersTable.$inferInsert;
