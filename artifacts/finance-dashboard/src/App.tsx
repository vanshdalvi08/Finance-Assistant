import { Redirect, Route, Switch, Router as WouterRouter } from "wouter";
import { AppProviders } from "@/app/providers";
import { useAuthStore } from "@/store/auth";
import LoginPage from "@/pages/login";
import ResetPasswordPage from "@/pages/auth/reset-password";
import DashboardPage from "@/pages/dashboard";
import TransactionsPage from "@/pages/transactions";
import EmployeesPage from "@/pages/employees";
import SalaryPage from "@/pages/salary";
import FundsPage from "@/pages/funds";
import PurchaseOrdersPage from "@/pages/purchase-orders";
import ProjectBudgetsPage from "@/pages/project-budgets";
import ExpensesPage from "@/pages/expenses";
import SettingsPage from "@/pages/settings";
import AdminTimesheetValidationPage from "@/pages/admin/timesheet-validation";
import AdminLeaveManagementPage from "@/pages/admin/leave-management";
import AdminReportsPage from "@/pages/admin/reports";
import AdminAuditTrailPage from "@/pages/admin/audit-trail";
import EmployeeTimesheetPage from "@/pages/employee/timesheet";
import EmployeeLeavesPage from "@/pages/employee/leaves";
import EmployeeExpensesPage from "@/pages/employee/expenses";
import EmployeeSalarySlipsPage from "@/pages/employee/salary-slips";
import EmployeeProfilePage from "@/pages/employee/profile";
import NotFoundPage from "@/pages/not-found";
import type { UserRole } from "@/auth/types";

function FullScreenLoader() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background text-sm text-muted-foreground">
      Booting your workspace...
    </div>
  );
}

function redirectForSession(isAuthenticated: boolean, role: UserRole | null) {
  if (!isAuthenticated) {
    return <Redirect to="/login" />;
  }

  return <Redirect to={role === "employee" ? "/employee/timesheet" : "/"} />;
}

function renderAdminRoute(
  isAuthenticated: boolean,
  role: UserRole | null,
  element: React.ReactNode,
) {
  return isAuthenticated && role === "admin" ? element : redirectForSession(isAuthenticated, role);
}

function renderEmployeeRoute(
  isAuthenticated: boolean,
  role: UserRole | null,
  element: React.ReactNode,
) {
  return isAuthenticated && role === "employee" ? element : redirectForSession(isAuthenticated, role);
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
          {renderAdminRoute(isAuthenticated, role, <DashboardPage />)}
        </Route>
        <Route path="/transactions">
          {renderAdminRoute(isAuthenticated, role, <TransactionsPage />)}
        </Route>
        <Route path="/employees">
          {renderAdminRoute(isAuthenticated, role, <EmployeesPage />)}
        </Route>
        <Route path="/salary">
          {renderAdminRoute(isAuthenticated, role, <SalaryPage />)}
        </Route>
        <Route path="/funds">
          {renderAdminRoute(isAuthenticated, role, <FundsPage />)}
        </Route>
        <Route path="/purchase-orders">
          {renderAdminRoute(isAuthenticated, role, <PurchaseOrdersPage />)}
        </Route>
        <Route path="/project-budgets">
          {renderAdminRoute(isAuthenticated, role, <ProjectBudgetsPage />)}
        </Route>
        <Route path="/expenses">
          {renderAdminRoute(isAuthenticated, role, <ExpensesPage />)}
        </Route>
        <Route path="/settings">
          {renderAdminRoute(isAuthenticated, role, <SettingsPage />)}
        </Route>
        <Route path="/timesheets">
          {renderAdminRoute(isAuthenticated, role, <AdminTimesheetValidationPage />)}
        </Route>
        <Route path="/leave-management">
          {renderAdminRoute(isAuthenticated, role, <AdminLeaveManagementPage />)}
        </Route>
        <Route path="/reports">
          {renderAdminRoute(isAuthenticated, role, <AdminReportsPage />)}
        </Route>
        <Route path="/audit-trail">
          {renderAdminRoute(isAuthenticated, role, <AdminAuditTrailPage />)}
        </Route>
        <Route path="/admin/dashboard">{renderAdminRoute(isAuthenticated, role, <Redirect to="/" />)}</Route>
        <Route path="/admin/transactions">{renderAdminRoute(isAuthenticated, role, <Redirect to="/transactions" />)}</Route>
        <Route path="/admin/employees">{renderAdminRoute(isAuthenticated, role, <Redirect to="/employees" />)}</Route>
        <Route path="/admin/salary">{renderAdminRoute(isAuthenticated, role, <Redirect to="/salary" />)}</Route>
        <Route path="/admin/funds">{renderAdminRoute(isAuthenticated, role, <Redirect to="/funds" />)}</Route>
        <Route path="/admin/purchase-orders">{renderAdminRoute(isAuthenticated, role, <Redirect to="/purchase-orders" />)}</Route>
        <Route path="/admin/project-budgets">{renderAdminRoute(isAuthenticated, role, <Redirect to="/project-budgets" />)}</Route>
        <Route path="/admin/expenses">{renderAdminRoute(isAuthenticated, role, <Redirect to="/expenses" />)}</Route>
        <Route path="/admin/settings">{renderAdminRoute(isAuthenticated, role, <Redirect to="/settings" />)}</Route>
        <Route path="/admin/timesheets">{renderAdminRoute(isAuthenticated, role, <Redirect to="/timesheets" />)}</Route>
        <Route path="/admin/leave-management">{renderAdminRoute(isAuthenticated, role, <Redirect to="/leave-management" />)}</Route>
        <Route path="/admin/reports">{renderAdminRoute(isAuthenticated, role, <Redirect to="/reports" />)}</Route>
        <Route path="/admin/audit-trail">{renderAdminRoute(isAuthenticated, role, <Redirect to="/audit-trail" />)}</Route>
        <Route path="/employee/dashboard">
          {renderEmployeeRoute(isAuthenticated, role, <Redirect to="/employee/timesheet" />)}
        </Route>
        <Route path="/employee/timesheet">
          {renderEmployeeRoute(isAuthenticated, role, <EmployeeTimesheetPage />)}
        </Route>
        <Route path="/employee/leaves">
          {renderEmployeeRoute(isAuthenticated, role, <EmployeeLeavesPage />)}
        </Route>
        <Route path="/employee/expenses">
          {renderEmployeeRoute(isAuthenticated, role, <EmployeeExpensesPage />)}
        </Route>
        <Route path="/employee/salary-slips">
          {renderEmployeeRoute(isAuthenticated, role, <EmployeeSalarySlipsPage />)}
        </Route>
        <Route path="/employee/profile">
          {renderEmployeeRoute(isAuthenticated, role, <EmployeeProfilePage />)}
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
