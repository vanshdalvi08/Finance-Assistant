import { Link, useLocation } from "wouter";
import { PlatformSidebar } from "@/components/navigation/platform-sidebar";
import { useAuthStore } from "@/store/auth";

const PLATFORM_NAV = [
  { href: "/platform/dashboard", label: "Overview" },
  { href: "/platform/tenants", label: "Tenants" },
  { href: "/platform/monitoring", label: "Monitoring" },
  { href: "/platform/recovery", label: "Recovery" },
  { href: "/platform/settings", label: "Settings" },
];

export function PlatformShell({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const user = useAuthStore((state) => state.user);

  return (
    <div className="min-h-screen bg-background text-foreground lg:flex">
      <PlatformSidebar />
      <main className="flex-1">
        <div className="border-b border-white/8 bg-black/20">
          <div className="mx-auto flex max-w-7xl flex-col gap-4 px-6 py-4 lg:px-8 xl:flex-row xl:items-center xl:justify-between">
            <div>
              <p className="text-[11px] uppercase tracking-[0.24em] text-cyan-200/75">Platform environment</p>
              <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
                <span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1 text-emerald-200">
                  Live control plane
                </span>
                <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-muted-foreground">
                  Role: {user?.role ?? "platform_super_admin"}
                </span>
                <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-muted-foreground">
                  Operator: {user?.email ?? "platform@yojak.in"}
                </span>
              </div>
            </div>

            <nav className="flex flex-wrap gap-2">
              {PLATFORM_NAV.map((item) => {
                const active = location === item.href;
                return (
                  <Link key={item.href} href={item.href}>
                    <span
                      className={`inline-flex rounded-full border px-3 py-1.5 text-sm transition ${
                        active
                          ? "border-cyan-400/25 bg-cyan-400/10 text-cyan-100"
                          : "border-white/10 bg-white/[0.03] text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {item.label}
                    </span>
                  </Link>
                );
              })}
            </nav>
          </div>
        </div>
        <div className="mx-auto max-w-7xl px-6 py-8 lg:px-8">{children}</div>
      </main>
    </div>
  );
}
