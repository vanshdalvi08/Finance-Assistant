import { cn } from "@/lib/utils";
import sidebarLogo from "@/assets/SideBar Logo.png";

export function AppLogo({ compact = false }: { compact?: boolean }) {
  return (
    <div className={cn("flex min-w-0 items-center", compact ? "justify-center" : "gap-3")}>
      <img
        src={sidebarLogo}
        alt="Reforix Payroll"
        className={cn("shrink-0 object-contain", compact ? "h-8 w-8" : "h-8 w-8")}
      />
      {!compact && (
        <div className="min-w-0 space-y-0.5">
          <p className="font-serif text-lg font-semibold tracking-tight text-foreground">Reforix Payroll</p>
          <p className="text-xs uppercase tracking-[0.24em] text-muted-foreground">Payroll & Operations</p>
        </div>
      )}
    </div>
  );
}
