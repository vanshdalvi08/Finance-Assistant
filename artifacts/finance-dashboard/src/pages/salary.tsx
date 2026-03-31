import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { api } from "@/lib/api";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { DashboardCard } from "@/components/dashboard-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { CreditCard, History } from "lucide-react";

const salarySchema = z.object({
  employeeId: z.string().min(1, "Employee is required"),
  amount: z.coerce.number().min(1, "Amount must be positive"),
  note: z.string().optional(),
});

export default function Salary() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  const { data: employees = [] } = useQuery({ queryKey: ["employees"], queryFn: api.getEmployees });
  const { data: salaries = [] } = useQuery({ queryKey: ["salaries"], queryFn: api.getSalaries });
  const { data: chartData = [] } = useQuery({ queryKey: ["chartData"], queryFn: api.getChartData });

  const form = useForm<z.infer<typeof salarySchema>>({
    resolver: zodResolver(salarySchema),
    defaultValues: {
      employeeId: "",
      amount: 0,
      note: "",
    },
  });

  const payMutation = useMutation({
    mutationFn: async (data: z.infer<typeof salarySchema>) => {
      // Stub
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["salaries"] });
      toast({ title: "Salary processed", description: "Payment has been recorded successfully." });
      form.reset();
    }
  });

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Payroll Management</h1>
          <p className="text-muted-foreground text-sm mt-1">Process and track employee compensation.</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <DashboardCard
            label="Total Paid This Month"
            value="₹17,65,000"
            trend={0}
            trendLabel="vs last month"
            icon={<CreditCard className="w-5 h-5" />}
          />
          <div className="md:col-span-2">
            <Card className="h-full border-border/50">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Process Payment</CardTitle>
              </CardHeader>
              <CardContent>
                <Form {...form}>
                  <form onSubmit={form.handleSubmit((d) => payMutation.mutate(d))} className="flex items-end gap-4">
                    <FormField control={form.control} name="employeeId" render={({ field }) => (
                      <FormItem className="flex-1">
                        <FormLabel>Employee</FormLabel>
                        <Select onValueChange={(val) => {
                          field.onChange(val);
                          const emp = employees.find(e => e.id === val);
                          if(emp) form.setValue('amount', Math.round(emp.salary / 12));
                        }} defaultValue={field.value}>
                          <FormControl>
                            <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {employees.filter(e => e.status === 'Active').map(e => (
                              <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="amount" render={({ field }) => (
                      <FormItem className="w-[150px]">
                        <FormLabel>Amount ($)</FormLabel>
                        <FormControl><Input type="number" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <Button type="submit" disabled={payMutation.isPending}>Pay Salary</Button>
                  </form>
                </Form>
              </CardContent>
            </Card>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <Card className="lg:col-span-2 border-border/50">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <History className="w-4 h-4 text-muted-foreground" /> Payment History
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow className="border-border/50">
                    <TableHead>Employee</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Note</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {salaries.map((s) => {
                    const emp = employees.find(e => e.id === s.employeeId);
                    return (
                      <TableRow key={s.id} className="border-border/50">
                        <TableCell className="font-medium">{emp?.name || 'Unknown'}</TableCell>
                        <TableCell className="text-muted-foreground">{format(new Date(s.date), "MMM dd, yyyy")}</TableCell>
                        <TableCell className="text-muted-foreground">{s.note}</TableCell>
                        <TableCell className="text-right font-medium text-foreground">
                          {s.amount.toLocaleString('en-IN', { style: 'currency', currency: 'INR' })}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card className="border-border/50">
            <CardHeader>
              <CardTitle className="text-base">Salary Trend</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[300px] w-full mt-4">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                    <XAxis dataKey="month" stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} />
                    <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} width={40} tickFormatter={(value) => `${value / 1000}k`} />
                    <Tooltip 
                      cursor={{ fill: 'hsl(var(--muted))' }}
                      contentStyle={{ backgroundColor: 'hsl(var(--card))', borderColor: 'hsl(var(--border))', color: 'hsl(var(--foreground))' }}
                    />
                    <Bar dataKey="salary" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </DashboardLayout>
  );
}
