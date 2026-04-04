import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { TrendingDown, TrendingUp } from "lucide-react";

interface DashboardCardProps {
  label: string;
  value: string;
  trend?: number;
  trendLabel?: string;
  icon?: React.ReactNode;
  className?: string;
}

export function DashboardCard({ label, value, trend, trendLabel, icon, className }: DashboardCardProps) {
  return (
    <Card className={cn("hover:bg-card/90 transition-colors border-border/50", className)}>
      <CardContent className="p-6">
        <div className="flex justify-between items-start">
          <div className="space-y-2">
            <p className="text-sm font-medium text-muted-foreground">{label}</p>
            <p className="text-3xl font-bold tracking-tight">{value}</p>
          </div>
          {icon && <div className="text-muted-foreground p-2 bg-secondary/50 rounded-lg">{icon}</div>}
        </div>
        
        {(trend !== undefined) && (
          <div className="mt-4 flex items-center text-sm">
            <span
              className={cn(
                "flex items-center font-medium",
                trend > 0 ? "text-emerald-500" : trend < 0 ? "text-rose-500" : "text-muted-foreground"
              )}
            >
              {trend > 0 ? <TrendingUp className="w-4 h-4 mr-1" /> : trend < 0 ? <TrendingDown className="w-4 h-4 mr-1" /> : null}
              {Math.abs(trend)}%
            </span>
            {trendLabel && <span className="text-muted-foreground ml-2">{trendLabel}</span>}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
