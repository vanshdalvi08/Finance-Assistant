import { Copy, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { DayKey, TimesheetEntry, TimesheetTaskLine } from "@/lib/yojak-data";

const DAYS: Array<{ key: DayKey; label: string }> = [
  { key: "mon", label: "Mon" },
  { key: "tue", label: "Tue" },
  { key: "wed", label: "Wed" },
  { key: "thu", label: "Thu" },
  { key: "fri", label: "Fri" },
  { key: "sat", label: "Sat" },
  { key: "sun", label: "Sun" },
];

function createLine(): TimesheetTaskLine {
  return {
    id: `line_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    project: "",
    task: "",
    notes: "",
    hours: {
      mon: 0,
      tue: 0,
      wed: 0,
      thu: 0,
      fri: 0,
      sat: 0,
      sun: 0,
    },
  };
}

function updateLine(entry: TimesheetEntry, lineId: string, updater: (line: TimesheetTaskLine) => TimesheetTaskLine) {
  return {
    ...entry,
    lines: entry.lines.map((line) => (line.id === lineId ? updater(line) : line)),
  };
}

function lineTotal(line: TimesheetTaskLine) {
  return DAYS.reduce((sum, day) => sum + (line.hours[day.key] ?? 0), 0);
}

export function getWeekTotal(entry: TimesheetEntry) {
  return entry.lines.reduce((sum, line) => sum + lineTotal(line), 0);
}

export function TimesheetGrid({
  entry,
  readOnly = false,
  onChange,
}: {
  entry: TimesheetEntry;
  readOnly?: boolean;
  onChange?: (next: TimesheetEntry) => void;
}) {
  const emit = (next: TimesheetEntry) => onChange?.(next);

  return (
    <div className="rounded-3xl border border-white/8 bg-white/[0.03]">
      <div className="flex items-center justify-between border-b border-white/8 px-5 py-4">
        <div>
          <p className="text-sm font-medium text-foreground">Weekly time ledger</p>
          <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Weekly total {getWeekTotal(entry)}h</p>
        </div>
        {!readOnly && (
          <Button variant="outline" onClick={() => emit({ ...entry, lines: [...entry.lines, createLine()] })}>
            <Plus className="mr-2 h-4 w-4" />
            Add row
          </Button>
        )}
      </div>
      <ScrollArea className="w-full">
        <div className="min-w-[980px]">
          <div className="grid grid-cols-[1.2fr_1.6fr_repeat(7,88px)_96px_110px] border-b border-white/8 bg-white/[0.02] px-4 py-3 text-xs uppercase tracking-[0.18em] text-muted-foreground">
            <span>Project</span>
            <span>Task</span>
            {DAYS.map((day) => (
              <span key={day.key} className="text-center">{day.label}</span>
            ))}
            <span className="text-center">Total</span>
            <span className="text-right">Actions</span>
          </div>
          {entry.lines.map((line) => (
            <div key={line.id} className="grid grid-cols-[1.2fr_1.6fr_repeat(7,88px)_96px_110px] items-center gap-2 border-b border-white/6 px-4 py-3">
              <Input
                value={line.project}
                disabled={readOnly}
                onChange={(event) => emit(updateLine(entry, line.id, (current) => ({ ...current, project: event.target.value })))}
                placeholder="Client retainer"
                className="border-white/8 bg-black/20"
              />
              <Input
                value={line.task}
                disabled={readOnly}
                onChange={(event) => emit(updateLine(entry, line.id, (current) => ({ ...current, task: event.target.value })))}
                placeholder="Reporting and analytics"
                className="border-white/8 bg-black/20"
              />
              {DAYS.map((day) => (
                <Input
                  key={day.key}
                  type="number"
                  min={0}
                  max={24}
                  step={0.5}
                  value={line.hours[day.key]}
                  disabled={readOnly}
                  onChange={(event) =>
                    emit(
                      updateLine(entry, line.id, (current) => ({
                        ...current,
                        hours: {
                          ...current.hours,
                          [day.key]: Math.max(0, Math.min(24, Number(event.target.value || 0))),
                        },
                      })),
                    )
                  }
                  className="border-white/8 bg-black/20 text-center tabular-nums"
                />
              ))}
              <div className="text-center text-sm font-medium tabular-nums text-foreground">{lineTotal(line)}h</div>
              {!readOnly ? (
                <div className="flex justify-end gap-2">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() =>
                      emit({
                        ...entry,
                        lines: [...entry.lines, { ...line, id: createLine().id }],
                      })
                    }
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() =>
                      emit({
                        ...entry,
                        lines: entry.lines.length === 1 ? [createLine()] : entry.lines.filter((item) => item.id !== line.id),
                      })
                    }
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ) : (
                <div className="text-right text-xs text-muted-foreground">Locked</div>
              )}
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}
