import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, CreditCard } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { MetricCard } from "@/components/app/metric-card";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatusPill } from "@/components/app/status-pill";
import { formatCurrency } from "@/lib/utils";
import { yojakData } from "@/lib/yojak-data";

export default function AdminSalaryPage() {
  const queryClient = useQueryClient();
  const [employeeId, setEmployeeId] = useState("");
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [year, setYear] = useState(new Date().getFullYear());
  const [deductions, setDeductions] = useState(0);
  const [reimbursements, setReimbursements] = useState(0);
  const { data: employees = [] } = useQuery({ queryKey: ["yojak-employees"], queryFn: yojakData.getEmployees });
  const { data: slips = [] } = useQuery({ queryKey: ["yojak-salary-slips"], queryFn: () => yojakData.getSalarySlips() });

  const monthlyPaid = useMemo(
    () => slips.filter((slip) => slip.month === month && slip.year === year).reduce((sum, slip) => sum + slip.net, 0),
    [month, slips, year],
  );

  const runMutation = useMutation({
    mutationFn: yojakData.runPayroll,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["yojak-salary-slips"] });
      queryClient.invalidateQueries({ queryKey: ["yojak-transactions"] });
      queryClient.invalidateQueries({ queryKey: ["yojak-finance-series"] });
    },
  });

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="People / Payroll"
        title="Payroll operations"
        description="Run salary cycles, monitor payouts, and maintain employee compensation records."
      />

      <div className="grid gap-4 xl:grid-cols-3">
        <MetricCard label="Salary slips" value={`${slips.length}`} icon={<CreditCard className="h-5 w-5" />} />
        <MetricCard label="Paid this cycle" value={formatCurrency(monthlyPaid)} icon={<CalendarClock className="h-5 w-5" />} />
        <MetricCard label="Employees in payroll" value={`${employees.filter((employee) => employee.status === "active").length}`} />
      </div>

      <Card className="border-white/8 bg-white/[0.03]">
        <CardContent className="grid gap-4 pt-6 md:grid-cols-5">
          <Select value={employeeId} onValueChange={setEmployeeId}>
            <SelectTrigger><SelectValue placeholder="Select employee" /></SelectTrigger>
            <SelectContent>
              {employees.map((employee) => (
                <SelectItem key={employee.id} value={employee.id}>{employee.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input type="number" value={month} onChange={(event) => setMonth(Number(event.target.value))} placeholder="Month" />
          <Input type="number" value={year} onChange={(event) => setYear(Number(event.target.value))} placeholder="Year" />
          <Input type="number" value={deductions} onChange={(event) => setDeductions(Number(event.target.value))} placeholder="Deductions" />
          <Input type="number" value={reimbursements} onChange={(event) => setReimbursements(Number(event.target.value))} placeholder="Reimbursements" />
          <div className="md:col-span-5">
            <Button disabled={!employeeId} onClick={() => runMutation.mutate({ employeeId, month, year, deductions, reimbursements })}>
              Run payroll
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="border-white/8 bg-white/[0.03]">
        <CardContent className="pt-6">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Employee</TableHead>
                <TableHead>Cycle</TableHead>
                <TableHead>Gross</TableHead>
                <TableHead>Net</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {slips.map((slip) => (
                <TableRow key={slip.id}>
                  <TableCell>{slip.employeeNameSnapshot}</TableCell>
                  <TableCell>{slip.month}/{slip.year}</TableCell>
                  <TableCell>{formatCurrency(slip.gross)}</TableCell>
                  <TableCell>{formatCurrency(slip.net)}</TableCell>
                  <TableCell><StatusPill status={slip.status} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
