import { useEffect } from "react";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { ThemeProvider } from "@/components/theme-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/toaster";
import { useAuthStore } from "@/store/auth";
import { listEmployeeAccounts } from "@/auth/auth-service";
import { api } from "@/lib/api";

const queryClient = new QueryClient();

function AuthBootstrap({ children }: { children: React.ReactNode }) {
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

export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider defaultTheme="dark">
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <AuthBootstrap>{children}</AuthBootstrap>
          <AuthDataBootstrap />
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
