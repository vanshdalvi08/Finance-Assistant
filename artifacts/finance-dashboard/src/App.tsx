import { Redirect, Route, Switch, Router as WouterRouter } from "wouter";
import { AppProviders } from "@/app/providers";
import { useAuthStore } from "@/store/auth";
import LoginPage from "@/pages/login";
import ResetPasswordPage from "@/pages/auth/reset-password";
import DashboardPage from "@/pages/dashboard";
import TransactionsPage from "@/pages/transactions";
import AdminsPage from "@/pages/admins";
import EmployeesPage from "@/pages/employees";
import SalaryPage from "@/pages/salary";
import FundsPage from "@/pages/funds";
import ClientsPage from "@/pages/clients";
import PurchaseOrdersPage from "@/pages/purchase-orders";
import PreApprovalsPage from "@/pages/pre-approvals";
import ProjectBudgetsPage from "@/pages/project-budgets";
import ExpensesPage from "@/pages/expenses";
import SettingsPage from "@/pages/settings";
import FinancialAccountsPage from "@/pages/financial-accounts";
import AdminTimesheetValidationPage from "@/pages/admin/timesheet-validation";
import AdminLeaveManagementPage from "@/pages/admin/leave-management";
import AdminReportsPage from "@/pages/admin/reports";
import AdminAuditTrailPage from "@/pages/admin/audit-trail";
import EmployeeTimesheetPage from "@/pages/employee/timesheet";
import EmployeeTaskManagerPage from "@/pages/employee/task-manager";
import EmployeeLeavesPage from "@/pages/employee/leaves";
import EmployeeExpensesPage from "@/pages/employee/expenses";
import EmployeeSalarySlipsPage from "@/pages/employee/salary-slips";
import EmployeeProfilePage from "@/pages/employee/profile";
import ClientPreApprovalsPage from "@/pages/client/pre-approvals";
import PlatformDashboardPage from "@/pages/platform/dashboard";
import PlatformTenantsPage from "@/pages/platform/tenants";
import PlatformMonitoringPage from "@/pages/platform/monitoring";
import PlatformRecoveryPage from "@/pages/platform/recovery";
import PlatformSettingsPage from "@/pages/platform/settings";
import NotFoundPage from "@/pages/not-found";
import type { UserRole } from "@/auth/types";

function FullScreenLoader() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background text-sm text-muted-foreground">
      Booting your workspace...
    </div>
  );
}

function workspacePath(role: UserRole | null) {
  switch (role) {
    case "employee":
      return "/employee/timesheet";
    case "client":
      return "/client/pre-approvals";
    case "platform_super_admin":
      return "/platform/dashboard";
    default:
      return "/";
  }
}

function redirectForSession(isAuthenticated: boolean, role: UserRole | null) {
  if (!isAuthenticated) {
    return <Redirect to="/login" />;
  }

  return <Redirect to={workspacePath(role)} />;
}

function renderRoleRoute(
  isAuthenticated: boolean,
  role: UserRole | null,
  expectedRole: UserRole,
  element: React.ReactNode,
) {
  return isAuthenticated && role === expectedRole ? element : redirectForSession(isAuthenticated, role);
}

