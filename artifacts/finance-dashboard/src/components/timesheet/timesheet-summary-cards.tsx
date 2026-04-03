import { Clock3, FileCheck2, FileWarning, Inbox } from "lucide-react";
import { MetricCard } from "@/components/app/metric-card";

export function TimesheetSummaryCards({
  pending,
  approved,
  rejected,
  totalHours,
}: {
  pending: number;
  approved: number;
  rejected: number;
  totalHours: number;
}) {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      <MetricCard label="Pending" value={pending.toString()} icon={<Inbox className="h-5 w-5" />} />
      <MetricCard label="Approved" value={approved.toString()} icon={<FileCheck2 className="h-5 w-5" />} />
      <MetricCard label="Rejected" value={rejected.toString()} icon={<FileWarning className="h-5 w-5" />} />
      <MetricCard label="Tracked Hours" value={`${totalHours}h`} icon={<Clock3 className="h-5 w-5" />} />
    </div>
  );
}
