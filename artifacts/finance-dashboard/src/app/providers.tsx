import { Component, useEffect, type ErrorInfo, type ReactNode } from "react";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { ThemeProvider } from "@/components/theme-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/toaster";
import { useAuthStore } from "@/store/auth";
import { listEmployeeAccounts } from "@/auth/auth-service";
import { api } from "@/lib/api";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: false,
      refetchOnReconnect: true,
      retry: 1,
    },
    mutations: {
      retry: 0,
    },
  },
});

class AppErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Application render failed", error, info);
  }

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-6">
        <div className="w-full max-w-md rounded-2xl border border-border/70 bg-card p-8 text-center shadow-sm">
          <p className="text-lg font-semibold text-foreground">This page could not finish loading</p>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Your saved data is safe. Reload the workspace to restore the connection.
          </p>
          <button
            type="button"
            className="mt-6 inline-flex h-10 items-center justify-center rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90"
            onClick={() => window.location.reload()}
          >
            Reload workspace
          </button>
        </div>
      </div>
    );
  }
}

function AuthBootstrap({ children }: { children: ReactNode }) {
  const hydrateFromStorage = useAuthStore((state) => state.hydrateFromStorage);

  useEffect(() => {
    void hydrateFromStorage();
  }, [hydrateFromStorage]);

  return <>{children}</>;
}

function AuthDataBootstrap() {
  const queryClient = useQueryClient();
  const hydrated = useAuthStore((state) => state.hydrated);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const role = useAuthStore((state) => state.role);
  const user = useAuthStore((state) => state.user);

  useEffect(() => {
    if (!hydrated || !isAuthenticated || !user) {
      return;
    }

    const currentUser = user;
    let active = true;

    async function syncSessionData() {
      try {
        if (role === "admin") {
          const result = await listEmployeeAccounts();
          if (!active) {
            return;
          }

          await api.syncEmployeeAccounts(result.employees);
          await queryClient.invalidateQueries({ queryKey: ["employees"] });
          await queryClient.invalidateQueries({ queryKey: ["adminOverview"] });
          return;
        }

        await api.ensureEmployeeProfile({
          id: currentUser.id,
          email: currentUser.email,
          name: currentUser.name ?? currentUser.email.split("@")[0],
          profilePhotoUrl: currentUser.profilePhotoUrl ?? undefined,
          role: currentUser.position,
          department: currentUser.department,
        });
        await queryClient.invalidateQueries({ queryKey: ["employee-profile", currentUser.id, currentUser.email] });
      } catch {
        return;
      }
    }

    void syncSessionData();

    return () => {
      active = false;
    };
  }, [
    hydrated,
    isAuthenticated,
    role,
    user?.id,
    user?.email,
    user?.name,
    user?.profilePhotoUrl,
    user?.position,
    user?.department,
    queryClient,
  ]);

  return null;
}

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider defaultTheme="dark">
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <AppErrorBoundary>
            <AuthBootstrap>{children}</AuthBootstrap>
          </AppErrorBoundary>
          <AuthDataBootstrap />
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
