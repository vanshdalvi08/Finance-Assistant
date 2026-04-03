import { cn } from "@/lib/utils";

export function AppLogo({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <div
        className={cn(
          "grid place-items-center rounded-2xl border border-white/10 bg-[radial-gradient(circle_at_top,_rgba(233,194,113,0.36),_rgba(61,75,133,0.12)_45%,_rgba(18,18,18,1)_100%)] shadow-[0_10px_40px_rgba(0,0,0,0.28)]",
          compact ? "h-10 w-10" : "h-12 w-12",
        )}
      >
        <span className="font-serif text-lg font-semibold text-[#e3c27c]">Y</span>
      </div>
      {!compact && (
        <div className="min-w-0">
          <p className="font-serif text-lg font-semibold tracking-tight text-foreground">Yojak</p>
          <p className="text-xs uppercase tracking-[0.24em] text-muted-foreground">Finance & Operations</p>
        </div>
      )}
    </div>
  );
}
