import { Redirect, Route, Switch, Router as WouterRouter } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { routes } from "@/app/route-map";
import { AuthGuard } from "@/guards/auth-guard";
import { GuestGuard } from "@/guards/guest-guard";
import { RoleGuard } from "@/guards/role-guard";
import { AdminShell } from "@/layouts/admin-shell";
import { AuthShell } from "@/layouts/auth-shell";
import { EmployeeShell } from "@/layouts/employee-shell";
import { useAuthStore } from "@/store/auth";
import LoginPage from "@/pages/auth/login";
import ResetPasswordPage from "@/pages/auth/reset-password";
import NotFoundPage from "@/pages/shared/not-found";
import UnauthorizedPage from "@/pages/shared/unauthorized";
import AdminDashboardPage from "@/pages/admin/dashboard";
import AdminEmployeesPage from "@/pages/admin/employees";
import AdminSalaryPage from "@/pages/admin/salary";
import AdminFundsPage from "@/pages/admin/funds";
import ClientsPage from "@/pages/clients";
import ProjectBudgetsPage from "@/pages/project-budgets";
import PurchaseOrdersPage from "@/pages/purchase-orders";
import PreApprovalsPage from "@/pages/pre-approvals";
import AdminExpensesPage from "@/pages/admin/expenses";
import AdminTransactionsPage from "@/pages/admin/transactions";
import AdminTimesheetValidationPage from "@/pages/admin/timesheet-validation";
import AdminLeaveManagementPage from "@/pages/admin/leave-management";
import AdminReportsPage from "@/pages/admin/reports";
import AdminAuditTrailPage from "@/pages/admin/audit-trail";
import PlatformDashboardPage from "@/pages/platform/dashboard";
import PlatformTenantsPage from "@/pages/platform/tenants";
import PlatformMonitoringPage from "@/pages/platform/monitoring";
import PlatformRecoveryPage from "@/pages/platform/recovery";
import PlatformSettingsPage from "@/pages/platform/settings";
import EmployeeTimesheetPage from "@/pages/employee/timesheet";
import EmployeeTaskManagerPage from "@/pages/employee/task-manager";
import EmployeeLeavesPage from "@/pages/employee/leaves";
import EmployeeExpensesPage from "@/pages/employee/expenses";
import EmployeeSalarySlipsPage from "@/pages/employee/salary-slips";
import EmployeeProfilePage from "@/pages/employee/profile";
import ClientPreApprovalsPage from "@/pages/client/pre-approvals";

function RootRedirect() {
  const hydrated = useAuthStore((state) => state.hydrated);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const role = useAuthStore((state) => state.role);

  if (!hydrated) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-sm text-muted-foreground">
        Booting your workspace...
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Redirect to={routes.login} />;
  }

  if (role === "admin") {
    return <Redirect to={routes.adminDashboard} />;
  }

  if (role === "client") {
    return <Redirect to={routes.clientPreApprovals} />;
  }

  if (role === "platform_super_admin") {
    return <Redirect to={routes.platformDashboard} />;
  }

  return <Redirect to={routes.employeeTimesheet} />;
}

function AdminRoutes() {
  return (
    <Switch>
      <Route path={routes.adminDashboard}><AdminDashboardPage /></Route>
      <Route path={routes.adminEmployees}><AdminEmployeesPage /></Route>
      <Route path={routes.adminSalary}><AdminSalaryPage /></Route>
      <Route path={routes.adminFunds}><AdminFundsPage /></Route>
      <Route path={routes.adminClients}><ClientsPage /></Route>
      <Route path={routes.adminProjectBudgets}><ProjectBudgetsPage /></Route>
      <Route path={routes.adminPurchaseOrders}><PurchaseOrdersPage /></Route>
      <Route path={routes.adminPreApprovals}><PreApprovalsPage /></Route>
      <Route path={routes.adminExpenses}><AdminExpensesPage /></Route>
      <Route path={routes.adminTransactions}><AdminTransactionsPage /></Route>
      <Route path={routes.adminTimesheetValidation}><AdminTimesheetValidationPage /></Route>
      <Route path={routes.adminLeaveManagement}><AdminLeaveManagementPage /></Route>
      <Route path={routes.adminReports}><AdminReportsPage /></Route>
      <Route path={routes.adminAuditTrail}><AdminAuditTrailPage /></Route>
      <Route><Redirect to={routes.adminDashboard} /></Route>
    </Switch>
  );
}

function EmployeeRoutes() {
  return (
    <Switch>
      <Route path={routes.employeeTimesheet}><EmployeeTimesheetPage /></Route>
      <Route path={routes.employeeTaskManager}><EmployeeTaskManagerPage /></Route>
      <Route path={routes.employeeLeaves}><EmployeeLeavesPage /></Route>
      <Route path={routes.employeeExpenses}><EmployeeExpensesPage /></Route>
      <Route path={routes.employeeSalarySlips}><EmployeeSalarySlipsPage /></Route>
      <Route path={routes.employeeProfile}><EmployeeProfilePage /></Route>
      <Route><Redirect to={routes.employeeTimesheet} /></Route>
    </Switch>
  );
}

function ClientRoutes() {
  return (
    <Switch>
      <Route path={routes.clientPreApprovals}><ClientPreApprovalsPage /></Route>
      <Route><Redirect to={routes.clientPreApprovals} /></Route>
    </Switch>
  );
}

function PlatformRoutes() {
  return (
    <Switch>
      <Route path={routes.platformDashboard}><PlatformDashboardPage /></Route>
      <Route path={routes.platformTenants}><PlatformTenantsPage /></Route>
      <Route path={routes.platformMonitoring}><PlatformMonitoringPage /></Route>
      <Route path={routes.platformRecovery}><PlatformRecoveryPage /></Route>
      <Route path={routes.platformSettings}><PlatformSettingsPage /></Route>
      <Route><Redirect to={routes.platformDashboard} /></Route>
    </Switch>
  );
}

export function AppRouter() {
  return (
    <WouterRouter hook={useHashLocation}>
      <Switch>
        <Route path={routes.login}>
          <GuestGuard>
            <AuthShell>
              <LoginPage />
            </AuthShell>
          </GuestGuard>
        </Route>
        <Route path={routes.resetPassword}>
          <GuestGuard>
            <AuthShell>
              <ResetPasswordPage />
            </AuthShell>
          </GuestGuard>
        </Route>
        <Route path="/admin/:rest*">
          <AuthGuard>
            <RoleGuard allow={["admin"]}>
              <AdminShell>
                <AdminRoutes />
              </AdminShell>
            </RoleGuard>
          </AuthGuard>
        </Route>
        <Route path="/employee/:rest*">
          <AuthGuard>
            <RoleGuard allow={["employee"]}>
              <EmployeeShell>
                <EmployeeRoutes />
              </EmployeeShell>
            </RoleGuard>
          </AuthGuard>
        </Route>
        <Route path="/client/:rest*">
          <AuthGuard>
            <RoleGuard allow={["client"]}>
              <ClientRoutes />
            </RoleGuard>
          </AuthGuard>
        </Route>
        <Route path="/platform/:rest*">
          <AuthGuard>
            <RoleGuard allow={["platform_super_admin"]}>
              <PlatformRoutes />
            </RoleGuard>
          </AuthGuard>
        </Route>
        <Route path={routes.unauthorized}><UnauthorizedPage /></Route>
        <Route path="/"><RootRedirect /></Route>
        <Route><NotFoundPage /></Route>
      </Switch>
    </WouterRouter>
  );
}
