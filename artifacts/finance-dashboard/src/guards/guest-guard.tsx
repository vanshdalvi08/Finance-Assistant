import { Redirect } from "wouter";
import { routes } from "@/app/route-map";
import { useAuthStore } from "@/store/auth";

export function GuestGuard({ children }: { children: React.ReactNode }) {
  const hydrated = useAuthStore((state) => state.hydrated);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const role = useAuthStore((state) => state.role);

  if (!hydrated) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-sm text-muted-foreground">
        Checking your session...
      </div>
    );
  }

  if (!isAuthenticated) {
    return <>{children}</>;
  }

  return <Redirect to={role === "admin" ? routes.adminDashboard : routes.employeeTimesheet} />;
}
