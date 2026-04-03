import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { addDays, format } from "date-fns";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { DashboardCard } from "@/components/dashboard-card";
import { useAuthStore } from "@/store/auth";
import { api, type DayKey, type TimesheetEntry, type TimesheetTaskLine } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

const DAYS: Array<{ key: DayKey; label: string }> = [
  { key: "mon", label: "Mon" },
  { key: "tue", label: "Tue" },
  { key: "wed", label: "Wed" },
  { key: "thu", label: "Thu" },
  { key: "fri", label: "Fri" },
  { key: "sat", label: "Sat" },
  { key: "sun", label: "Sun" },
];

function weekStartIso(base = new Date()) {
  const date = new Date(base);
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + diff);
  date.setHours(12, 0, 0, 0);
  return date.toISOString();
}

function sameWeek(left: string, right: string) {
  return format(new Date(left), "yyyy-MM-dd") === format(new Date(right), "yyyy-MM-dd");
}

function createLine(): TimesheetTaskLine {
  return {
    id: `line_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    project: "",
    task: "",
    notes: "",
    hours: { mon: 0, tue: 0, wed: 0, thu: 0, fri: 0, sat: 0, sun: 0 },
  };
}

function lineTotal(line: TimesheetTaskLine) {
  return DAYS.reduce((sum, day) => sum + (line.hours[day.key] ?? 0), 0);
}

function entryTotal(entry: TimesheetEntry | null) {
  if (!entry) {
    return 0;
  }

  return entry.lines.reduce((sum, line) => sum + lineTotal(line), 0);
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

export default function EmployeeTimesheetPage() {
  const queryClient = useQueryClient();
  const user = useAuthStore((state) => state.user);
  const [selectedWeek, setSelectedWeek] = useState(() => weekStartIso());
  const [draft, setDraft] = useState<TimesheetEntry | null>(null);

  const { data: employee } = useQuery({
    queryKey: ["employee-profile", user?.id, user?.email],
    queryFn: async () => {
      if (!user) {
        return null;
      }

      const existing = await api.getEmployeeProfile({ employeeId: user.id, email: user.email });
      if (existing) {
        return existing;
      }

      return api.ensureEmployeeProfile({
        id: user.id,
        email: user.email,
        name: user.name ?? user.email.split("@")[0],
        phone: user.phone,
        employeeId: user.employeeId,
        role: user.position,
        department: user.department,
        salary: user.salary,
        payType: user.payType,
        hourlyRate: user.hourlyRate,
        status: user.status,
      });
    },
    enabled: Boolean(user),
  });

  const { data: timesheets = [] } = useQuery({
    queryKey: ["employee-timesheets", employee?.id],
    queryFn: () => api.getTimesheets({ employeeId: employee?.id ?? "" }),
    enabled: Boolean(employee?.id),
  });

  const current = useMemo(
    () => timesheets.find((entry) => sameWeek(entry.weekStart, selectedWeek)) ?? null,
    [selectedWeek, timesheets],
  );

  const payrollProfile = (employee ?? {}) as {
    payType?: string;
    hourlyRate?: number;
  };
  const isHourly = String(payrollProfile.payType ?? "").toLowerCase() === "hourly";
  const hourlyRate = isHourly || typeof payrollProfile.hourlyRate === "number" ? Number(payrollProfile.hourlyRate ?? 0) : 0;
  const draftHours = entryTotal(draft);
  const estimatedPayout = hourlyRate > 0 ? draftHours * hourlyRate : 0;

  const summary = useMemo(() => {
    const pending = timesheets.filter((entry) => entry.status === "submitted").length;
    const approved = timesheets.filter((entry) => entry.status === "approved").length;
    const totalHours = timesheets.reduce((sum, entry) => sum + entryTotal(entry), 0);
    return { pending, approved, totalHours };
  }, [timesheets]);

  useEffect(() => {
    setDraft(current);
  }, [current]);

  const createMutation = useMutation({
    mutationFn: () =>
      api.createTimesheetDraft({
        employeeId: employee?.id ?? user?.id ?? "",
        employeeNameSnapshot: employee?.name ?? user?.name ?? user?.email ?? "Employee",
        weekStart: selectedWeek,
      }),
    onSuccess: async (entry) => {
      await queryClient.invalidateQueries({ queryKey: ["employee-timesheets", employee?.id] });
      setDraft(entry);
    },
  });

  const saveMutation = useMutation({
    mutationFn: (entry: TimesheetEntry) => api.saveTimesheet(entry),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["employee-timesheets", employee?.id] });
      await queryClient.invalidateQueries({ queryKey: ["timesheet-summary", employee?.id] });
    },
  });

  const submitMutation = useMutation({
    mutationFn: async (entry: TimesheetEntry) => {
      await api.saveTimesheet(entry);
      await api.submitTimesheet(entry.id);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["employee-timesheets", employee?.id] });
      await queryClient.invalidateQueries({ queryKey: ["timesheet-summary", employee?.id] });
      await queryClient.invalidateQueries({ queryKey: ["adminOverview"] });
    },
  });

  useEffect(() => {
    if (!employee?.id || current || createMutation.isPending) {
      return;
    }

    void createMutation.mutate();
  }, [createMutation, current, employee?.id, selectedWeek]);

  const readOnly = draft?.status === "submitted" || draft?.status === "approved";

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">My Timesheet</h1>
          <p className="mt-1 text-sm text-muted-foreground">Track work hours with a clean weekly grid and submit when ready.</p>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
          <DashboardCard label="This Week" value={`${entryTotal(draft)}h`} />
          <DashboardCard label="Submitted" value={summary.pending.toString()} />
          <DashboardCard label="Approved" value={summary.approved.toString()} />
          <DashboardCard label="Tracked Hours" value={`${summary.totalHours}h`} />
        </div>

        <Card className="border-border/50">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Payroll Preview</CardTitle>
          </CardHeader>
          <CardContent>
            {hourlyRate > 0 ? (
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="rounded-lg border border-border/50 bg-secondary/20 px-4 py-3">
                  <p className="text-xs text-muted-foreground">Hourly Rate</p>
                  <p className="mt-1 text-lg font-semibold">{formatMoney(hourlyRate)}</p>
                </div>
                <div className="rounded-lg border border-border/50 bg-secondary/20 px-4 py-3">
                  <p className="text-xs text-muted-foreground">Current Week Hours</p>
                  <p className="mt-1 text-lg font-semibold">{draftHours}h</p>
                </div>
                <div className="rounded-lg border border-border/50 bg-secondary/20 px-4 py-3">
                  <p className="text-xs text-muted-foreground">Estimated Payout</p>
                  <p className="mt-1 text-lg font-semibold">{formatMoney(estimatedPayout)}</p>
                </div>
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-border/60 bg-secondary/10 px-4 py-3 text-sm text-muted-foreground">
                Set an hourly rate in Admin Employees to preview weekly payroll from logged hours.
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border-border/50">
          <CardHeader className="flex flex-row items-center justify-between gap-4">
            <div>
              <CardTitle className="text-base">Weekly Ledger</CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">
                {format(new Date(selectedWeek), "dd MMM")} - {format(addDays(new Date(selectedWeek), 6), "dd MMM yyyy")}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {draft && (
                <Badge variant={statusVariant(draft.status)} className="capitalize">
                  {draft.status}
                </Badge>
              )}
              <Button variant="outline" size="sm" onClick={() => setSelectedWeek(weekStartIso(addDays(new Date(selectedWeek), -7)))}>
                Previous
              </Button>
              <Button variant="outline" size="sm" onClick={() => setSelectedWeek(weekStartIso())}>
                Current
              </Button>
              <Button variant="outline" size="sm" onClick={() => setSelectedWeek(weekStartIso(addDays(new Date(selectedWeek), 7)))}>
                Next
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {!draft ? (
              <div className="py-10 text-center text-sm text-muted-foreground">Preparing your draft sheet...</div>
            ) : (
              <>
                <Table>
                  <TableHeader>
                    <TableRow className="border-border/50">
                      <TableHead className="w-[180px]">Project</TableHead>
                      <TableHead className="w-[220px]">Task</TableHead>
                      {DAYS.map((day) => (
                        <TableHead key={day.key} className="text-center">
                          {day.label}
                        </TableHead>
                      ))}
                      <TableHead className="text-center">Total</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {draft.lines.map((line) => (
                      <TableRow key={line.id} className="border-border/50">
                        <TableCell>
                          <Input
                            value={line.project}
                            disabled={readOnly}
                            onChange={(event) =>
                              setDraft((currentEntry) =>
                                currentEntry
                                  ? {
                                      ...currentEntry,
                                      lines: currentEntry.lines.map((item) =>
                                        item.id === line.id ? { ...item, project: event.target.value } : item,
                                      ),
                                    }
                                  : currentEntry,
                              )
                            }
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            value={line.task}
                            disabled={readOnly}
                            onChange={(event) =>
                              setDraft((currentEntry) =>
                                currentEntry
                                  ? {
                                      ...currentEntry,
                                      lines: currentEntry.lines.map((item) =>
                                        item.id === line.id ? { ...item, task: event.target.value } : item,
                                      ),
                                    }
                                  : currentEntry,
                              )
                            }
                          />
                        </TableCell>
                        {DAYS.map((day) => (
                          <TableCell key={day.key}>
                            <Input
                              type="number"
                              min={0}
                              max={24}
                              step={0.5}
                              disabled={readOnly}
                              className="text-center"
                              value={line.hours[day.key]}
                              onChange={(event) =>
                                setDraft((currentEntry) =>
                                  currentEntry
                                    ? {
                                        ...currentEntry,
                                        lines: currentEntry.lines.map((item) =>
                                          item.id === line.id
                                            ? {
                                                ...item,
                                                hours: {
                                                  ...item.hours,
                                                  [day.key]: Math.max(0, Math.min(24, Number(event.target.value || 0))),
                                                },
                                              }
                                            : item,
                                        ),
                                      }
                                    : currentEntry,
                                )
                              }
                            />
                          </TableCell>
                        ))}
                        <TableCell className="text-center font-medium">{lineTotal(line)}h</TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={readOnly}
                              onClick={() =>
                                setDraft((currentEntry) =>
                                  currentEntry
                                    ? {
                                        ...currentEntry,
                                        lines: [...currentEntry.lines, { ...line, id: createLine().id }],
                                      }
                                    : currentEntry,
                                )
                              }
                            >
                              Copy
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={readOnly}
                              onClick={() =>
                                setDraft((currentEntry) =>
                                  currentEntry
                                    ? {
                                        ...currentEntry,
                                        lines:
                                          currentEntry.lines.length === 1
                                            ? [createLine()]
                                            : currentEntry.lines.filter((item) => item.id !== line.id),
                                      }
                                    : currentEntry,
                                )
                              }
                            >
                              Remove
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>

                <div className="flex flex-wrap items-center justify-between gap-3">
                  <Button
                    variant="outline"
                    disabled={readOnly}
                    onClick={() =>
                      setDraft((currentEntry) =>
                        currentEntry
                          ? { ...currentEntry, lines: [...currentEntry.lines, createLine()] }
                          : currentEntry,
                      )
                    }
                  >
                    Add Task Line
                  </Button>
                  <div className="flex gap-3">
                    <Button
                      variant="outline"
                      disabled={!draft || readOnly || saveMutation.isPending}
                      onClick={() => draft && saveMutation.mutate(draft)}
                    >
                      Save Draft
                    </Button>
                    <Button
                      disabled={!draft || readOnly || entryTotal(draft) <= 0 || submitMutation.isPending}
                      onClick={() => draft && submitMutation.mutate(draft)}
                    >
                      Submit Timesheet
                    </Button>
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <Card className="border-border/50">
          <CardHeader>
            <CardTitle className="text-base">Recent Weeks</CardTitle>
          </CardHeader>
          <CardContent>
            {timesheets.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground">No timesheet history yet.</div>
            ) : (
              <div className="space-y-2">
                {timesheets.slice(0, 6).map((entry) => (
                  <div key={entry.id} className="flex items-center justify-between rounded-lg border border-border/50 px-4 py-3">
                    <div>
                      <p className="font-medium">{format(new Date(entry.weekStart), "dd MMM yyyy")}</p>
                      <p className="text-xs text-muted-foreground">{entryTotal(entry)}h logged</p>
                    </div>
                    <Badge variant={statusVariant(entry.status)} className="capitalize">
                      {entry.status}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
