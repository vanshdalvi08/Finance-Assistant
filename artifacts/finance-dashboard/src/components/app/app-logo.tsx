import { cn } from "@/lib/utils";
import { BrandMark } from "@/components/app/brand-mark";

export function AppLogo({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <div className={cn("grid place-items-center", compact ? "h-10 w-10" : "h-12 w-12")}>
        <BrandMark className={compact ? "h-10 w-10" : "h-12 w-12"} />
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
