import { Redirect } from "wouter";
import { routes } from "@/app/route-map";
import { useAuthStore } from "@/store/auth";

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const hydrated = useAuthStore((state) => state.hydrated);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);

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

  return <>{children}</>;
}
