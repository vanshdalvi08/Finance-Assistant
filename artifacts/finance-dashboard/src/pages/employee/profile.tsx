import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { DashboardCard } from "@/components/dashboard-card";
import { useAuthStore } from "@/store/auth";
import { api } from "@/lib/api";
import { updateCurrentUserProfile } from "@/auth/auth-service";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmployeeAvatar } from "@/components/employee-avatar";

function dateLabel(value: string) {
  return new Date(value).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function formatCurrency(value: number) {
  return value.toLocaleString("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
}

function compensationLabel(employee?: { payType?: string; salary?: number; hourlyRate?: number }) {
  if (!employee) {
    return "-";
  }

  if (employee.payType === "hourly") {
    return `${formatCurrency(employee.hourlyRate ?? 0)}/hr`;
  }

  return formatCurrency(employee.salary ?? 0);
}

export default function EmployeeProfilePage() {
  const queryClient = useQueryClient();
  const user = useAuthStore((state) => state.user);
  const replaceUser = useAuthStore((state) => state.replaceUser);
  const [form, setForm] = useState({
    name: "",
    email: "",
    role: "",
    department: "",
    note: "",
  });

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
          profilePhotoUrl: user.profilePhotoUrl ?? undefined,
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

  const { data: salaries = [] } = useQuery({
    queryKey: ["employee-salaries", employee?.id],
    queryFn: () => api.getSalarySlips({ employeeId: employee?.id ?? "" }),
    enabled: Boolean(employee?.id),
  });

  useEffect(() => {
    if (!employee) {
      return;
    }

    setForm({
      name: employee.name,
      email: employee.email,
      role: employee.role,
      department: employee.department,
      note: "",
    });
  }, [employee]);

  const updateMutation = useMutation({
    mutationFn: async () => {
      const result = await updateCurrentUserProfile({
        name: form.name.trim(),
        email: form.email.trim().toLowerCase(),
        phone: employee?.phone ?? user?.phone ?? "",
        position: form.role.trim(),
        department: form.department.trim(),
        profilePhotoUrl: employee?.profilePhotoUrl ?? user?.profilePhotoUrl ?? undefined,
      });

      await api.updateEmployee({
        id: employee?.id ?? "",
        name: result.user.name ?? form.name.trim(),
        email: result.user.email,
        phone: result.user.phone ?? employee?.phone ?? user?.phone ?? "",
        employeeId: result.user.employeeId,
        role: result.user.position ?? form.role.trim(),
        department: result.user.department ?? form.department.trim(),
        salary: employee?.salary ?? result.user.salary ?? 0,
        payType: employee?.payType ?? "monthly",
        hourlyRate: employee?.hourlyRate ?? 0,
        status: result.user.status === "inactive" ? "Inactive" : "Active",
      });

      return result;
    },
    onSuccess: async (result) => {
      replaceUser(result.user);
      await queryClient.invalidateQueries({ queryKey: ["employee-profile"] });
      await queryClient.invalidateQueries({ queryKey: ["employees"] });
    },
  });

  const recentActivity = useMemo(() => {
    return [
      ...timesheets.slice(0, 2).map((entry) => ({
        id: `t-${entry.id}`,
        type: "Timesheet",
        label: dateLabel(entry.weekStart),
        detail: entry.status,
      })),
      ...salaries.slice(0, 2).map((salary) => ({
        id: `s-${salary.id}`,
        type: "Salary",
        label: dateLabel(salary.date),
        detail: formatCurrency(salary.amount),
      })),
    ].slice(0, 6);
  }, [salaries, timesheets]);

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">My Profile</h1>
          <p className="mt-1 text-sm text-muted-foreground">Keep your basic account details up to date without extra admin overhead.</p>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
          <DashboardCard label="Role" value={employee?.role ?? "-"} />
          <DashboardCard label="Department" value={employee?.department ?? "-"} />
          <DashboardCard label="Compensation" value={compensationLabel(employee ?? undefined)} />
          <DashboardCard label="Status" value={employee?.status ?? "-"} />
        </div>

        <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <Card className="border-border/50">
            <CardHeader>
              <CardTitle className="text-base">Account Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-4 rounded-xl border border-border/50 bg-secondary/10 p-4">
                <EmployeeAvatar
                  name={(employee?.name ?? form.name) || user?.email || "Employee"}
                  src={employee?.profilePhotoUrl ?? user?.profilePhotoUrl}
                  className="h-16 w-16"
                  fallbackClassName="text-sm"
                />
                <div className="space-y-1">
                  <p className="font-medium text-foreground">{(employee?.name ?? form.name) || "Employee"}</p>
                  <p className="text-sm text-muted-foreground">{(employee?.email ?? form.email) || user?.email}</p>
                  <p className="text-xs text-muted-foreground">
                    {employee?.employeeId ?? user?.employeeId ?? "Employee ID pending"}
                  </p>
                </div>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>Full Name</Label>
                  <Input value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} />
                </div>
                <div className="space-y-2">
                  <Label>Email</Label>
                  <Input value={form.email} onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))} />
                </div>
                <div className="space-y-2">
                  <Label>Role</Label>
                  <Input value={form.role} onChange={(event) => setForm((current) => ({ ...current, role: event.target.value }))} />
                </div>
                <div className="space-y-2">
                  <Label>Department</Label>
                  <Input value={form.department} onChange={(event) => setForm((current) => ({ ...current, department: event.target.value }))} />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Work Note</Label>
                <Textarea value={form.note} rows={4} onChange={(event) => setForm((current) => ({ ...current, note: event.target.value }))} />
              </div>
              <div className="flex justify-end">
                <Button
                  disabled={!employee || !form.name.trim() || !form.email.trim() || !form.role.trim() || !form.department.trim() || updateMutation.isPending}
                  onClick={() => updateMutation.mutate()}
                >
                  Save Profile
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card className="border-border/50">
            <CardHeader>
              <CardTitle className="text-base">Recent Activity</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow className="border-border/50">
                    <TableHead>Type</TableHead>
                    <TableHead>Entry</TableHead>
                    <TableHead className="text-right">Detail</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recentActivity.length === 0 ? (
                    <TableRow className="border-border/50">
                      <TableCell colSpan={3} className="py-10 text-center text-muted-foreground">
                        No recent activity yet.
                      </TableCell>
                    </TableRow>
                  ) : (
                    recentActivity.map((item) => (
                      <TableRow key={item.id} className="border-border/50">
                        <TableCell className="font-medium">{item.type}</TableCell>
                        <TableCell>{item.label}</TableCell>
                        <TableCell className="text-right text-muted-foreground">{item.detail}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      </div>
    </DashboardLayout>
  );
}
