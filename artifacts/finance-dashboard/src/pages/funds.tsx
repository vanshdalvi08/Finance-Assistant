import { useState } from "react";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { api } from "@/lib/api";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { DashboardCard } from "@/components/dashboard-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Area, AreaChart, ResponsiveContainer, Tooltip } from "recharts";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { ArrowDownRight, Plus, Wallet } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

const fundSchema = z.object({
  source: z.string().min(2, "Source is required"),
  amount: z.coerce.number().min(1, "Amount must be positive"),
  date: z.string().min(1, "Date is required"),
  note: z.string().optional(),
});

export default function Funds() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  const { data: funds = [] } = useQuery({
    queryKey: ["funds"],
    queryFn: api.getFunds,
  });
  const { data: chartData = [] } = useQuery({
    queryKey: ["chartData"],
    queryFn: api.getChartData,
  });
  const { data: overview } = useQuery({
    queryKey: ["adminOverview"],
    queryFn: api.getAdminOverview,
  });

  const totalCapitalInflow = funds.reduce((sum, fund) => sum + fund.amount, 0);

  const form = useForm<z.infer<typeof fundSchema>>({
    resolver: zodResolver(fundSchema),
    defaultValues: {
      source: "",
      amount: 0,
      date: new Date().toISOString().split("T")[0],
      note: "",
    },
  });

  const addMutation = useMutation({
    mutationFn: api.addFund,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["funds"] });
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
      queryClient.invalidateQueries({ queryKey: ["chartData"] });
      queryClient.invalidateQueries({ queryKey: ["adminOverview"] });
      toast({ title: "Funds added", description: "Inflow has been recorded successfully." });
      setIsDialogOpen(false);
      form.reset({
        source: "",
        amount: 0,
        date: new Date().toISOString().split("T")[0],
        note: "",
      });
    },
  });

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Funds & Inflows</h1>
            <p className="text-muted-foreground text-sm mt-1">Track revenue, investments, and incoming capital without mixing in vendor purchase orders.</p>
          </div>

          <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="w-4 h-4 mr-2" /> Add Fund
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add Capital Inflow</DialogTitle>
              </DialogHeader>
              <Form {...form}>
                <form onSubmit={form.handleSubmit((data) => addMutation.mutate(data))} className="space-y-4">
                  <FormField
                    control={form.control}
                    name="source"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Source / Origin</FormLabel>
                        <FormControl>
                          <Input placeholder="e.g. Client Retainer, Investor Tranche" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <div className="grid grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="amount"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Amount (INR)</FormLabel>
                          <FormControl>
                            <Input type="number" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="date"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Date</FormLabel>
                          <FormControl>
                            <Input type="date" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                  <FormField
                    control={form.control}
                    name="note"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Note (Optional)</FormLabel>
                        <FormControl>
                          <Input placeholder="Additional details..." {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <Button type="submit" className="w-full mt-4" disabled={addMutation.isPending}>
                    Save Inflow
                  </Button>
                </form>
              </Form>
            </DialogContent>
          </Dialog>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <DashboardCard
            label="Total Capital Inflow"
            value={totalCapitalInflow.toLocaleString("en-IN", { style: "currency", currency: "INR" })}
            icon={<Wallet className="w-5 h-5" />}
          />
          <DashboardCard
            label="Current Balance"
            value={(overview?.currentBalance ?? 0).toLocaleString("en-IN", { style: "currency", currency: "INR" })}
          />
          <DashboardCard
            label="Month-to-Date Funds"
            value={(overview?.monthToDateFunds ?? 0).toLocaleString("en-IN", { style: "currency", currency: "INR" })}
          />
        </div>

        <Card className="border-border/50">
          <CardHeader className="py-4">
            <CardTitle className="text-base">Capital Growth</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[120px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="colorFundsOnly" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <Tooltip
                    contentStyle={{ backgroundColor: "hsl(var(--card))", borderColor: "hsl(var(--border))" }}
                    labelStyle={{ color: "hsl(var(--muted-foreground))" }}
                  />
                  <Area type="monotone" dataKey="funds" stroke="hsl(var(--primary))" fillOpacity={1} fill="url(#colorFundsOnly)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/50">
          <CardHeader>
            <CardTitle className="text-base">Inflow History</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow className="border-border/50">
                  <TableHead>Source</TableHead>
                  <TableHead>Note</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {funds.length === 0 ? (
                  <TableRow className="border-border/50">
                    <TableCell colSpan={4} className="py-10 text-center text-muted-foreground">
                      No inflows recorded yet.
                    </TableCell>
                  </TableRow>
                ) : (
                  funds.map((fund) => (
                    <TableRow key={fund.id} className="border-border/50">
                      <TableCell className="font-medium flex items-center gap-2">
                        <div className="p-1.5 rounded-md bg-primary/10 text-primary">
                          <ArrowDownRight className="w-3.5 h-3.5" />
                        </div>
                        {fund.source}
                      </TableCell>
                      <TableCell className="text-muted-foreground">{fund.note || "-"}</TableCell>
                      <TableCell className="text-muted-foreground">{format(new Date(fund.date), "MMM dd, yyyy")}</TableCell>
                      <TableCell className="text-right font-medium text-primary">
                        +{fund.amount.toLocaleString("en-IN", { style: "currency", currency: "INR" })}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
