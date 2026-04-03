import { createInsertSchema } from "drizzle-zod";
import { index, integer, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

export const userRoleEnum = pgEnum("user_role", ["admin", "employee"]);
export const userStatusEnum = pgEnum("user_status", ["active", "inactive"]);
export const userPayTypeEnum = pgEnum("user_pay_type", ["monthly", "hourly"]);

export const usersTable = pgTable(
  "users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
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
    hashedPassword: text("hashed_password").notNull(),
    status: userStatusEnum("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  },
  (table) => ({
    emailUnique: uniqueIndex("users_email_unique").on(table.email),
    phoneUnique: uniqueIndex("users_phone_unique").on(table.phone),
    employeeIdUnique: uniqueIndex("users_employee_id_unique").on(table.employeeId),
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
