import { Redirect } from "wouter";
import { routes } from "@/app/route-map";
import { useAuthStore } from "@/store/auth";
import type { UserRole } from "@/auth/types";

export function RoleGuard({
  allow,
  children,
}: {
  allow: UserRole[];
  children: React.ReactNode;
}) {
  const role = useAuthStore((state) => state.role);

  if (!role || !allow.includes(role)) {
    return <Redirect to={routes.unauthorized} />;
  }

  return <>{children}</>;
}
