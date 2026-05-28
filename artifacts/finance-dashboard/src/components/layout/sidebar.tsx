import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  BriefcaseBusiness,
  CalendarDays,
  CalendarRange,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock3,
  CreditCard,
  FileBarChart2,
  FolderKanban,
  Handshake,
  History,
  LayoutDashboard,
  LogOut,
  Pin,
  Receipt,
  ScrollText,
  Settings,
  ShieldCheck,
  UserRound,
  Users,
  WalletCards,
  Wallet,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useUIStore } from "@/store/ui";
import { useAuthStore } from "@/store/auth";
import { useToast } from "@/hooks/use-toast";
import { AppLogo } from "@/components/app/app-logo";
import { EmployeeAvatar } from "@/components/employee-avatar";
import { api } from "@/lib/api";

type NavItem = {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
};

type AdminNavGroup = {
  id: string;
  label: string;
  items: NavItem[];
};

const MAX_PINNED_MODULES = 4;
const PINNED_STORAGE_KEY = "yojak.admin.sidebar.pinned.v2";
const overviewNavItem: NavItem = { href: "/", label: "Overview", icon: LayoutDashboard };

const adminGroups: AdminNavGroup[] = [
  {
    id: "operations",
    label: "Operations",
    items: [
      { href: "/transactions", label: "Transactions", icon: History },
      { href: "/funds", label: "Funds", icon: Wallet },
      { href: "/project-budgets", label: "Projects", icon: FolderKanban },
      { href: "/purchase-orders", label: "PO", icon: BriefcaseBusiness },
      { href: "/pre-approvals", label: "Pre Approval", icon: Handshake },
      { href: "/expenses", label: "Expenses", icon: Receipt },
    ],
  },
  {
    id: "workforce",
    label: "Workforce",
    items: [
      { href: "/employees", label: "Employees", icon: Users },
      { href: "/admins", label: "Admins", icon: ShieldCheck },
      { href: "/clients", label: "Clients", icon: UserRound },
      { href: "/salary", label: "Salary", icon: CreditCard },
      { href: "/timesheets", label: "Timesheets", icon: Clock3 },
      { href: "/leave-management", label: "Leave Management", icon: CalendarRange },
    ],
  },
  {
    id: "insights",
    label: "Insights",
    items: [
      { href: "/reports", label: "Reports", icon: FileBarChart2 },
      { href: "/audit-trail", label: "Audit Trail", icon: ScrollText },
    ],
  },
  {
    id: "settings",
    label: "Settings",
    items: [
      { href: "/settings", label: "Settings", icon: Settings },
      { href: "/settings/financial-accounts", label: "Financial Accounts", icon: WalletCards },
    ],
  },
];

const employeeNavItems: NavItem[] = [
  { href: "/employee/timesheet", label: "My Timesheet", icon: Clock3 },
  { href: "/employee/task-manager", label: "Task Manager", icon: FolderKanban },
  { href: "/employee/leaves", label: "My Leaves", icon: CalendarDays },
  { href: "/employee/expenses", label: "My Expenses", icon: Receipt },
  { href: "/employee/salary-slips", label: "Salary Slips", icon: CreditCard },
  { href: "/employee/profile", label: "Profile", icon: UserRound },
];

const clientNavItems: NavItem[] = [
  { href: "/client/pre-approvals", label: "Pre Approvals", icon: Handshake },
];

