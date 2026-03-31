import { Switch, Route, Router as WouterRouter, Redirect } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/theme-provider";
import { useAuthStore } from "@/store/auth";
import NotFound from "@/pages/not-found";

import Login from "@/pages/login";
import Dashboard from "@/pages/dashboard";
import Employees from "@/pages/employees";
import Salary from "@/pages/salary";
import Funds from "@/pages/funds";
import Expenses from "@/pages/expenses";
import Transactions from "@/pages/transactions";

const queryClient = new QueryClient();

function Router() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  return (
    <Switch>
      <Route path="/login">
        {isAuthenticated ? <Redirect to="/" /> : <Login />}
      </Route>
      <Route path="/">
        {isAuthenticated ? <Dashboard /> : <Redirect to="/login" />}
      </Route>
      <Route path="/employees">
        {isAuthenticated ? <Employees /> : <Redirect to="/login" />}
      </Route>
      <Route path="/salary">
        {isAuthenticated ? <Salary /> : <Redirect to="/login" />}
      </Route>
      <Route path="/funds">
        {isAuthenticated ? <Funds /> : <Redirect to="/login" />}
      </Route>
      <Route path="/expenses">
        {isAuthenticated ? <Expenses /> : <Redirect to="/login" />}
      </Route>
      <Route path="/transactions">
        {isAuthenticated ? <Transactions /> : <Redirect to="/login" />}
      </Route>
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <ThemeProvider defaultTheme="dark">
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <WouterRouter base={import.meta.env.BASE_URL?.replace(/\/$/, "") || ""}>
            <Router />
          </WouterRouter>
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}

export default App;
