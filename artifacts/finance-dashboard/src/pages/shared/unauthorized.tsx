import { Link } from "wouter";
import { Button } from "@/components/ui/button";
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

export default function UnauthorizedPage() {
  const role = useAuthStore((state) => state.role);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-xl rounded-[2rem] border border-white/8 bg-white/[0.03] p-10 text-center">
        <p className="text-xs uppercase tracking-[0.24em] text-[#c6ac73]">Access control</p>
        <h1 className="mt-4 font-serif text-4xl font-semibold text-foreground">This route is outside your role scope</h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          YOJAK keeps admin and employee surfaces strictly separated. Move back to the correct workspace for your account.
        </p>
        <div className="mt-6">
          <Link href={workspacePath(role)}>
            <Button>Go to my workspace</Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
