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
    <Card className={cn("overflow-hidden border-border/60 bg-card shadow-sm", className)}>
      <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-3">
        <div className="space-y-2">
          <CardTitle className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">{label}</CardTitle>
          <div className="text-3xl font-semibold tracking-tight text-foreground">{value}</div>
        </div>
        {icon && <div className="rounded-2xl border border-border/60 bg-muted/30 p-3 text-primary">{icon}</div>}
      </CardHeader>
      {(trend !== undefined || trendLabel) && (
        <CardContent className="pt-0">
          <div className="flex items-center gap-2 text-sm">
            {trend !== undefined && (
              <span
                className={cn(
                  "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium",
                  positive && "border-emerald-500/15 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300",
                  negative && "border-rose-500/15 bg-rose-500/10 text-rose-600 dark:text-rose-300",
                  !positive && !negative && "border-border/60 bg-muted/30 text-muted-foreground",
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
