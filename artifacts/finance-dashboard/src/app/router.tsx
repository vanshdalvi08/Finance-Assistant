import { Redirect, Route, Switch, Router as WouterRouter } from "wouter";
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
import AdminExpensesPage from "@/pages/admin/expenses";
import AdminTransactionsPage from "@/pages/admin/transactions";
import AdminTimesheetValidationPage from "@/pages/admin/timesheet-validation";
import AdminReportsPage from "@/pages/admin/reports";
import EmployeeTimesheetPage from "@/pages/employee/timesheet";
import EmployeeSalarySlipsPage from "@/pages/employee/salary-slips";
import EmployeeProfilePage from "@/pages/employee/profile";

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

  return <Redirect to={role === "admin" ? routes.adminDashboard : routes.employeeTimesheet} />;
}

function AdminRoutes() {
  return (
    <Switch>
      <Route path={routes.adminDashboard}><AdminDashboardPage /></Route>
      <Route path={routes.adminEmployees}><AdminEmployeesPage /></Route>
      <Route path={routes.adminSalary}><AdminSalaryPage /></Route>
      <Route path={routes.adminFunds}><AdminFundsPage /></Route>
      <Route path={routes.adminExpenses}><AdminExpensesPage /></Route>
      <Route path={routes.adminTransactions}><AdminTransactionsPage /></Route>
      <Route path={routes.adminTimesheetValidation}><AdminTimesheetValidationPage /></Route>
      <Route path={routes.adminReports}><AdminReportsPage /></Route>
      <Route><Redirect to={routes.adminDashboard} /></Route>
    </Switch>
  );
}

function EmployeeRoutes() {
  return (
    <Switch>
      <Route path={routes.employeeTimesheet}><EmployeeTimesheetPage /></Route>
      <Route path={routes.employeeSalarySlips}><EmployeeSalarySlipsPage /></Route>
      <Route path={routes.employeeProfile}><EmployeeProfilePage /></Route>
      <Route><Redirect to={routes.employeeTimesheet} /></Route>
    </Switch>
  );
}

export function AppRouter() {
  return (
    <WouterRouter base={import.meta.env.BASE_URL?.replace(/\/$/, "") || ""}>
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
        <Route path={routes.unauthorized}><UnauthorizedPage /></Route>
        <Route path="/"><RootRedirect /></Route>
        <Route><NotFoundPage /></Route>
      </Switch>
    </WouterRouter>
  );
}
