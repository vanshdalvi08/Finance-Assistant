import { Link, useLocation } from "wouter";
import { AppLogo } from "@/components/app/app-logo";
import { useAuthStore } from "@/store/auth";
import { Building2, LifeBuoy, LogOut, Radar, Settings2, Shield } from "lucide-react";
import { cn } from "@/lib/utils";

const sections = [
  {
    label: "Overview",
    items: [{ href: "/platform/dashboard", label: "Dashboard", icon: Shield }],
  },
  {
    label: "Platform",
    items: [
      { href: "/platform/tenants", label: "Tenants", icon: Building2 },
      { href: "/platform/monitoring", label: "Monitoring", icon: Radar },
      { href: "/platform/recovery", label: "Recovery", icon: LifeBuoy },
      { href: "/platform/settings", label: "Settings", icon: Settings2 },
    ],
  },
];

function isRouteActive(current: string, href: string) {
  return current === href || current.startsWith(`${href}/`);
}

export function PlatformSidebar() {
  const [location, setLocation] = useLocation();
  const logout = useAuthStore((state) => state.logout);
  const user = useAuthStore((state) => state.user);

  return (
    <aside className="hidden w-[260px] shrink-0 border-r border-border/60 bg-sidebar px-4 py-5 text-sidebar-foreground lg:flex lg:flex-col">
      <AppLogo />
      <div className="mt-6 space-y-7">
        {sections.map((section) => (
          <div key={section.label} className="space-y-3">
            <p className="px-2 text-[11px] font-medium uppercase tracking-[0.18em] text-sidebar-foreground/55">{section.label}</p>
            <div className="space-y-1">
              {section.items.map((item) => {
                const active = isRouteActive(location, item.href);
                return (
                  <Link key={item.href} href={item.href}>
                    <div
                      className={cn(
                        "flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-2.5 text-sm transition",
                        active
                          ? "border-sidebar-primary/25 bg-sidebar-accent text-sidebar-accent-foreground"
                          : "border-transparent text-sidebar-foreground/72 hover:border-sidebar-border hover:bg-sidebar-accent/50 hover:text-sidebar-foreground",
                      )}
                    >
                      <item.icon className={cn("h-4 w-4", active ? "text-sidebar-primary" : "text-sidebar-foreground/55")} />
                      <span>{item.label}</span>
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-auto space-y-4 rounded-2xl border border-border/60 bg-card p-4 text-card-foreground shadow-sm">
        <div>
          <p className="text-sm font-medium text-foreground">{user?.name ?? "Platform Super Admin"}</p>
          <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Super admin</p>
        </div>
        <button
          onClick={() => {
            void logout().finally(() => setLocation("/login"));
          }}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-border/60 bg-background px-3 py-2 text-sm text-muted-foreground transition hover:bg-muted/50 hover:text-foreground"
        >
          <LogOut className="h-4 w-4" />
          Sign out
        </button>
      </div>
    </aside>
  );
}
