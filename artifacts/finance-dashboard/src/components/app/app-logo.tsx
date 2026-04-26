import { cn } from "@/lib/utils";

export function AppLogo({ compact = false }: { compact?: boolean }) {
  return (
    <div className={cn("flex min-w-0 items-center", compact ? "justify-center" : "justify-start")}>
      <div className="min-w-0">
        <p
          className={cn(
            "truncate font-semibold tracking-[-0.04em] text-foreground",
            compact ? "text-sm" : "text-[1.55rem] leading-none",
          )}
        >
          Reforix
        </p>
        <p
          className={cn(
            "truncate font-medium tracking-[0.08em] text-muted-foreground",
            compact ? "text-[10px] uppercase leading-none" : "mt-1 text-[0.78rem] uppercase leading-none",
          )}
        >
          Payroll
        </p>
      </div>
    </div>
  );
}
