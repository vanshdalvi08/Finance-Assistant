import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Edit3, Plus, Trash2, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { MetricCard } from "@/components/app/metric-card";
import { PageHeader } from "@/components/app/page-header";
import { StatusPill } from "@/components/app/status-pill";
import { formatCurrency } from "@/lib/utils";
import { yojakData, type EmployeeRecord } from "@/lib/yojak-data";

const initialForm: Partial<EmployeeRecord> = {
  name: "",
  email: "",
  roleTitle: "",
  department: "",
  monthlySalary: 0,
  status: "active",
};

export default function AdminEmployeesPage() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Partial<EmployeeRecord>>(initialForm);
  const { data: employees = [] } = useQuery({ queryKey: ["yojak-employees"], queryFn: yojakData.getEmployees });

  const activeCount = useMemo(() => employees.filter((employee) => employee.status === "active").length, [employees]);

  const saveMutation = useMutation({
    mutationFn: yojakData.saveEmployee,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["yojak-employees"] });
      setOpen(false);
      setForm(initialForm);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: yojakData.deleteEmployee,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["yojak-employees"] });
    },
  });

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="People"
        title="Employee directory"
        description="Manage employee records, payroll eligibility, and operational ownership from one view."
        actions={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button>
                <UserPlus className="mr-2 h-4 w-4" />
                Add employee
              </Button>
            </DialogTrigger>
            <DialogContent className="border-white/8 bg-[#111010]">
              <DialogHeader>
                <DialogTitle>{form.id ? "Edit employee" : "Add employee"}</DialogTitle>
              </DialogHeader>
              <div className="grid gap-4">
                <Input placeholder="Full name" value={form.name ?? ""} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} />
                <Input placeholder="Email" value={form.email ?? ""} onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))} />
                <div className="grid gap-4 md:grid-cols-2">
                  <Input placeholder="Role title" value={form.roleTitle ?? ""} onChange={(event) => setForm((current) => ({ ...current, roleTitle: event.target.value }))} />
                  <Input placeholder="Department" value={form.department ?? ""} onChange={(event) => setForm((current) => ({ ...current, department: event.target.value }))} />
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <Input type="number" placeholder="Monthly salary" value={form.monthlySalary ?? 0} onChange={(event) => setForm((current) => ({ ...current, monthlySalary: Number(event.target.value) }))} />
                  <Select value={form.status ?? "active"} onValueChange={(value) => setForm((current) => ({ ...current, status: value as EmployeeRecord["status"] }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="active">Active</SelectItem>
                      <SelectItem value="inactive">Inactive</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  onClick={() => saveMutation.mutate(form as Partial<EmployeeRecord> & Pick<EmployeeRecord, "name" | "email">)}
                  disabled={!form.name || !form.email}
                >
                  Save employee
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        }
      />

      <div className="grid gap-4 xl:grid-cols-3">
        <MetricCard label="Total employees" value={`${employees.length}`} icon={<UserPlus className="h-5 w-5" />} />
        <MetricCard label="Active employees" value={`${activeCount}`} icon={<UserPlus className="h-5 w-5" />} />
        <MetricCard label="Monthly payroll" value={formatCurrency(employees.reduce((sum, employee) => sum + employee.monthlySalary, 0))} />
      </div>

      <Card className="border-white/8 bg-white/[0.03]">
        <CardContent className="pt-6">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Employee</TableHead>
                <TableHead>Department</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Monthly salary</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {employees.map((employee) => (
                <TableRow key={employee.id}>
                  <TableCell>
                    <div>
                      <p className="font-medium text-foreground">{employee.name}</p>
                      <p className="text-xs text-muted-foreground">{employee.email}</p>
                    </div>
                  </TableCell>
                  <TableCell>{employee.department}</TableCell>
                  <TableCell>{employee.roleTitle}</TableCell>
                  <TableCell>{formatCurrency(employee.monthlySalary)}</TableCell>
                  <TableCell><StatusPill status={employee.status} /></TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button variant="ghost" size="icon" onClick={() => { setForm(employee); setOpen(true); }}>
                        <Edit3 className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => deleteMutation.mutate(employee.id)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
