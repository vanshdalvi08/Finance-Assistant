import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { api } from "@/lib/api";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { DashboardCard } from "@/components/dashboard-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from "recharts";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { Receipt, Plus, ArrowUpRight } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";

const expenseSchema = z.object({
  category: z.string().min(2, "Category is required"),
  amount: z.coerce.number().min(1, "Amount must be positive"),
  date: z.string().min(1, "Date is required"),
  description: z.string().min(2, "Description is required"),
});

const CATEGORY_COLORS: Record<string, string> = {
  Software: "hsl(var(--chart-1))",
  Office: "hsl(var(--chart-2))",
  Travel: "hsl(var(--chart-3))",
  Marketing: "hsl(var(--chart-4))",
  Legal: "hsl(var(--chart-5))",
};

export default function Expenses() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  
  const { data: expenses = [] } = useQuery({ queryKey: ["expenses"], queryFn: api.getExpenses });
  const { data: categories = [] } = useQuery({ queryKey: ["expenseCategories"], queryFn: api.getExpenseCategories });

  const form = useForm<z.infer<typeof expenseSchema>>({
    resolver: zodResolver(expenseSchema),
    defaultValues: {
      category: "",
      amount: 0,
      date: new Date().toISOString().split('T')[0],
      description: "",
    },
  });

  const addMutation = useMutation({
    mutationFn: async (data: z.infer<typeof expenseSchema>) => {
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["expenses"] });
      toast({ title: "Expense logged", description: "Expense has been recorded successfully." });
      setIsDialogOpen(false);
      form.reset();
    }
  });

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Expenses</h1>
            <p className="text-muted-foreground text-sm mt-1">Monitor operational costs and vendor payments.</p>
          </div>
          
          <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogTrigger asChild>
              <Button><Plus className="w-4 h-4 mr-2" /> Log Expense</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Log New Expense</DialogTitle>
              </DialogHeader>
              <Form {...form}>
                <form onSubmit={form.handleSubmit((d) => addMutation.mutate(d))} className="space-y-4">
                  <FormField control={form.control} name="description" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Description / Vendor</FormLabel>
                      <FormControl><Input placeholder="e.g. AWS Web Services" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <div className="grid grid-cols-2 gap-4">
                    <FormField control={form.control} name="amount" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Amount ($)</FormLabel>
                        <FormControl><Input type="number" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="category" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Category</FormLabel>
                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                          <FormControl>
                            <SelectTrigger><SelectValue placeholder="Select..." /></SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {Object.keys(CATEGORY_COLORS).map(cat => (
                              <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )} />
                  </div>
                  <FormField control={form.control} name="date" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Date</FormLabel>
                      <FormControl><Input type="date" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <Button type="submit" className="w-full mt-4" disabled={addMutation.isPending}>Save Expense</Button>
                </form>
              </Form>
            </DialogContent>
          </Dialog>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <DashboardCard
            label="Total Expenses YTD"
            value="$265,000"
            trend={-4.2}
            trendLabel="vs last year"
            icon={<Receipt className="w-5 h-5" />}
          />
          <Card className="md:col-span-2 border-border/50">
            <CardHeader className="py-4">
              <CardTitle className="text-base">Breakdown by Category</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[200px] w-full flex items-center">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={categories}
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={80}
                      paddingAngle={2}
                      dataKey="value"
                      stroke="none"
                    >
                      {categories.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={CATEGORY_COLORS[entry.name] || 'hsl(var(--primary))'} />
                      ))}
                    </Pie>
                    <Tooltip 
                      formatter={(value: number) => `$${value.toLocaleString()}`}
                      contentStyle={{ backgroundColor: 'hsl(var(--card))', borderColor: 'hsl(var(--border))', borderRadius: '8px' }}
                    />
                    <Legend verticalAlign="middle" align="right" layout="vertical" />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card className="border-border/50">
          <CardHeader>
            <CardTitle className="text-base">Expense Log</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow className="border-border/50">
                  <TableHead>Description</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {expenses.map((e) => (
                  <TableRow key={e.id} className="border-border/50">
                    <TableCell className="font-medium flex items-center gap-2">
                      <div className="p-1.5 rounded-md bg-secondary/50 text-foreground">
                        <ArrowUpRight className="w-3.5 h-3.5" />
                      </div>
                      {e.description}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="font-normal" style={{ borderColor: CATEGORY_COLORS[e.category] }}>
                        <span className="w-1.5 h-1.5 rounded-full mr-2" style={{ backgroundColor: CATEGORY_COLORS[e.category] }}></span>
                        {e.category}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{format(new Date(e.date), "MMM dd, yyyy")}</TableCell>
                    <TableCell className="text-right font-medium">
                      {e.amount.toLocaleString('en-US', { style: 'currency', currency: 'USD' })}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
