import { Link, useLocation } from "wouter";
import { LayoutDashboard, Users, CreditCard, Wallet, Receipt, ReceiptText, ChevronLeft, ChevronRight, LogOut } from "lucide-react";
import { cn } from "@/lib/utils";
import { useUIStore } from "@/store/ui";
import { useAuthStore } from "@/store/auth";
import { useToast } from "@/hooks/use-toast";

const navItems = [
  { href: "/", label: "Overview", icon: LayoutDashboard },
  { href: "/transactions", label: "Transactions", icon: ReceiptText },
  { href: "/employees", label: "Employees", icon: Users },
  { href: "/salary", label: "Salary", icon: CreditCard },
  { href: "/funds", label: "Funds", icon: Wallet },
  { href: "/expenses", label: "Expenses", icon: Receipt },
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
  const { userEmail, logout } = useAuthStore();
  const { toast } = useToast();

  const initials = userEmail ? getInitials(userEmail) : "??";

  function handleLogout() {
    logout();
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
                  "flex items-center gap-3 px-3 py-2 rounded-md cursor-pointer transition-colors",
                  isActive
                    ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                    : "text-muted-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
                )}
              >
                <item.icon className="w-4 h-4 shrink-0" />
                {!sidebarCollapsed && <span>{item.label}</span>}
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
          <div className="w-8 h-8 rounded-full bg-primary/20 border border-primary/30 flex items-center justify-center shrink-0">
            <span className="text-xs font-semibold text-primary">{initials}</span>
          </div>
          {!sidebarCollapsed && (
            <div className="flex flex-col flex-1 min-w-0">
              <span className="text-xs font-medium text-sidebar-foreground leading-none truncate">{userEmail}</span>
            </div>
          )}
          <button
            onClick={handleLogout}
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
