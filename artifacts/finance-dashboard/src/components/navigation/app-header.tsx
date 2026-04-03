import { Bell, Moon, Search, Sun } from "lucide-react";
import { useTheme } from "@/components/theme-provider";
import { useAuthStore } from "@/store/auth";
import { StatusPill } from "@/components/app/status-pill";

export function AppHeader() {
  const { theme, setTheme } = useTheme();
  const user = useAuthStore((state) => state.user);

  return (
    <header className="sticky top-0 z-20 flex h-20 items-center justify-between border-b border-white/6 bg-[rgba(10,9,9,0.82)] px-6 backdrop-blur-xl md:px-8">
      <div className="flex items-center gap-3">
        <button className="inline-flex items-center gap-2 rounded-full border border-white/8 bg-white/[0.03] px-4 py-2 text-sm text-muted-foreground transition hover:bg-white/[0.06] hover:text-foreground">
          <Search className="h-4 w-4" />
          Search workspaces, reports, people
        </button>
      </div>
      <div className="flex items-center gap-3">
        {user?.role && <StatusPill status={user.role === "admin" ? "approved" : "processed"} className="capitalize" />}
        <button className="rounded-full border border-white/8 bg-white/[0.03] p-2.5 text-muted-foreground transition hover:bg-white/[0.06] hover:text-foreground">
          <Bell className="h-4 w-4" />
        </button>
        <button
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          className="rounded-full border border-white/8 bg-white/[0.03] p-2.5 text-muted-foreground transition hover:bg-white/[0.06] hover:text-foreground"
        >
          {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </button>
        <div className="hidden rounded-full border border-white/8 bg-white/[0.03] px-4 py-2 text-sm text-muted-foreground md:block">
          {user?.name ?? user?.email ?? "Workspace"}
        </div>
      </div>
    </header>
  );
}
