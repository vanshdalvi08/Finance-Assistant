import { cn } from "@/lib/utils";

export function AppLogo({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <div
        className={cn(
          "grid place-items-center rounded-2xl border border-white/10 bg-[radial-gradient(circle_at_top,_rgba(56,132,255,0.34),_rgba(34,197,208,0.14)_46%,_rgba(12,18,32,1)_100%)] shadow-[0_10px_40px_rgba(0,0,0,0.28)]",
          compact ? "h-10 w-10" : "h-12 w-12",
        )}
      >
        <span className="font-serif text-lg font-semibold text-white">R</span>
      </div>
      {!compact && (
        <div className="min-w-0">
          <p className="font-serif text-lg font-semibold tracking-tight text-foreground">Reforix Payroll</p>
          <p className="text-xs uppercase tracking-[0.24em] text-muted-foreground">Payroll & Operations</p>
        </div>
      )}
    </div>
  );
}
