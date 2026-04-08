import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { differenceInCalendarDays, format, isAfter, isBefore } from "date-fns";
import { CalendarDays, CheckCircle2, Clock3, PlaneTakeoff, Umbrella } from "lucide-react";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { DashboardCard } from "@/components/dashboard-card";
import { api, type Holiday, type LeaveRequest } from "@/lib/api";
import { useAuthStore } from "@/store/auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";

function leaveDays(request: LeaveRequest) {
  return differenceInCalendarDays(new Date(request.endDate), new Date(request.startDate)) + 1;
}

function formatDate(value: string) {
  return format(new Date(value), "dd MMM yyyy");
}

function statusClass(status: LeaveRequest["status"]) {
  if (status === "approved") return "border-emerald-500/20 bg-emerald-500/8 text-emerald-300";
  if (status === "rejected") return "border-rose-500/20 bg-rose-500/8 text-rose-300";
  return "border-sky-500/20 bg-sky-500/8 text-sky-300";
}

function requestDateLabel(request: LeaveRequest) {
  if (request.startDate.slice(0, 10) === request.endDate.slice(0, 10)) {
    return formatDate(request.startDate);
  }

  return `${formatDate(request.startDate)} - ${formatDate(request.endDate)}`;
}

export default function EmployeeLeavesPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const user = useAuthStore((state) => state.user);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [reason, setReason] = useState("");

  const { data: leaveRequests = [] } = useQuery({
    queryKey: ["employee-leave-requests", user?.id],
    queryFn: () => api.getLeaveRequests({ employeeId: user?.id, status: "all" }),
    enabled: Boolean(user?.id),
  });

  const { data: leavePolicy } = useQuery({
    queryKey: ["leave-policy"],
    queryFn: api.getLeavePolicy,
  });

  const { data: holidays = [] } = useQuery({
    queryKey: ["holidays", "employee-all"],
    queryFn: () => api.getHolidays(),
  });

  const summary = useMemo(() => {
    const approved = leaveRequests.filter((request) => request.status === "approved");
    const pending = leaveRequests.filter((request) => request.status === "pending");
    const rejected = leaveRequests.filter((request) => request.status === "rejected");
    const approvedDays = approved.reduce((sum, request) => sum + leaveDays(request), 0);
    const pendingDays = pending.reduce((sum, request) => sum + leaveDays(request), 0);
    const annualLimit = leavePolicy?.annualLimit ?? 10;
    const remaining = Math.max(0, annualLimit - approvedDays - pendingDays);

    return {
      annualLimit,
      approvedDays,
      pendingDays,
      rejectedCount: rejected.length,
      remaining,
    };
  }, [leavePolicy?.annualLimit, leaveRequests]);

  const upcomingHolidays = useMemo(() => {
    const today = new Date();
    return [...holidays]
      .filter((holiday) => !isBefore(new Date(holiday.date), new Date(today.toDateString())))
      .sort((left, right) => new Date(left.date).getTime() - new Date(right.date).getTime())
      .slice(0, 6);
  }, [holidays]);

  const submitMutation = useMutation({
    mutationFn: async () => {
      if (!startDate || !endDate) {
        throw new Error("Please choose both start and end dates.");
      }

      const start = new Date(`${startDate}T12:00:00`);
      const end = new Date(`${endDate}T12:00:00`);
      if (isAfter(start, end)) {
        throw new Error("Leave start date cannot be after the end date.");
      }

      return api.createLeaveRequest({
        startDate,
        endDate,
        reason: reason.trim() || undefined,
      });
    },
    onSuccess: () => {
      setStartDate("");
      setEndDate("");
      setReason("");
      toast({
        title: "Leave request submitted",
        description: "It is now waiting for admin approval.",
      });
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: ["employee-leave-requests", user?.id] }),
        queryClient.invalidateQueries({ queryKey: ["leave-requests"] }),
        queryClient.invalidateQueries({ queryKey: ["employee-month-calendar", user?.id] }),
        queryClient.invalidateQueries({ queryKey: ["notifications"] }),
      ]);
    },
    onError: (error) => {
      toast({
        title: "Could not submit leave request",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    },
  });

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Leave Management</h1>
          <p className="text-sm text-muted-foreground">
            Apply for leave with a reason, track approvals, and keep upcoming holidays in one clean place.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <DashboardCard label="Annual Leave Limit" value={`${summary.annualLimit}d`} icon={<Umbrella className="h-5 w-5" />} />
          <DashboardCard label="Approved Leave" value={`${summary.approvedDays}d`} icon={<CheckCircle2 className="h-5 w-5" />} />
          <DashboardCard label="Pending Approval" value={`${summary.pendingDays}d`} icon={<Clock3 className="h-5 w-5" />} />
          <DashboardCard label="Leave Remaining" value={`${summary.remaining}d`} icon={<PlaneTakeoff className="h-5 w-5" />} />
        </div>

        <div className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
          <Card className="border-border/60 bg-card/80 shadow-sm">
            <CardHeader>
              <CardTitle className="text-base font-medium">Apply For Leave</CardTitle>
              <CardDescription>
                Submit one clear request with dates and a short reason. Holidays are managed by admin and will appear automatically in your timesheet.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Start Date</label>
                  <Input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">End Date</label>
                  <Input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} />
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Reason</label>
                <Textarea
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  placeholder="Family event, medical appointment, personal travel, or any brief context for your manager."
                  className="min-h-[132px]"
                />
              </div>

              <div className="rounded-xl border border-border/60 bg-secondary/10 px-4 py-3 text-sm text-muted-foreground">
                Remaining requestable leave: <span className="font-medium text-foreground">{summary.remaining} day(s)</span>
              </div>

              <Button className="w-full rounded-xl" disabled={submitMutation.isPending} onClick={() => void submitMutation.mutateAsync()}>
                Submit Leave Request
              </Button>
            </CardContent>
          </Card>

          <div className="space-y-6">
            <Card className="border-border/60 bg-card/80 shadow-sm">
              <CardHeader>
                <CardTitle className="text-base font-medium">Request History</CardTitle>
                <CardDescription>See what is pending, approved, or returned.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {leaveRequests.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-border/60 px-4 py-10 text-center text-sm text-muted-foreground">
                    No leave requests yet.
                  </div>
                ) : (
                  leaveRequests.map((request) => (
                    <div key={request.id} className="rounded-xl border border-border/60 bg-secondary/10 px-4 py-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="font-medium text-foreground">{requestDateLabel(request)}</p>
                            <Badge className={`rounded-full border px-2.5 py-1 text-[11px] font-medium shadow-none ${statusClass(request.status)}`}>
                              {request.status}
                            </Badge>
                          </div>
                          <p className="text-sm text-muted-foreground">
                            {leaveDays(request)} day{leaveDays(request) > 1 ? "s" : ""}
                          </p>
                        </div>
                        {request.reviewedAt ? (
                          <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
                            Reviewed {formatDate(request.reviewedAt)}
                          </p>
                        ) : null}
                      </div>

                      {request.reason ? <p className="mt-3 text-sm text-muted-foreground">{request.reason}</p> : null}
                      {request.reviewNote ? (
                        <div className="mt-3 rounded-lg border border-border/60 bg-background/70 px-3 py-2 text-sm text-muted-foreground">
                          {request.reviewNote}
                        </div>
                      ) : null}
                    </div>
                  ))
                )}
              </CardContent>
            </Card>

            <Card className="border-border/60 bg-card/80 shadow-sm">
              <CardHeader>
                <CardTitle className="text-base font-medium">Upcoming Holidays</CardTitle>
                <CardDescription>Company holidays that will automatically reflect in your timesheet.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {upcomingHolidays.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-border/60 px-4 py-8 text-center text-sm text-muted-foreground">
                    No upcoming holidays planned yet.
                  </div>
                ) : (
                  upcomingHolidays.map((holiday: Holiday) => (
                    <div key={holiday.id} className="flex items-center justify-between gap-3 rounded-xl border border-border/60 bg-secondary/10 px-4 py-3">
                      <div>
                        <p className="font-medium text-foreground">{holiday.name}</p>
                        <p className="text-xs text-muted-foreground">{formatDate(holiday.date)}</p>
                      </div>
                      <CalendarDays className="h-4 w-4 text-muted-foreground" />
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
