import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { TrendingDown, TrendingUp } from "lucide-react";

export function MetricCard({
  label,
  value,
  icon,
  trend,
  trendLabel,
  className,
}: {
  label: string;
  value: string;
  icon?: React.ReactNode;
  trend?: number;
  trendLabel?: string;
  className?: string;
}) {
  const positive = (trend ?? 0) > 0;
  const negative = (trend ?? 0) < 0;

  return (
    <Card className={cn("overflow-hidden border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.03),rgba(255,255,255,0.015))] shadow-[0_18px_55px_rgba(0,0,0,0.28)]", className)}>
      <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-3">
        <div className="space-y-2">
          <CardTitle className="text-xs font-medium uppercase tracking-[0.22em] text-muted-foreground">{label}</CardTitle>
          <div className="font-serif text-3xl font-semibold tracking-tight text-foreground">{value}</div>
        </div>
        {icon && <div className="rounded-2xl border border-white/8 bg-white/5 p-3 text-[#e3c27c]">{icon}</div>}
      </CardHeader>
      {(trend !== undefined || trendLabel) && (
        <CardContent className="pt-0">
          <div className="flex items-center gap-2 text-sm">
            {trend !== undefined && (
              <span
                className={cn(
                  "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 font-medium",
                  positive && "border-emerald-400/20 bg-emerald-400/10 text-emerald-200",
                  negative && "border-rose-400/20 bg-rose-400/10 text-rose-200",
                  !positive && !negative && "border-white/10 bg-white/5 text-muted-foreground",
                )}
              >
                {positive ? <TrendingUp className="h-3.5 w-3.5" /> : negative ? <TrendingDown className="h-3.5 w-3.5" /> : null}
                {Math.abs(trend)}%
              </span>
            )}
            {trendLabel && <span className="text-muted-foreground">{trendLabel}</span>}
          </div>
        </CardContent>
      )}
    </Card>
  );
}
