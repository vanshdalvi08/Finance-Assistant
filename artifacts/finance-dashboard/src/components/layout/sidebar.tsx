import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  LayoutDashboard,
  Users,
  CreditCard,
  Wallet,
  BriefcaseBusiness,
  Receipt,
  History,
  ChevronLeft,
  ChevronRight,
  LogOut,
  Settings,
  Clock3,
  FileBarChart2,
  ScrollText,
  UserRound,
  FolderKanban,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useUIStore } from "@/store/ui";
import { useAuthStore } from "@/store/auth";
import { useToast } from "@/hooks/use-toast";
import { EmployeeAvatar } from "@/components/employee-avatar";
import { api } from "@/lib/api";

const adminNavItems = [
  { href: "/", label: "Overview", icon: LayoutDashboard },
  { href: "/transactions", label: "History", icon: History },
  { href: "/employees", label: "Employees", icon: Users },
  { href: "/salary", label: "Salary", icon: CreditCard },
  { href: "/funds", label: "Funds", icon: Wallet },
  { href: "/project-budgets", label: "Projects", icon: FolderKanban },
  { href: "/purchase-orders", label: "PO", icon: BriefcaseBusiness },
  { href: "/expenses", label: "Expenses", icon: Receipt },
  { href: "/timesheets", label: "Timesheets", icon: Clock3 },
  { href: "/reports", label: "Reports", icon: FileBarChart2 },
  { href: "/audit-trail", label: "Audit Trail", icon: ScrollText },
  { href: "/settings", label: "Settings", icon: Settings },
];

const employeeNavItems = [
  { href: "/employee/timesheet", label: "My Timesheet", icon: Clock3 },
  { href: "/employee/expenses", label: "My Expenses", icon: Receipt },
  { href: "/employee/salary-slips", label: "Salary Slips", icon: CreditCard },
  { href: "/employee/profile", label: "Profile", icon: UserRound },
];

function getInitials(email: string): string {
  const local = email.split("@")[0];
  const parts = local.split(/[._-]/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return local.slice(0, 2).toUpperCase();
}

export function Sidebar() {
  const [location, setLocation] = useLocation();
  const { sidebarCollapsed, toggleSidebar } = useUIStore();
  const { user, userEmail, logout, role } = useAuthStore();
  const { toast } = useToast();
  const navItems = role === "employee" ? employeeNavItems : adminNavItems;
  const isAdmin = role === "admin";

  const { data: adminOverview } = useQuery({
    queryKey: ["adminOverview"],
    queryFn: api.getAdminOverview,
    enabled: isAdmin,
  });

  const { data: salaries = [] } = useQuery({
    queryKey: ["salaries"],
    queryFn: api.getSalaries,
    enabled: isAdmin,
  });

  const adminActivityCounts = isAdmin
    ? {
        "/salary": salaries.filter((salary) => salary.status === "pending").length,
        "/expenses": adminOverview?.pendingExpenses ?? 0,
        "/timesheets": adminOverview?.pendingTimesheets ?? 0,
      }
    : {};

  const initials = userEmail ? getInitials(userEmail) : "??";

  async function handleLogout() {
    await logout();
    toast({ title: "Signed out", description: "You have been signed out successfully." });
    setLocation("/login");
  }

  return (
    <aside
      className={cn(
        "h-screen fixed left-0 top-0 z-40 flex flex-col bg-sidebar border-r border-sidebar-border transition-all duration-300",
        sidebarCollapsed ? "w-16" : "w-60"
      )}
    >
      <div className="h-16 flex items-center px-4 border-b border-sidebar-border justify-between">
        {!sidebarCollapsed && (
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded bg-primary flex items-center justify-center">
              <span className="text-primary-foreground font-bold text-xs">Y</span>
            </div>
            <span className="font-bold text-sidebar-foreground tracking-tight">Yojak</span>
          </div>
        )}
        {sidebarCollapsed && (
          <div className="w-8 h-8 rounded bg-primary flex items-center justify-center mx-auto">
            <span className="text-primary-foreground font-bold text-sm">Y</span>
          </div>
        )}
      </div>

      <div className="flex-1 py-4 flex flex-col gap-1 px-2 overflow-y-auto">
        {navItems.map((item) => {
          const isActive = location === item.href;
          return (
            <Link key={item.href} href={item.href}>
              <div
                className={cn(
                  "relative flex items-center gap-3 px-3 py-2 rounded-md cursor-pointer transition-colors",
                  isActive
                    ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                    : "text-muted-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
                )}
              >
                <item.icon className="w-4 h-4 shrink-0" />
                {!sidebarCollapsed && <span>{item.label}</span>}
                {(() => {
                  const count = adminActivityCounts[item.href as keyof typeof adminActivityCounts] ?? 0;
                  if (!count) {
                    return null;
                  }

                  return sidebarCollapsed ? (
                    <span className="absolute right-2 top-2 h-2.5 w-2.5 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
                  ) : (
                    <span className="ml-auto inline-flex min-w-5 items-center justify-center rounded-full border border-emerald-500/20 bg-emerald-500/10 px-1.5 py-0.5 text-[11px] font-medium text-emerald-300">
                      {count > 9 ? "9+" : count}
                    </span>
                  );
                })()}
              </div>
            </Link>
          );
        })}
      </div>

      <div className="p-2 border-t border-sidebar-border flex justify-end">
        <button
          onClick={toggleSidebar}
          className="p-2 rounded-md text-muted-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-foreground transition-colors"
        >
          {sidebarCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
        </button>
      </div>

      <div className="p-3 border-t border-sidebar-border">
        <div className="flex items-center gap-3">
          <EmployeeAvatar
            name={user?.name ?? userEmail ?? initials}
            src={user?.profilePhotoUrl}
            className="h-8 w-8 shrink-0 border-primary/20"
            fallbackClassName="bg-primary/20 text-primary"
          />
          {!sidebarCollapsed && (
            <div className="flex flex-col flex-1 min-w-0">
              <span className="text-xs font-medium text-sidebar-foreground leading-none truncate">
                {user?.name ?? userEmail}
              </span>
              <span className="mt-1 text-[11px] text-muted-foreground truncate">{userEmail}</span>
            </div>
          )}
          <button
          onClick={() => void handleLogout()}
            title="Sign out"
            data-testid="button-logout"
            className={cn(
              "p-1.5 rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors shrink-0",
              sidebarCollapsed && "mx-auto"
            )}
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
    </aside>
  );
}
