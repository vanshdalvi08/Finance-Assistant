import type { ComponentType } from "react";
import { Link, useLocation } from "wouter";
import { Activity, Building2, LifeBuoy, LayoutDashboard, LogOut, Radar, Settings2, Shield } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/store/auth";
import { useToast } from "@/hooks/use-toast";
import { EmployeeAvatar } from "@/components/employee-avatar";

type NavItem = {
  href: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  description: string;
};

const items: NavItem[] = [
  { href: "/platform/dashboard", label: "Overview", icon: LayoutDashboard, description: "Health and scale" },
  { href: "/platform/tenants", label: "Tenants", icon: Building2, description: "Companies and owners" },
  { href: "/platform/monitoring", label: "Monitoring", icon: Radar, description: "Errors and slow routes" },
  { href: "/platform/recovery", label: "Recovery", icon: LifeBuoy, description: "Support and rollback" },
  { href: "/platform/settings", label: "Settings", icon: Settings2, description: "Console defaults" },
];

function isRouteActive(current: string, href: string) {
  return current === href || current.startsWith(`${href}/`);
}

export function PlatformSidebar() {
  const [location, setLocation] = useLocation();
  const { user, userEmail, logout } = useAuthStore();
  const { toast } = useToast();

  async function handleLogout() {
    await logout();
    toast({ title: "Signed out", description: "Platform session ended." });
    setLocation("/login");
  }

  return (
    <aside className="sticky top-0 flex h-screen w-72 flex-col border-r border-white/8 bg-[linear-gradient(180deg,rgba(8,10,18,0.98),rgba(10,13,22,0.96))]">
      <div className="border-b border-white/8 px-6 py-5">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-cyan-400/20 bg-cyan-400/10 text-cyan-300 shadow-[0_18px_45px_rgba(0,0,0,0.25)]">
            <Shield className="h-5 w-5" />
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-[0.24em] text-cyan-300/80">Platform Console</p>
            <h2 className="font-serif text-lg font-semibold tracking-tight text-foreground">Super Admin</h2>
          </div>
        </div>
      </div>

      <nav className="flex-1 space-y-2 px-4 py-5">
        {items.map((item) => {
          const active = isRouteActive(location, item.href);
          return (
            <Link key={item.href} href={item.href}>
              <div
                className={cn(
                  "group flex cursor-pointer items-center gap-3 rounded-2xl border px-4 py-3 transition-all",
                  active
                    ? "border-cyan-400/20 bg-cyan-400/10 text-cyan-100 shadow-[0_10px_30px_rgba(34,211,238,0.08)]"
                    : "border-transparent bg-white/[0.02] text-muted-foreground hover:border-white/8 hover:bg-white/[0.04] hover:text-foreground",
                )}
              >
                <item.icon className={cn("h-4 w-4 shrink-0", active ? "text-cyan-300" : "text-muted-foreground")} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="block truncate text-sm font-medium">{item.label}</span>
                    {active ? <span className="h-2 w-2 rounded-full bg-cyan-300" /> : null}
                  </div>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">{item.description}</p>
                </div>
              </div>
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-white/8 px-4 py-4">
        <div className="rounded-3xl border border-white/8 bg-white/[0.03] p-4">
          <div className="flex items-center gap-3">
            <EmployeeAvatar
              name={user?.name ?? userEmail ?? "Platform"}
              src={user?.profilePhotoUrl}
              className="h-10 w-10 border-cyan-400/20"
              fallbackClassName="bg-cyan-400/10 text-cyan-200"
            />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-foreground">{user?.name ?? "Platform Super Admin"}</p>
              <p className="truncate text-xs text-muted-foreground">{userEmail}</p>
            </div>
            <button
              onClick={() => void handleLogout()}
              title="Sign out"
              className="rounded-xl border border-white/8 bg-black/20 p-2 text-muted-foreground transition hover:border-cyan-400/20 hover:text-cyan-200"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    </aside>
  );
}
