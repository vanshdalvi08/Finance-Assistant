import { Sidebar } from "./sidebar";
import { Topbar } from "./topbar";
import { useUIStore } from "@/store/ui";
import { cn } from "@/lib/utils";

export function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { sidebarCollapsed } = useUIStore();

  return (
    <div className="min-h-screen bg-background text-foreground flex">
      <Sidebar />
      <Topbar />
      <main
        className={cn(
          "flex-1 pt-16 transition-all duration-300",
          sidebarCollapsed ? "ml-20" : "ml-60"
        )}
      >
        <div className="p-8 max-w-7xl mx-auto">{children}</div>
      </main>
    </div>
  );
}
