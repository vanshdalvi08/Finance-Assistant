import { Redirect } from "wouter";
import { routes } from "@/app/route-map";
import { useAuthStore } from "@/store/auth";
import type { UserRole } from "@/auth/types";

function workspacePath(role: UserRole | null) {
  switch (role) {
    case "employee":
      return routes.employeeTimesheet;
    case "client":
      return routes.clientPreApprovals;
    case "platform_super_admin":
      return routes.platformDashboard;
    default:
      return routes.adminDashboard;
  }
}

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

  return <Redirect to={workspacePath(role)} />;
}
