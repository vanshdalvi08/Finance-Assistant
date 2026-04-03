import { addDays, format } from "date-fns";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";

function shiftWeek(weekStart: string, delta: number) {
  return addDays(new Date(weekStart), delta * 7).toISOString();
}

export function WeekPicker({
  weekStart,
  onChange,
}: {
  weekStart: string;
  onChange: (nextWeekStart: string) => void;
}) {
  const start = new Date(weekStart);
  const end = addDays(start, 6);

  return (
    <div className="flex items-center gap-2 rounded-2xl border border-white/8 bg-white/[0.03] p-1">
      <Button variant="ghost" size="icon" onClick={() => onChange(shiftWeek(weekStart, -1))}>
        <ChevronLeft className="h-4 w-4" />
      </Button>
      <div className="min-w-[180px] text-center text-sm text-foreground">
        {format(start, "dd MMM")} - {format(end, "dd MMM yyyy")}
      </div>
      <Button variant="ghost" size="icon" onClick={() => onChange(shiftWeek(weekStart, 1))}>
        <ChevronRight className="h-4 w-4" />
      </Button>
    </div>
  );
}
