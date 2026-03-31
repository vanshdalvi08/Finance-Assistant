import { Moon, Sun } from "lucide-react";
import { useTheme } from "@/components/theme-provider";
import { useUIStore } from "@/store/ui";
import { cn } from "@/lib/utils";

export function Topbar() {
  const { theme, setTheme } = useTheme();
  const { sidebarCollapsed } = useUIStore();

  return (
    <header
      className={cn(
        "h-16 fixed top-0 right-0 z-30 flex items-center justify-between px-8 border-b border-border bg-background/80 backdrop-blur-sm transition-all duration-300",
        sidebarCollapsed ? "left-16" : "left-60"
      )}
    >
      <div className="flex items-center">
        {/* Breadcrumbs or Page Title could go here, handled by pages usually, but we keep topbar clean */}
      </div>

      <div className="flex items-center gap-4">
        <button
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          className="w-8 h-8 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
        >
          {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
        </button>
      </div>
    </header>
  );
}