function LegacyRouter() {
  const hydrated = useAuthStore((state) => state.hydrated);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const role = useAuthStore((state) => state.role);

  if (!hydrated) {
    return <FullScreenLoader />;
  }

  return (
    <WouterRouter base={import.meta.env.BASE_URL?.replace(/\/$/, "") || ""}>
      <Switch>
        <Route path="/login">
          {isAuthenticated ? redirectForSession(isAuthenticated, role) : <LoginPage />}
        </Route>
        <Route path="/reset">
          {isAuthenticated ? redirectForSession(isAuthenticated, role) : <ResetPasswordPage />}
        </Route>
        <Route path="/">
          {!hydrated ? (
            <FullScreenLoader />
          ) : !isAuthenticated ? (
            <Redirect to="/login" />
          ) : role === "admin" ? (
            <DashboardPage />
          ) : (
            redirectForSession(isAuthenticated, role)
          )}
        </Route>
        <Route path="/transactions">
          {renderRoleRoute(isAuthenticated, role, "admin", <TransactionsPage />)}
        </Route>
        <Route path="/admins">
          {renderRoleRoute(isAuthenticated, role, "admin", <AdminsPage />)}
        </Route>
        <Route path="/employees">
          {renderRoleRoute(isAuthenticated, role, "admin", <EmployeesPage />)}
        </Route>
        <Route path="/salary">
          {renderRoleRoute(isAuthenticated, role, "admin", <SalaryPage />)}
        </Route>
        <Route path="/funds">
          {renderRoleRoute(isAuthenticated, role, "admin", <FundsPage />)}
        </Route>
        <Route path="/clients">
          {renderRoleRoute(isAuthenticated, role, "admin", <ClientsPage />)}
        </Route>
        <Route path="/purchase-orders">
          {renderRoleRoute(isAuthenticated, role, "admin", <PurchaseOrdersPage />)}
        </Route>
        <Route path="/pre-approvals">
          {renderRoleRoute(isAuthenticated, role, "admin", <PreApprovalsPage />)}
        </Route>
        <Route path="/project-budgets">
          {renderRoleRoute(isAuthenticated, role, "admin", <ProjectBudgetsPage />)}
        </Route>
        <Route path="/expenses">
          {renderRoleRoute(isAuthenticated, role, "admin", <ExpensesPage />)}
        </Route>
        <Route path="/settings">
          {renderRoleRoute(isAuthenticated, role, "admin", <SettingsPage />)}
        </Route>
        <Route path="/settings/financial-accounts">
          {renderRoleRoute(isAuthenticated, role, "admin", <FinancialAccountsPage />)}
        </Route>
        <Route path="/timesheets">
          {renderRoleRoute(isAuthenticated, role, "admin", <AdminTimesheetValidationPage />)}
        </Route>
        <Route path="/leave-management">
          {renderRoleRoute(isAuthenticated, role, "admin", <AdminLeaveManagementPage />)}
        </Route>
        <Route path="/reports">
          {renderRoleRoute(isAuthenticated, role, "admin", <AdminReportsPage />)}
        </Route>
        <Route path="/audit-trail">
          {renderRoleRoute(isAuthenticated, role, "admin", <AdminAuditTrailPage />)}
        </Route>
        <Route path="/admin/dashboard">{renderRoleRoute(isAuthenticated, role, "admin", <Redirect to="/" />)}</Route>
        <Route path="/admin/transactions">{renderRoleRoute(isAuthenticated, role, "admin", <Redirect to="/transactions" />)}</Route>
        <Route path="/admin/admins">{renderRoleRoute(isAuthenticated, role, "admin", <Redirect to="/admins" />)}</Route>
        <Route path="/admin/employees">{renderRoleRoute(isAuthenticated, role, "admin", <Redirect to="/employees" />)}</Route>
        <Route path="/admin/salary">{renderRoleRoute(isAuthenticated, role, "admin", <Redirect to="/salary" />)}</Route>
        <Route path="/admin/funds">{renderRoleRoute(isAuthenticated, role, "admin", <Redirect to="/funds" />)}</Route>
        <Route path="/admin/clients">{renderRoleRoute(isAuthenticated, role, "admin", <Redirect to="/clients" />)}</Route>
        <Route path="/admin/purchase-orders">{renderRoleRoute(isAuthenticated, role, "admin", <Redirect to="/purchase-orders" />)}</Route>
        <Route path="/admin/pre-approvals">{renderRoleRoute(isAuthenticated, role, "admin", <Redirect to="/pre-approvals" />)}</Route>
        <Route path="/admin/project-budgets">{renderRoleRoute(isAuthenticated, role, "admin", <Redirect to="/project-budgets" />)}</Route>
        <Route path="/admin/expenses">{renderRoleRoute(isAuthenticated, role, "admin", <Redirect to="/expenses" />)}</Route>
        <Route path="/admin/settings">{renderRoleRoute(isAuthenticated, role, "admin", <Redirect to="/settings" />)}</Route>
        <Route path="/admin/settings/financial-accounts">{renderRoleRoute(isAuthenticated, role, "admin", <Redirect to="/settings/financial-accounts" />)}</Route>
        <Route path="/admin/timesheets">{renderRoleRoute(isAuthenticated, role, "admin", <Redirect to="/timesheets" />)}</Route>
        <Route path="/admin/leave-management">{renderRoleRoute(isAuthenticated, role, "admin", <Redirect to="/leave-management" />)}</Route>
        <Route path="/admin/reports">{renderRoleRoute(isAuthenticated, role, "admin", <Redirect to="/reports" />)}</Route>
        <Route path="/admin/audit-trail">{renderRoleRoute(isAuthenticated, role, "admin", <Redirect to="/audit-trail" />)}</Route>
        <Route path="/employee/dashboard">
          {renderRoleRoute(isAuthenticated, role, "employee", <Redirect to="/employee/timesheet" />)}
        </Route>
        <Route path="/employee/timesheet">
          {renderRoleRoute(isAuthenticated, role, "employee", <EmployeeTimesheetPage />)}
        </Route>
        <Route path="/employee/task-manager">
          {renderRoleRoute(isAuthenticated, role, "employee", <EmployeeTaskManagerPage />)}
        </Route>
        <Route path="/employee/leaves">
          {renderRoleRoute(isAuthenticated, role, "employee", <EmployeeLeavesPage />)}
        </Route>
        <Route path="/employee/expenses">
          {renderRoleRoute(isAuthenticated, role, "employee", <EmployeeExpensesPage />)}
        </Route>
        <Route path="/employee/salary-slips">
          {renderRoleRoute(isAuthenticated, role, "employee", <EmployeeSalarySlipsPage />)}
        </Route>
        <Route path="/employee/profile">
          {renderRoleRoute(isAuthenticated, role, "employee", <EmployeeProfilePage />)}
        </Route>
        <Route path="/client/dashboard">
          {renderRoleRoute(isAuthenticated, role, "client", <Redirect to="/client/pre-approvals" />)}
        </Route>
        <Route path="/client/pre-approvals">
          {renderRoleRoute(isAuthenticated, role, "client", <ClientPreApprovalsPage />)}
        </Route>
        <Route path="/platform/dashboard">
          {renderRoleRoute(isAuthenticated, role, "platform_super_admin", <PlatformDashboardPage />)}
        </Route>
        <Route path="/platform/tenants">
          {renderRoleRoute(isAuthenticated, role, "platform_super_admin", <PlatformTenantsPage />)}
        </Route>
        <Route path="/platform/monitoring">
          {renderRoleRoute(isAuthenticated, role, "platform_super_admin", <PlatformMonitoringPage />)}
        </Route>
        <Route path="/platform/recovery">
          {renderRoleRoute(isAuthenticated, role, "platform_super_admin", <PlatformRecoveryPage />)}
        </Route>
        <Route path="/platform/settings">
          {renderRoleRoute(isAuthenticated, role, "platform_super_admin", <PlatformSettingsPage />)}
        </Route>
        <Route>
          {isAuthenticated ? <NotFoundPage /> : <Redirect to="/login" />}
        </Route>
      </Switch>
    </WouterRouter>
  );
}

export default function App() {
  return (
    <AppProviders>
      <LegacyRouter />
    </AppProviders>
  );
}
