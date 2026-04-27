import { cn } from "@/lib/utils";

type AppLogoProps = {
  compact?: boolean;
};

export function AppLogo({ compact = false }: AppLogoProps) {
  return (
    <div
      className={cn(
        "flex items-center text-sidebar-foreground transition-opacity",
        compact ? "justify-center" : "gap-3",
      )}
      aria-label="Reforix Payroll"
    >
      {compact ? (
        <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-sidebar-border/80 bg-sidebar-accent/35 text-base font-semibold tracking-[0.16em]">
          R
        </div>
      ) : (
        <div className="min-w-0">
          <div className="truncate text-[1.05rem] font-semibold leading-none tracking-[-0.02em]">
            Reforix
          </div>
          <div className="mt-1 truncate text-[0.72rem] font-medium uppercase tracking-[0.34em] text-muted-foreground">
            Payroll
          </div>
        </div>
      )}
    </div>
  );
}
