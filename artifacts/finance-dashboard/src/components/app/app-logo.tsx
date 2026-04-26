import { cn } from "@/lib/utils";
import sidebarLogo from "@/assets/reforix-rx.png";

export function AppLogo({ compact = false }: { compact?: boolean }) {
  return (
    <div className={cn("flex min-w-0 items-center", compact ? "justify-center" : "justify-start")}>
      <img
        src={sidebarLogo}
        alt="Reforix Payroll"
        className={cn("shrink-0 object-contain", compact ? "h-10 w-10" : "h-10 w-10")}
      />
    </div>
  );
}
