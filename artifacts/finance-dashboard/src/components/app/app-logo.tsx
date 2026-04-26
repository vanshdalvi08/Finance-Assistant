import { cn } from "@/lib/utils";

export function AppLogo({ compact = false }: { compact?: boolean }) {
  return (
    <div className={cn("flex min-w-0 items-center gap-3", compact ? "justify-center" : "justify-start")}>
      <div
        aria-hidden="true"
        className="flex h-10 w-10 shrink-0 items-center justify-center text-[1.65rem] font-black leading-none tracking-[-0.18em] text-sidebar-foreground"
      >
        RX
      </div>
      {!compact ? (
        <div className="min-w-0 leading-tight">
          <div className="truncate text-[1.05rem] font-semibold tracking-[0.08em] text-sidebar-foreground">
            Reforix
          </div>
          <div className="mt-0.5 truncate text-[0.82rem] font-medium tracking-[0.06em] text-sidebar-foreground/72">
            Payroll
          </div>
        </div>
      ) : null}
    </div>
  );
}
