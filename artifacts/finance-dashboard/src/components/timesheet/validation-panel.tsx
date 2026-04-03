import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { StatusPill } from "@/components/app/status-pill";
import type { TimesheetEntry } from "@/lib/yojak-data";

export function ValidationPanel({
  entry,
  onApprove,
  onReject,
}: {
  entry: TimesheetEntry | null;
  onApprove: (note?: string) => void;
  onReject: (note: string) => void;
}) {
  const [note, setNote] = useState("");

  if (!entry) {
    return null;
  }

  return (
    <div className="rounded-3xl border border-white/8 bg-white/[0.03] p-5">
      <div className="space-y-2">
        <StatusPill status={entry.status} />
        <h3 className="font-serif text-2xl font-semibold text-foreground">{entry.employeeNameSnapshot}</h3>
        <p className="text-sm text-muted-foreground">Submitter week starting {new Date(entry.weekStart).toLocaleDateString()}</p>
      </div>
      <div className="mt-4 space-y-2">
        <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Reviewer note</p>
        <Textarea
          value={note}
          onChange={(event) => setNote(event.target.value)}
          rows={4}
          className="border-white/8 bg-black/20"
          placeholder="Provide validation notes or rejection guidance."
        />
      </div>
      <div className="mt-4 flex gap-3">
        <Button className="flex-1" onClick={() => onApprove(note)}>
          Approve
        </Button>
        <Button
          variant="outline"
          className="flex-1 border-rose-400/20 bg-rose-400/10 text-rose-200 hover:bg-rose-400/15"
          onClick={() => onReject(note || "Please revise and resubmit with task clarity.")}
        >
          Reject
        </Button>
      </div>
    </div>
  );
}
