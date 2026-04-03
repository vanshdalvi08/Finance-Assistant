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
import ExpensesPage from "@/pages/expenses";
import SettingsPage from "@/pages/settings";
import AdminTimesheetValidationPage from "@/pages/admin/timesheet-validation";
import AdminReportsPage from "@/pages/admin/reports";
import EmployeeTimesheetPage from "@/pages/employee/timesheet";
import EmployeeExpensesPage from "@/pages/employee/expenses";
import EmployeeSalarySlipsPage from "@/pages/employee/salary-slips";
import EmployeeProfilePage from "@/pages/employee/profile";
import NotFoundPage from "@/pages/not-found";

function FullScreenLoader() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background text-sm text-muted-foreground">
      Booting your workspace...
    </div>
  );
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
          {isAuthenticated ? <Redirect to={role === "employee" ? "/employee/timesheet" : "/"} /> : <LoginPage />}
        </Route>
        <Route path="/reset">
          {isAuthenticated ? <Redirect to={role === "employee" ? "/employee/timesheet" : "/"} /> : <ResetPasswordPage />}
        </Route>
        <Route path="/">
          {!isAuthenticated ? <Redirect to="/login" /> : role === "employee" ? <Redirect to="/employee/timesheet" /> : <DashboardPage />}
        </Route>
        <Route path="/transactions">
          {isAuthenticated && role === "admin" ? <TransactionsPage /> : <Redirect to={isAuthenticated ? "/" : "/login"} />}
        </Route>
        <Route path="/employees">
          {isAuthenticated && role === "admin" ? <EmployeesPage /> : <Redirect to={isAuthenticated ? "/" : "/login"} />}
        </Route>
        <Route path="/salary">
          {isAuthenticated && role === "admin" ? <SalaryPage /> : <Redirect to={isAuthenticated ? "/" : "/login"} />}
        </Route>
        <Route path="/funds">
          {isAuthenticated && role === "admin" ? <FundsPage /> : <Redirect to={isAuthenticated ? "/" : "/login"} />}
        </Route>
        <Route path="/expenses">
          {isAuthenticated && role === "admin" ? <ExpensesPage /> : <Redirect to={isAuthenticated ? "/" : "/login"} />}
        </Route>
        <Route path="/settings">
          {isAuthenticated && role === "admin" ? <SettingsPage /> : <Redirect to={isAuthenticated ? "/" : "/login"} />}
        </Route>
        <Route path="/timesheets">
          {isAuthenticated && role === "admin" ? <AdminTimesheetValidationPage /> : <Redirect to={isAuthenticated ? "/" : "/login"} />}
        </Route>
        <Route path="/reports">
          {isAuthenticated && role === "admin" ? <AdminReportsPage /> : <Redirect to={isAuthenticated ? "/" : "/login"} />}
        </Route>
        <Route path="/admin/dashboard"><Redirect to="/" /></Route>
        <Route path="/admin/transactions"><Redirect to="/transactions" /></Route>
        <Route path="/admin/employees"><Redirect to="/employees" /></Route>
        <Route path="/admin/salary"><Redirect to="/salary" /></Route>
        <Route path="/admin/funds"><Redirect to="/funds" /></Route>
        <Route path="/admin/expenses"><Redirect to="/expenses" /></Route>
        <Route path="/admin/settings"><Redirect to="/settings" /></Route>
        <Route path="/admin/timesheets"><Redirect to="/timesheets" /></Route>
        <Route path="/admin/reports"><Redirect to="/reports" /></Route>
        <Route path="/employee/dashboard">
          {isAuthenticated && role === "employee" ? <Redirect to="/employee/timesheet" /> : <Redirect to={isAuthenticated ? "/" : "/login"} />}
        </Route>
        <Route path="/employee/timesheet">
          {isAuthenticated && role === "employee" ? <EmployeeTimesheetPage /> : <Redirect to={isAuthenticated ? "/" : "/login"} />}
        </Route>
        <Route path="/employee/expenses">
          {isAuthenticated && role === "employee" ? <EmployeeExpensesPage /> : <Redirect to={isAuthenticated ? "/" : "/login"} />}
        </Route>
        <Route path="/employee/salary-slips">
          {isAuthenticated && role === "employee" ? <EmployeeSalarySlipsPage /> : <Redirect to={isAuthenticated ? "/" : "/login"} />}
        </Route>
        <Route path="/employee/profile">
          {isAuthenticated && role === "employee" ? <EmployeeProfilePage /> : <Redirect to={isAuthenticated ? "/" : "/login"} />}
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
