import { Link, useLocation } from "wouter";
import { routes } from "@/app/route-map";
import { AppLogo } from "@/components/app/app-logo";
import { useAuthStore } from "@/store/auth";
import { BriefcaseBusiness, CreditCard, FileBarChart2, Landmark, LayoutDashboard, LogOut, Receipt, ShieldCheck, Users } from "lucide-react";
import { cn } from "@/lib/utils";

const sections = [
  {
    label: "Overview",
    items: [{ href: routes.adminDashboard, label: "Dashboard", icon: LayoutDashboard }],
  },
  {
    label: "Operations",
    items: [
      { href: routes.adminTimesheetValidation, label: "Timesheet Validation", icon: ShieldCheck },
      { href: routes.adminExpenses, label: "Expenses", icon: Receipt },
      { href: routes.adminTransactions, label: "Transactions", icon: BriefcaseBusiness },
    ],
  },
  {
    label: "People",
    items: [
      { href: routes.adminEmployees, label: "Employees", icon: Users },
      { href: routes.adminSalary, label: "Payroll", icon: CreditCard },
    ],
  },
  {
    label: "Finance",
    items: [
      { href: routes.adminFunds, label: "Funds", icon: Landmark },
      { href: routes.adminReports, label: "Reports", icon: FileBarChart2 },
    ],
  },
];

export function AdminSidebar() {
  const [location, setLocation] = useLocation();
  const logout = useAuthStore((state) => state.logout);
  const user = useAuthStore((state) => state.user);

  return (
    <aside className="hidden w-[292px] shrink-0 border-r border-white/6 bg-[#0b0b0b] px-5 py-6 lg:flex lg:flex-col">
      <AppLogo />
      <div className="mt-8 space-y-8">
        {sections.map((section) => (
          <div key={section.label} className="space-y-3">
            <p className="px-3 text-[11px] uppercase tracking-[0.24em] text-muted-foreground">{section.label}</p>
            <div className="space-y-1.5">
              {section.items.map((item) => {
                const active = location === item.href;
                return (
                  <Link key={item.href} href={item.href}>
                    <div
                      className={cn(
                        "flex cursor-pointer items-center gap-3 rounded-2xl border px-3.5 py-3 text-sm transition",
                        active
                          ? "border-primary/25 bg-[linear-gradient(135deg,rgba(38,110,255,0.18),rgba(34,197,208,0.14))] text-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]"
                          : "border-transparent text-muted-foreground hover:border-white/6 hover:bg-white/[0.03] hover:text-foreground",
                      )}
                    >
                      <item.icon className={cn("h-4 w-4", active ? "text-primary" : "text-muted-foreground")} />
                      <span>{item.label}</span>
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-auto space-y-4 rounded-3xl border border-white/6 bg-white/[0.03] p-4">
        <div>
          <p className="text-sm font-medium text-foreground">{user?.name ?? "Admin"}</p>
          <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Administrator</p>
        </div>
        <button
          onClick={() => {
            void logout().finally(() => setLocation(routes.login));
          }}
          className="flex w-full items-center justify-center gap-2 rounded-2xl border border-white/8 bg-white/[0.03] px-3 py-2.5 text-sm text-muted-foreground transition hover:bg-white/[0.06] hover:text-foreground"
        >
          <LogOut className="h-4 w-4" />
          Sign out
        </button>
      </div>
    </aside>
  );
}