function getInitials(email: string): string {
  const local = email.split("@")[0];
  const parts = local.split(/[._-]/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return local.slice(0, 2).toUpperCase();
}

function readPinnedModules() {
  if (typeof window === "undefined") {
    return [] as string[];
  }

  try {
    const raw = window.localStorage.getItem(PINNED_STORAGE_KEY);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .filter((item): item is string => typeof item === "string" && item !== overviewNavItem.href)
      .slice(0, MAX_PINNED_MODULES);
  } catch {
    return [];
  }
}

function isRouteActive(current: string, href: string) {
  if (href === "/") {
    return current === "/";
  }

  return current === href || current.startsWith(`${href}/`);
}

export function Sidebar() {
  const [location, setLocation] = useLocation();
  const { sidebarCollapsed, toggleSidebar } = useUIStore();
  const { user, userEmail, logout, role } = useAuthStore();
  const { toast } = useToast();
  const isAdmin = role === "admin";

  const [openGroupId, setOpenGroupId] = useState("operations");
  const [pinnedModules, setPinnedModules] = useState<string[]>(() => readPinnedModules());

  const flattenedAdminItems = useMemo(
    () => [overviewNavItem, ...adminGroups.flatMap((group) => group.items)],
    [],
  );
  const pinnableAdminItems = useMemo(
    () => flattenedAdminItems.filter((item) => item.href !== overviewNavItem.href),
    [flattenedAdminItems],
  );
  const adminItemByHref = useMemo(
    () => new Map(flattenedAdminItems.map((item) => [item.href, item])),
    [flattenedAdminItems],
  );

  useEffect(() => {
    if (!isAdmin) {
      return;
    }

    setPinnedModules(readPinnedModules());
  }, [isAdmin]);

  const normalizedPinnedModules = useMemo(() => {
    const seen = new Set<string>();
    return pinnedModules
      .filter((href) => {
        if (href === overviewNavItem.href || !adminItemByHref.has(href) || seen.has(href)) {
          return false;
        }
        seen.add(href);
        return true;
      })
      .slice(0, MAX_PINNED_MODULES);
  }, [adminItemByHref, pinnedModules]);

  useEffect(() => {
    if (!isAdmin || typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem(PINNED_STORAGE_KEY, JSON.stringify(normalizedPinnedModules));
  }, [isAdmin, normalizedPinnedModules]);

  useEffect(() => {
    if (!isAdmin) {
      return;
    }

    if (normalizedPinnedModules.join("|") !== pinnedModules.join("|")) {
      setPinnedModules(normalizedPinnedModules);
    }
  }, [isAdmin, normalizedPinnedModules, pinnedModules]);

  const activeAdminGroup = useMemo(
    () =>
      adminGroups.find((group) =>
        group.items.some((item) => isRouteActive(location, item.href)),
      )?.id ?? "operations",
    [location],
  );

  useEffect(() => {
    if (!isAdmin) {
      return;
    }

    setOpenGroupId(activeAdminGroup);
  }, [activeAdminGroup, isAdmin]);

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

  const { data: pendingLeaveRequests = [] } = useQuery({
    queryKey: ["leave-requests", "pending"],
    queryFn: () => api.getLeaveRequests({ status: "pending" }),
    enabled: isAdmin,
  });

  const adminActivityCounts = isAdmin
    ? {
        "/salary": salaries.filter((salary) => salary.status === "pending").length,
        "/expenses": adminOverview?.pendingExpenses ?? 0,
        "/timesheets": adminOverview?.pendingTimesheets ?? 0,
        "/leave-management": pendingLeaveRequests.length,
      }
    : {};

  const initials = userEmail ? getInitials(userEmail) : "??";

  const pinnedItems = useMemo(
    () =>
      normalizedPinnedModules
        .map((href) => adminItemByHref.get(href))
        .filter((item): item is NavItem => Boolean(item)),
    [adminItemByHref, normalizedPinnedModules],
  );

  const groupsWithoutPinned = useMemo(() => {
    if (!isAdmin) {
      return [];
    }

    const pinnedSet = new Set(normalizedPinnedModules);
    return adminGroups
      .map((group) => ({
        ...group,
        items: group.items.filter((item) => !pinnedSet.has(item.href)),
      }))
      .filter((group) => group.items.length > 0);
  }, [isAdmin, normalizedPinnedModules]);

  function togglePinnedModule(href: string) {
    if (href === overviewNavItem.href) {
      return;
    }

    setPinnedModules((current) => {
      if (current.includes(href)) {
        return current.filter((item) => item !== href);
      }

      if (current.length >= MAX_PINNED_MODULES) {
        toast({
          title: "Pin limit reached",
          description: `You can pin up to ${MAX_PINNED_MODULES} modules.`,
        });
        return current;
      }

      return [...current, href];
    });
  }

  function renderActivityBadge(itemHref: string) {
    const count = adminActivityCounts[itemHref as keyof typeof adminActivityCounts] ?? 0;
    if (!count) {
      return null;
    }

    return sidebarCollapsed ? (
      <span className="absolute right-2 top-2 h-2.5 w-2.5 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(16,185,129,0.45)]" />
    ) : (
      <span className="inline-flex min-w-5 items-center justify-center rounded-full border border-emerald-500/20 bg-emerald-500/10 px-1.5 py-0.5 text-[11px] font-medium text-emerald-300">
        {count > 9 ? "9+" : count}
      </span>
    );
  }

  async function handleLogout() {
    await logout();
    setLocation("/login");
  }

  const collapsedAdminItems = useMemo(() => {
    const ordered = [overviewNavItem, ...pinnedItems];
    for (const item of pinnableAdminItems) {
      if (!ordered.some((existing) => existing.href === item.href)) {
        ordered.push(item);
      }
    }
    return ordered;
  }, [pinnableAdminItems, pinnedItems]);

  return (
    <aside
      className={cn(
        "fixed left-0 top-0 z-40 flex h-screen flex-col border-r border-sidebar-border bg-sidebar transition-all duration-300",
        sidebarCollapsed
          ? "w-20 bg-[linear-gradient(180deg,hsl(var(--sidebar))_0%,hsl(var(--sidebar))_58%,hsl(var(--sidebar-accent)/0.32)_100%)] shadow-[inset_-1px_0_0_rgba(255,255,255,0.02),0_12px_30px_rgba(0,0,0,0.22)]"
          : "w-64",
      )}
    >
      <div className={cn("flex h-16 items-center border-b border-sidebar-border", sidebarCollapsed ? "justify-center px-2" : "justify-between px-4")}>
        <AppLogo compact={sidebarCollapsed} />
      </div>

      <div className={cn("flex-1 px-2 py-4", sidebarCollapsed ? "overflow-y-auto no-scrollbar" : "overflow-y-auto")}>
        {isAdmin ? (
          sidebarCollapsed ? (
            <div className="mx-auto flex w-14 flex-col gap-2">
              {collapsedAdminItems.map((item) => {
                const active = isRouteActive(location, item.href);
                return (
                  <Link key={item.href} href={item.href}>
                    <div
                      title={item.label}
                      className={cn(
                        "relative flex h-12 w-12 cursor-pointer items-center justify-center rounded-[1.15rem] border border-transparent transition-all",
                        active
                          ? "border-sidebar-border bg-sidebar-accent/95 font-medium text-sidebar-accent-foreground shadow-[0_0_0_1px_rgba(255,255,255,0.02),0_10px_20px_rgba(0,0,0,0.18)]"
                          : "bg-sidebar-accent/10 text-muted-foreground hover:border-sidebar-border/60 hover:bg-sidebar-accent/35 hover:text-sidebar-foreground",
                      )}
                    >
                      <item.icon className="h-5 w-5 shrink-0" />
                      {renderActivityBadge(item.href)}
                    </div>
                  </Link>
                );
              })}
            </div>
          ) : (
            <div className="space-y-4">
              <div className="space-y-1">
                <Link href={overviewNavItem.href}>
                  <div
                    className={cn(
                      "group relative flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 transition-colors",
                      isRouteActive(location, overviewNavItem.href)
                        ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                        : "text-muted-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-foreground",
                    )}
                  >
                    <overviewNavItem.icon className="h-4 w-4 shrink-0" />
                    <span className="truncate">{overviewNavItem.label}</span>
                    <div className="ml-auto flex min-w-[2.5rem] items-center justify-end">
                      {renderActivityBadge(overviewNavItem.href)}
                    </div>
                  </div>
                </Link>
              </div>

              {pinnedItems.length > 0 ? (
                <>
                  <div className="border-t border-sidebar-border/70" />

                  <div className="space-y-1">
                    <p className="px-2 text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Pinned</p>
                    {pinnedItems.map((item) => {
                      const active = isRouteActive(location, item.href);
                      return (
                        <Link key={`pin-${item.href}`} href={item.href}>
                          <div
                            className={cn(
                              "group relative flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 transition-colors",
                              active
                                ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                                : "text-muted-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-foreground",
                            )}
                          >
                            <item.icon className="h-4 w-4 shrink-0" />
                            <span className="truncate">{item.label}</span>
                            <div className="ml-auto flex min-w-[3.75rem] items-center justify-end gap-1">
                              {renderActivityBadge(item.href)}
                              <button
                                onClick={(event) => {
                                  event.preventDefault();
                                  event.stopPropagation();
                                  togglePinnedModule(item.href);
                                }}
                                title="Unpin module"
                                className="rounded p-1 text-muted-foreground/70 transition-colors hover:bg-sidebar-accent/70 hover:text-sidebar-foreground"
                              >
                                <Pin className="h-3.5 w-3.5 fill-current" />
                              </button>
                            </div>
                          </div>
                        </Link>
                      );
                    })}
                  </div>
                </>
              ) : null}

              <div className="border-t border-sidebar-border/70" />

              <div className="space-y-1">
                {groupsWithoutPinned.map((group) => {
                  const isOpen = openGroupId === group.id;
                  const groupActive = group.items.some((item) => isRouteActive(location, item.href));
                  return (
                    <div key={group.id} className="rounded-md border border-transparent">
                      <button
                        onClick={() => setOpenGroupId((current) => (current === group.id ? "" : group.id))}
                        className={cn(
                          "flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm transition-colors",
                          groupActive
                            ? "bg-sidebar-accent/70 text-sidebar-accent-foreground"
                            : "text-muted-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-foreground",
                        )}
                      >
                        <span className="font-medium">{group.label}</span>
                        <ChevronDown className={cn("h-4 w-4 transition-transform", isOpen && "rotate-180")} />
                      </button>
                      {isOpen ? (
                        <div className="mt-1 space-y-1 border-l border-sidebar-border/70 py-1 pl-2">
                          {group.items.map((item) => {
                            const active = isRouteActive(location, item.href);
                            return (
                              <Link key={item.href} href={item.href}>
                                <div
                                  className={cn(
                                    "group relative flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 transition-colors",
                                    active
                                      ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                                      : "text-muted-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-foreground",
                                  )}
                                >
                                  <item.icon className="h-4 w-4 shrink-0" />
                                  <span className="truncate">{item.label}</span>
                                  <div className="ml-auto flex min-w-[3.75rem] items-center justify-end gap-1">
                                    {renderActivityBadge(item.href)}
                                    <button
                                      onClick={(event) => {
                                        event.preventDefault();
                                        event.stopPropagation();
                                        togglePinnedModule(item.href);
                                      }}
                                      title={
                                        normalizedPinnedModules.includes(item.href)
                                          ? "Unpin module"
                                          : "Pin module"
                                      }
                                      className="rounded p-1 text-muted-foreground/70 opacity-0 transition-all hover:bg-sidebar-accent/70 hover:text-sidebar-foreground group-hover:opacity-100"
                                    >
                                      <Pin
                                        className={cn(
                                          "h-3.5 w-3.5",
                                          normalizedPinnedModules.includes(item.href) && "fill-current",
                                        )}
                                      />
                                    </button>
                                  </div>
                                </div>
                              </Link>
                            );
                          })}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </div>
          )
        ) : role === "client" ? (
          <div className={cn("flex flex-col gap-1", sidebarCollapsed && "mx-auto w-11 gap-1.5")}>
            {clientNavItems.map((item) => {
              const active = isRouteActive(location, item.href);
              return (
                <Link key={item.href} href={item.href}>
                  <div
                    className={cn(
                      "relative flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 transition-colors",
                      sidebarCollapsed && "h-11 w-11 justify-center rounded-xl border border-transparent px-0",
                      active
                        ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                        : "text-muted-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-foreground",
                    )}
                  >
                      <item.icon className="h-4 w-4 shrink-0" />
                    {!sidebarCollapsed && <span>{item.label}</span>}
                  </div>
                </Link>
              );
            })}
          </div>
        ) : (
          <div className={cn("flex flex-col gap-1", sidebarCollapsed && "mx-auto w-11 gap-1.5")}>
            {employeeNavItems.map((item) => {
              const active = isRouteActive(location, item.href);
              return (
                <Link key={item.href} href={item.href}>
                  <div
                    className={cn(
                      "relative flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 transition-colors",
                      sidebarCollapsed && "h-11 w-11 justify-center rounded-xl border border-transparent px-0",
                      active
                        ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                        : "text-muted-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-foreground",
                    )}
                  >
                      <item.icon className="h-4 w-4 shrink-0" />
                    {!sidebarCollapsed && <span>{item.label}</span>}
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>

      <div className={cn("border-t border-sidebar-border p-2", sidebarCollapsed ? "flex justify-center bg-sidebar/70" : "flex justify-end")}>
        <button
          onClick={toggleSidebar}
          className={cn(
            "rounded-xl p-2 text-muted-foreground transition-colors hover:bg-sidebar-accent/50 hover:text-sidebar-foreground",
            sidebarCollapsed && "border border-sidebar-border/70 bg-sidebar-accent/25 shadow-sm",
          )}
        >
          {sidebarCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
        </button>
      </div>

      <div className={cn("border-t border-sidebar-border p-3", sidebarCollapsed && "bg-sidebar/80")}>
        <div className={cn("flex items-center gap-3", sidebarCollapsed && "justify-center")}>
          <EmployeeAvatar
            name={user?.name ?? userEmail ?? initials}
            src={user?.profilePhotoUrl}
            className="h-8 w-8 shrink-0 border-primary/20"
            fallbackClassName="bg-primary/20 text-primary"
          />
          {!sidebarCollapsed && (
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-xs font-medium leading-none text-sidebar-foreground">
                {user?.name ?? userEmail}
              </span>
              <span className="mt-1 truncate text-[11px] text-muted-foreground">{userEmail}</span>
            </div>
          )}
          <button
            onClick={() => void handleLogout()}
            title="Sign out"
            data-testid="button-logout"
            className={cn(
              "shrink-0 rounded-xl p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive",
              sidebarCollapsed && "border border-sidebar-border/70 bg-sidebar-accent/20",
            )}
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </aside>
  );
}
