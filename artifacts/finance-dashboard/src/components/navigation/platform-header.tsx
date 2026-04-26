import { Bell, Moon, Search, Sun } from "lucide-react";
import { useTheme } from "@/components/theme-provider";
import { useAuthStore } from "@/store/auth";

export function PlatformHeader() {
  const { theme, setTheme } = useTheme();
  const user = useAuthStore((state) => state.user);

  return (
    <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b border-border/60 bg-background/95 px-5 backdrop-blur-sm md:px-8">
      <div className="flex items-center gap-3">
        <div className="hidden items-center gap-2 rounded-full border border-border/60 bg-muted/30 px-3 py-1.5 text-xs font-medium text-muted-foreground md:flex">
          <Search className="h-3.5 w-3.5" />
          Platform console
        </div>
      </div>
      <div className="flex items-center gap-2">
        <button
          className="rounded-full border border-border/60 bg-card p-2 text-muted-foreground transition hover:bg-muted/40 hover:text-foreground"
          aria-label="Notifications"
        >
          <Bell className="h-4 w-4" />
        </button>
        <button
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          className="rounded-full border border-border/60 bg-card p-2 text-muted-foreground transition hover:bg-muted/40 hover:text-foreground"
          aria-label="Toggle theme"
        >
          {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </button>
        <div className="hidden rounded-full border border-border/60 bg-card px-3 py-1.5 text-xs text-muted-foreground md:block">
          {user?.name ?? user?.email ?? "Platform"}
        </div>
      </div>
    </header>
  );
}
