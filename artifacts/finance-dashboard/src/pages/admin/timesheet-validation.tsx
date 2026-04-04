import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { DashboardCard } from "@/components/dashboard-card";
import { api, type TimesheetEntry } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, Eye, RotateCcw } from "lucide-react";

const DAYS = [
  { key: "mon", label: "Mon" },
  { key: "tue", label: "Tue" },
  { key: "wed", label: "Wed" },
  { key: "thu", label: "Thu" },
  { key: "fri", label: "Fri" },
  { key: "sat", label: "Sat" },
  { key: "sun", label: "Sun" },
] as const;

function totalHours(entry: TimesheetEntry) {
  return entry.lines.reduce(
    (sum, line) => sum + Object.values(line.hours).reduce((lineSum, value) => lineSum + Number(value || 0), 0),
    0,
  );
}

function statusVariant(status: TimesheetEntry["status"]) {
  if (status === "approved") return "secondary";
  if (status === "rejected") return "destructive";
  if (status === "submitted") return "default";
  return "outline";
}

function formatMoney(value: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(value);
}

function formatHours(value: number) {
  return Number(value || 0) > 0 ? `${Number(value || 0)}h` : "-";
}

export default function AdminTimesheetValidationPage() {
  const queryClient = useQueryClient();
  const [employeeFilter, setEmployeeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState<TimesheetEntry["status"] | "all">("submitted");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [reviewNote, setReviewNote] = useState("");

  const { data: timesheets = [] } = useQuery({
    queryKey: ["admin-timesheets"],
    queryFn: () => api.getTimesheets(),
  });

  const { data: employees = [] } = useQuery({
    queryKey: ["employees"],
    queryFn: api.getEmployees,
  });

  const { data: summary } = useQuery({
    queryKey: ["timesheet-summary"],
    queryFn: () => api.getTimesheetSummary(),
  });

  const filtered = useMemo(() => {
    return timesheets.filter((entry) => {
      if (employeeFilter !== "all" && entry.employeeId !== employeeFilter) return false;
      if (statusFilter !== "all" && entry.status !== statusFilter) return false;
      if (search.trim()) {
        const needle = search.trim().toLowerCase();
        const haystack = `${entry.employeeNameSnapshot} ${entry.weekStart} ${entry.reviewNotes ?? ""}`.toLowerCase();
        if (!haystack.includes(needle)) return false;
      }
      return true;
    });
  }, [employeeFilter, search, statusFilter, timesheets]);

  const selected = useMemo(
    () => filtered.find((entry) => entry.id === selectedId) ?? filtered[0] ?? null,
    [filtered, selectedId],
  );

  const selectedEmployee = useMemo(
    () => employees.find((employee) => employee.id === selected?.employeeId) ?? null,
    [employees, selected?.employeeId],
  );
  const payrollProfile = (selectedEmployee ?? {}) as {
    payType?: string;
    hourlyRate?: number;
  };
  const isHourly = String(payrollProfile.payType ?? "").toLowerCase() === "hourly";
  const hourlyRate = isHourly || typeof payrollProfile.hourlyRate === "number" ? Number(payrollProfile.hourlyRate ?? 0) : 0;
  const selectedHours = selected ? totalHours(selected) : 0;
  const pendingPayrollAmount = hourlyRate > 0 ? selectedHours * hourlyRate : 0;
  const dayTotals = useMemo(() => {
    if (!selected) {
      return DAYS.map((day) => ({ ...day, value: 0 }));
    }

    return DAYS.map((day) => ({
      ...day,
      value: selected.lines.reduce((sum, line) => sum + Number(line.hours[day.key] ?? 0), 0),
    }));
  }, [selected]);

  const selectedHasRejectedNote = selected?.status === "rejected" && Boolean(selected.reviewNotes?.trim());

  useEffect(() => {
    setReviewNote(selected?.status === "rejected" ? selected.reviewNotes ?? "" : "");
  }, [selected?.id, selected?.reviewNotes, selected?.status]);

  const reviewMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: "approved" | "rejected" }) => {
      if (status === "approved") {
        await api.approveTimesheet(id, "Admin", reviewNote.trim() || "Approved");
        return;
      }

      await api.rejectTimesheet(id, "Admin", reviewNote.trim() || "Please revise and resubmit.");
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["admin-timesheets"] });
      await queryClient.invalidateQueries({ queryKey: ["timesheet-summary"] });
      await queryClient.invalidateQueries({ queryKey: ["adminOverview"] });
      await queryClient.invalidateQueries({ queryKey: ["salaries"] });
      await queryClient.invalidateQueries({ queryKey: ["employee-salaries"] });
      await queryClient.invalidateQueries({ queryKey: ["transactions"] });
      await queryClient.invalidateQueries({ queryKey: ["chartData"] });
      setReviewNote("");
    },
  });

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Timesheet Validation</h1>
          <p className="mt-1 text-sm text-muted-foreground">Review submitted weekly sheets before they move into payroll context.</p>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
          <DashboardCard label="Pending" value={`${summary?.pending ?? 0}`} />
          <DashboardCard label="Approved" value={`${summary?.approved ?? 0}`} />
          <DashboardCard label="Rejected" value={`${summary?.rejected ?? 0}`} />
          <DashboardCard label="Tracked Hours" value={`${summary?.totalHours ?? 0}h`} />
        </div>

        <Card className="border-border/50">
          <CardContent className="pt-4 pb-3">
            <div className="grid gap-3 md:grid-cols-3">
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Search</Label>
                <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Employee or week" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Employee</Label>
                <Select value={employeeFilter} onValueChange={setEmployeeFilter}>
                  <SelectTrigger>
                    <SelectValue placeholder="All employees" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All employees</SelectItem>
                    {employees.map((employee) => (
                      <SelectItem key={employee.id} value={employee.id}>
                        {employee.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Status</Label>
                <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as TimesheetEntry["status"] | "all")}>
                  <SelectTrigger>
                    <SelectValue placeholder="Status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All statuses</SelectItem>
                    <SelectItem value="draft">Draft</SelectItem>
                    <SelectItem value="submitted">Submitted</SelectItem>
                    <SelectItem value="approved">Approved</SelectItem>
                    <SelectItem value="rejected">Rejected</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-6 xl:grid-cols-[1fr_1.4fr]">
          <Card className="border-border/50">
            <CardHeader>
              <CardTitle className="text-base">Submission Queue</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {filtered.length === 0 ? (
                <div className="py-10 text-center text-sm text-muted-foreground">No timesheets match the current filters.</div>
              ) : (
                filtered.map((entry) => (
                  <button
                    key={entry.id}
                    onClick={() => setSelectedId(entry.id)}
                    className={[
                      "w-full rounded-lg border px-4 py-3 text-left transition-colors",
                      selected?.id === entry.id ? "border-primary/30 bg-primary/5" : "border-border/50 hover:bg-secondary/20",
                    ].join(" ")}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-medium">{entry.employeeNameSnapshot}</p>
                        <p className="text-xs text-muted-foreground">Week of {format(new Date(entry.weekStart), "dd MMM yyyy")}</p>
                      </div>
                      <Badge variant={statusVariant(entry.status)} className="capitalize">
                        {entry.status}
                      </Badge>
                    </div>
                    <div className="mt-3 flex items-center justify-between text-sm text-muted-foreground">
                      <span>{entry.lines.length} task rows</span>
                      <span>{totalHours(entry)}h</span>
                    </div>
                  </button>
                ))
              )}
            </CardContent>
          </Card>

          <Card className="border-border/50">
            <CardHeader>
              <CardTitle className="text-base">Review Panel</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {!selected ? (
                <div className="py-12 text-center text-sm text-muted-foreground">Select a timesheet to review.</div>
              ) : (
                <>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <div className="rounded-lg border border-border/50 bg-secondary/20 p-3">
                      <p className="text-xs text-muted-foreground">Employee</p>
                      <p className="mt-1 font-medium">{selected.employeeNameSnapshot}</p>
                    </div>
                    <div className="rounded-lg border border-border/50 bg-secondary/20 p-3">
                      <p className="text-xs text-muted-foreground">Week</p>
                      <p className="mt-1 font-medium">{format(new Date(selected.weekStart), "dd MMM yyyy")}</p>
                    </div>
                    <div className="rounded-lg border border-border/50 bg-secondary/20 p-3">
                      <p className="text-xs text-muted-foreground">Status</p>
                      <p className="mt-1">
                        <Badge variant={statusVariant(selected.status)} className="capitalize">
                          {selected.status}
                        </Badge>
                      </p>
                    </div>
                  </div>

                  {selectedHasRejectedNote ? (
                    <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-sm">
                      <div className="flex items-start gap-3">
                        <AlertTriangle className="mt-0.5 h-4 w-4 text-amber-400" />
                        <div>
                          <p className="font-medium text-foreground">Returned for changes</p>
                          <p className="mt-1 text-muted-foreground">{selected.reviewNotes}</p>
                        </div>
                      </div>
                    </div>
                  ) : null}

                  <div className="rounded-lg border border-border/50 bg-secondary/10 px-4 py-3 text-sm text-muted-foreground">
                    {hourlyRate > 0 ? (
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <p className="font-medium text-foreground">Payroll preview</p>
                          <p className="mt-1">
                            {formatMoney(hourlyRate)} per hour x {selectedHours}h = {formatMoney(pendingPayrollAmount)}
                          </p>
                        </div>
                        <Badge variant="outline" className="border-border/70">
                          Approve queues payroll
                        </Badge>
                      </div>
                    ) : (
                      <p>
                        Hourly rate is not set yet for this employee. Add it in Employees to preview payroll before
                        approval.
                      </p>
                    )}
                  </div>

                  <div className="grid gap-3 sm:grid-cols-4 lg:grid-cols-7">
                    {dayTotals.map((day) => (
                      <div key={day.key} className="rounded-lg border border-border/50 bg-secondary/20 px-3 py-2">
                        <p className="text-xs text-muted-foreground">{day.label}</p>
                        <p className="mt-1 font-medium">{day.value}h</p>
                      </div>
                    ))}
                  </div>

                  <div className="rounded-lg border border-border/50 bg-secondary/10">
                    <div className="flex flex-col gap-3 border-b border-border/50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="space-y-1">
                        <p className="text-sm font-medium text-foreground">Worklog Preview</p>
                        <p className="text-xs text-muted-foreground">
                          A compact snapshot for review. Open the full view to read long project and task details clearly.
                        </p>
                      </div>

                      <Dialog>
                        <DialogTrigger asChild>
                          <Button variant="outline" size="sm" className="rounded-xl border-border/60">
                            <Eye className="mr-2 h-4 w-4" />
                            View Details
                          </Button>
                        </DialogTrigger>
                        <DialogContent className="max-w-5xl border-border/60 bg-card p-0 shadow-xl">
                          <DialogHeader className="border-b border-border/50 px-6 py-5">
                            <DialogTitle className="text-xl">Timesheet Details</DialogTitle>
                            <DialogDescription>
                              {selected.employeeNameSnapshot} · Week of {format(new Date(selected.weekStart), "dd MMM yyyy")}
                            </DialogDescription>
                          </DialogHeader>

                          <ScrollArea className="max-h-[75vh]">
                            <div className="space-y-6 px-6 py-5">
                              <div className="grid gap-3 sm:grid-cols-4">
                                <div className="rounded-lg border border-border/50 bg-secondary/15 px-4 py-3">
                                  <p className="text-xs text-muted-foreground">Total Hours</p>
                                  <p className="mt-1 text-lg font-semibold">{selectedHours}h</p>
                                </div>
                                <div className="rounded-lg border border-border/50 bg-secondary/15 px-4 py-3">
                                  <p className="text-xs text-muted-foreground">Task Rows</p>
                                  <p className="mt-1 text-lg font-semibold">{selected.lines.length}</p>
                                </div>
                                <div className="rounded-lg border border-border/50 bg-secondary/15 px-4 py-3">
                                  <p className="text-xs text-muted-foreground">Status</p>
                                  <div className="mt-2">
                                    <Badge variant={statusVariant(selected.status)} className="capitalize">
                                      {selected.status}
                                    </Badge>
                                  </div>
                                </div>
                                <div className="rounded-lg border border-border/50 bg-secondary/15 px-4 py-3">
                                  <p className="text-xs text-muted-foreground">Payroll Preview</p>
                                  <p className="mt-1 text-lg font-semibold">
                                    {hourlyRate > 0 ? formatMoney(pendingPayrollAmount) : "Not set"}
                                  </p>
                                </div>
                              </div>

                              <div className="grid gap-3 sm:grid-cols-7">
                                {dayTotals.map((day) => (
                                  <div key={day.key} className="rounded-lg border border-border/50 bg-secondary/15 px-3 py-3">
                                    <p className="text-xs text-muted-foreground">{day.label}</p>
                                    <p className="mt-1 font-medium text-foreground">{day.value}h</p>
                                  </div>
                                ))}
                              </div>

                              <div className="space-y-3">
                                {selected.lines.map((line, index) => (
                                  <div key={line.id} className="rounded-xl border border-border/50 bg-secondary/10 p-4">
                                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                                      <div className="min-w-0 flex-1 space-y-4">
                                        <div className="grid gap-4 lg:grid-cols-2">
                                          <div className="space-y-1">
                                            <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                                              Project
                                            </p>
                                            <p className="break-words text-sm font-medium leading-6 text-foreground">
                                              {line.project || "-"}
                                            </p>
                                          </div>
                                          <div className="space-y-1">
                                            <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                                              Task
                                            </p>
                                            <p className="break-words text-sm leading-6 text-foreground">
                                              {line.task || "-"}
                                            </p>
                                          </div>
                                        </div>

                                        <div className="grid gap-2 sm:grid-cols-4 xl:grid-cols-7">
                                          {DAYS.map((day) => (
                                            <div key={day.key} className="rounded-lg border border-border/50 bg-card/70 px-3 py-2">
                                              <p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                                                {day.label}
                                              </p>
                                              <p className="mt-1 text-sm font-medium text-foreground">
                                                {formatHours(line.hours[day.key])}
                                              </p>
                                            </div>
                                          ))}
                                        </div>
                                      </div>

                                      <div className="shrink-0 rounded-lg border border-border/50 bg-card/70 px-4 py-3 text-right">
                                        <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                                          Row Total
                                        </p>
                                        <p className="mt-1 text-lg font-semibold text-foreground">
                                          {Object.values(line.hours).reduce((sum, value) => sum + value, 0)}h
                                        </p>
                                        <p className="mt-2 text-xs text-muted-foreground">Line {index + 1}</p>
                                      </div>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          </ScrollArea>
                        </DialogContent>
                      </Dialog>
                    </div>

                    <Table>
                      <TableHeader>
                        <TableRow className="border-border/50">
                          <TableHead className="w-[28%]">Project</TableHead>
                          <TableHead className="w-[32%]">Task</TableHead>
                          <TableHead className="text-right">Total</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {selected.lines.slice(0, 4).map((line) => (
                          <TableRow key={line.id} className="border-border/50">
                            <TableCell className="max-w-0">
                              <p className="truncate font-medium">{line.project || "-"}</p>
                            </TableCell>
                            <TableCell className="max-w-0">
                              <p className="truncate text-muted-foreground">{line.task || "-"}</p>
                            </TableCell>
                            <TableCell className="text-right">
                              {Object.values(line.hours).reduce((sum, value) => sum + value, 0)}h
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>

                    {selected.lines.length > 4 ? (
                      <div className="border-t border-border/50 px-4 py-3 text-xs text-muted-foreground">
                        Showing 4 of {selected.lines.length} task rows. Open <span className="font-medium text-foreground">View Details</span> for the full breakdown.
                      </div>
                    ) : null}
                  </div>

                  <div className="space-y-2">
                    <Label>Review Note</Label>
                    <Textarea
                      value={reviewNote}
                      rows={4}
                      placeholder="Explain what needs to change before this sheet can be approved."
                      onChange={(event) => setReviewNote(event.target.value)}
                    />
                  </div>

                  <div className="flex gap-3">
                    <Button
                      className="flex-1"
                      disabled={selected.status !== "submitted" || reviewMutation.isPending}
                      onClick={() => reviewMutation.mutate({ id: selected.id, status: "approved" })}
                    >
                      Approve &amp; Queue Payroll
                    </Button>
                    <Button
                      variant="outline"
                      className="flex-1"
                      disabled={selected.status !== "submitted" || reviewMutation.isPending}
                      onClick={() => reviewMutation.mutate({ id: selected.id, status: "rejected" })}
                    >
                      <RotateCcw className="mr-2 h-4 w-4" />
                      Revert For Changes
                    </Button>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </DashboardLayout>
  );
}
