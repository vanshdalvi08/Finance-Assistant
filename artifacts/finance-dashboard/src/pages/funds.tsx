import { useMemo, useState, type ChangeEvent } from "react";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { api, type AdminOverview, type ChartPoint, type Fund, type Transaction } from "@/lib/api";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { DashboardCard } from "@/components/dashboard-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis } from "recharts";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { ArrowDownRight, ChevronDown, ChevronRight, Paperclip, Plus, Trash2, Upload, Wallet, X } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { uploadFundReceipt, type UploadedAsset } from "@/lib/uploads";

const fundSchema = z.object({
  source: z.string().min(2, "Source is required"),
  amount: z.coerce.number().min(1, "Amount must be positive"),
  date: z.string().min(1, "Date is required"),
  note: z.string().optional(),
});

function getSafeDate(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function getFundMonthKey(value: string | null | undefined) {
  if (!value || value.length < 7) {
    return "unknown";
  }

  const key = value.slice(0, 7);
  return /^\d{4}-\d{2}$/.test(key) ? key : "unknown";
}

function getFundMonthLabel(key: string) {
  if (key === "unknown") {
    return "Unknown period";
  }

  const monthDate = getSafeDate(`${key}-01T00:00:00`);
  return monthDate ? format(monthDate, "MMMM yyyy") : "Unknown period";
}

function formatFundDate(value: string | null | undefined) {
  const date = getSafeDate(value);
  return date ? format(date, "MMM dd, yyyy") : "Unknown date";
}

function getFundSortTime(value: string | null | undefined) {
  return getSafeDate(value)?.getTime() ?? 0;
}

function updateChartData(current: ChartPoint[] | undefined, fund: Fund) {
  if (!current) {
    return current;
  }

  const monthKey = getFundMonthKey(fund.date);
  if (monthKey === "unknown") {
    return current;
  }

  const next = current.map((point) =>
    point.month === monthKey ? { ...point, funds: point.funds + fund.amount } : point,
  );

  if (next.some((point) => point.month === monthKey)) {
    return next;
  }

  return [...current, { month: monthKey, funds: fund.amount, expenses: 0, salary: 0 }].sort((left, right) =>
    left.month.localeCompare(right.month),
  );
}

function updateOverview(current: AdminOverview | undefined, fund: Fund) {
  if (!current) {
    return current;
  }

  const fundDate = new Date(fund.date);
  const currentMonth = new Date().toISOString().slice(0, 7);
  const currentYear = new Date().getFullYear();
  const fundMonth = getFundMonthKey(fund.date);
  const safeFundDate = getSafeDate(fund.date);

  return {
    ...current,
    totalFunds: current.totalFunds + fund.amount,
    currentBalance: current.currentBalance + fund.amount,
    monthToDateFunds: current.monthToDateFunds + (fundMonth === currentMonth ? fund.amount : 0),
    yearToDateFunds: current.yearToDateFunds + (safeFundDate?.getFullYear() === currentYear ? fund.amount : 0),
  };
}

function updateTransactions(current: Transaction[] | undefined, fund: Fund) {
  if (!current) {
    return current;
  }

  const nextTransaction: Transaction = {
    id: `txn_${fund.id}`,
    type: "fund",
    amount: fund.amount,
    date: fund.date,
    description: fund.source,
    category: fund.source,
  };

  return [nextTransaction, ...current.filter((transaction) => transaction.id !== nextTransaction.id)];
}

function removeOverview(current: AdminOverview | undefined, fund: Fund) {
  if (!current) {
    return current;
  }

  const currentMonth = new Date().toISOString().slice(0, 7);
  const currentYear = new Date().getFullYear();
  const fundMonth = getFundMonthKey(fund.date);
  const safeFundDate = getSafeDate(fund.date);

  return {
    ...current,
    totalFunds: Math.max(0, current.totalFunds - fund.amount),
    currentBalance: current.currentBalance - fund.amount,
    monthToDateFunds: current.monthToDateFunds - (fundMonth === currentMonth ? fund.amount : 0),
    yearToDateFunds: current.yearToDateFunds - (safeFundDate?.getFullYear() === currentYear ? fund.amount : 0),
  };
}

function removeChartData(current: ChartPoint[] | undefined, fund: Fund) {
  if (!current) {
    return current;
  }

  const monthKey = getFundMonthKey(fund.date);
  if (monthKey === "unknown") {
    return current;
  }

  return current.map((point) =>
    point.month === monthKey ? { ...point, funds: Math.max(0, point.funds - fund.amount) } : point,
  );
}

function removeTransactions(current: Transaction[] | undefined, fund: Fund) {
  if (!current) {
    return current;
  }

  return current.filter((transaction) => transaction.id !== `txn_${fund.id}`);
}

export default function Funds() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [showPreviousInflows, setShowPreviousInflows] = useState(false);
  const [openHistoryMonth, setOpenHistoryMonth] = useState<string | null>(null);
  const [receiptFile, setReceiptFile] = useState<UploadedAsset | null>(null);
  const [isUploadingReceipt, setIsUploadingReceipt] = useState(false);
  const [fundToDelete, setFundToDelete] = useState<Fund | null>(null);

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
  const simplifiedChartData = useMemo(
    () =>
      chartData.map((point) => ({
        ...point,
        label: point.month,
      })),
    [chartData],
  );
  const fundGroups = useMemo(() => {
    const groups = new Map<
      string,
      { key: string; label: string; funds: Fund[]; total: number }
    >();

    for (const fund of [...funds].sort((left, right) => getFundSortTime(right.date) - getFundSortTime(left.date))) {
      const key = getFundMonthKey(fund.date);
      const group =
        groups.get(key) ??
        {
          key,
          label: getFundMonthLabel(key),
          funds: [],
          total: 0,
        };
      group.funds.push(fund);
      group.total += fund.amount;
      groups.set(key, group);
    }

    return Array.from(groups.values()).sort((left, right) => {
      if (left.key === "unknown") return 1;
      if (right.key === "unknown") return -1;
      return right.key.localeCompare(left.key);
    });
  }, [funds]);
  const latestFundGroup = fundGroups[0] ?? null;
  const previousFundGroups = fundGroups.slice(1);
  const activeHistoryMonth =
    openHistoryMonth && previousFundGroups.some((group) => group.key === openHistoryMonth)
      ? openHistoryMonth
      : previousFundGroups[0]?.key ?? null;

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
    mutationFn: async (data: z.infer<typeof fundSchema>) =>
      api.addFund({
        ...data,
        receiptName: receiptFile?.fileName,
        receiptPath: receiptFile?.path,
      }),
    onSuccess: (createdFund) => {
      queryClient.setQueryData<Fund[]>(["funds"], (current = []) => [
        createdFund,
        ...current.filter((fund) => fund.id !== createdFund.id),
      ]);
      queryClient.setQueryData<ChartPoint[]>(["chartData"], (current) => updateChartData(current, createdFund));
      queryClient.setQueryData<AdminOverview>(["adminOverview"], (current) => updateOverview(current, createdFund));
      queryClient.setQueryData<Transaction[]>(["transactions"], (current) => updateTransactions(current, createdFund));
      toast({ title: "Funds added", description: "Inflow has been recorded successfully." });
      setIsDialogOpen(false);
      setReceiptFile(null);
      form.reset({
        source: "",
        amount: 0,
        date: new Date().toISOString().split("T")[0],
        note: "",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (fund: Fund) => {
      await api.deleteFund(fund.id);
      return fund;
    },
    onSuccess: (deletedFund) => {
      queryClient.setQueryData<Fund[]>(["funds"], (current = []) => current.filter((fund) => fund.id !== deletedFund.id));
      queryClient.setQueryData<ChartPoint[]>(["chartData"], (current) => removeChartData(current, deletedFund));
      queryClient.setQueryData<AdminOverview>(["adminOverview"], (current) => removeOverview(current, deletedFund));
      queryClient.setQueryData<Transaction[]>(["transactions"], (current) => removeTransactions(current, deletedFund));
      setFundToDelete(null);
      toast({
        title: "Fund removed",
        description: `${deletedFund.source} was removed from your inflows.`,
      });
    },
    onError: (error) => {
      toast({
        title: "Could not remove fund",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    },
  });

  async function handleReceiptChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    try {
      setIsUploadingReceipt(true);
      const uploaded = await uploadFundReceipt(file);
      setReceiptFile(uploaded);
      toast({
        title: "Receipt uploaded",
        description: "The receipt will be saved with this fund entry.",
      });
    } catch (error) {
      setReceiptFile(null);
      toast({
        title: "Could not upload receipt",
        description: error instanceof Error ? error.message : "Please try another file.",
        variant: "destructive",
      });
    } finally {
      setIsUploadingReceipt(false);
      event.target.value = "";
    }
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Funds & Inflows</h1>
            <p className="text-muted-foreground text-sm mt-1">Track revenue, investments, and incoming capital without mixing in vendor purchase orders.</p>
          </div>

          <Dialog
            open={isDialogOpen}
            onOpenChange={(open) => {
              setIsDialogOpen(open);
              if (!open) {
                setReceiptFile(null);
                setIsUploadingReceipt(false);
              }
            }}
          >
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
                  <div className="space-y-2">
                    <label className="text-sm font-medium leading-none text-foreground">Receipt (Optional)</label>
                    <div className="flex flex-col gap-3 rounded-xl border border-dashed border-border/60 bg-secondary/10 p-4 sm:flex-row sm:items-center sm:justify-between">
                      <div className="space-y-1">
                        <p className="text-sm font-medium">Attach a fund receipt</p>
                        <p className="text-xs text-muted-foreground">
                          Upload a PDF or image from Supabase storage for later reference.
                        </p>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        className="gap-2"
                        disabled={isUploadingReceipt}
                        onClick={() => document.getElementById("fund-receipt-input")?.click()}
                      >
                        <Upload className="h-4 w-4" />
                        {isUploadingReceipt ? "Uploading..." : receiptFile ? "Replace receipt" : "Upload receipt"}
                      </Button>
                    </div>
                    <input
                      id="fund-receipt-input"
                      type="file"
                      accept="image/*,application/pdf"
                      className="hidden"
                      onChange={handleReceiptChange}
                    />
                    {receiptFile ? (
                      <div className="flex items-center justify-between rounded-lg border border-border/60 bg-background/60 px-3 py-2 text-sm">
                        <div className="flex items-center gap-2 overflow-hidden">
                          <Paperclip className="h-4 w-4 shrink-0 text-muted-foreground" />
                          <a
                            href={receiptFile.url}
                            target="_blank"
                            rel="noreferrer"
                            className="truncate text-primary underline-offset-4 hover:underline"
                          >
                            {receiptFile.fileName}
                          </a>
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => setReceiptFile(null)}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    ) : null}
                  </div>
                  <Button type="submit" className="w-full mt-4" disabled={addMutation.isPending || isUploadingReceipt}>
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
            <CardTitle className="text-base">Capital Inflow Trend</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2 text-sm">
              <p className="text-muted-foreground">A simple month-by-month view of funds added to the business.</p>
              <div className="rounded-xl border border-border/60 bg-secondary/10 px-3 py-1.5 text-xs text-muted-foreground">
                Hover on the line to see the exact month and amount.
              </div>
            </div>
            <div className="h-[210px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={simplifiedChartData} margin={{ top: 12, right: 12, left: 8, bottom: 0 }}>
                  <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" vertical={false} opacity={0.35} />
                  <XAxis
                    dataKey="label"
                    tickLine={false}
                    axisLine={false}
                    tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }}
                  />
                  <Tooltip
                    contentStyle={{ backgroundColor: "hsl(var(--card))", borderColor: "hsl(var(--border))" }}
                    labelStyle={{ color: "hsl(var(--muted-foreground))" }}
                    labelFormatter={(label) => `Month: ${label}`}
                    formatter={(value) => [formatCurrency(Number(value)), "Funds Added"]}
                  />
                  <Line
                    type="monotone"
                    dataKey="funds"
                    stroke="hsl(var(--primary))"
                    strokeWidth={3}
                    dot={{ r: 4, strokeWidth: 2, fill: "hsl(var(--background))" }}
                    activeDot={{ r: 5 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/50">
          <CardHeader>
            <CardTitle className="text-base">Recent Inflows</CardTitle>
          </CardHeader>
          <CardContent>
            {!latestFundGroup ? (
              <div className="py-10 text-center text-muted-foreground">No inflows recorded yet.</div>
            ) : (
              <div className="space-y-4">
                <div className="flex items-center justify-between rounded-xl border border-border/60 bg-secondary/10 px-4 py-3">
                  <div>
                    <p className="text-sm font-medium">{latestFundGroup.label}</p>
                    <p className="text-xs text-muted-foreground">
                      {latestFundGroup.funds.length} inflow{latestFundGroup.funds.length !== 1 ? "s" : ""}
                    </p>
                  </div>
                  <p className="text-sm font-semibold text-primary">{formatCurrency(latestFundGroup.total)}</p>
                </div>

                <Table>
                  <TableHeader>
                    <TableRow className="border-border/50">
                      <TableHead>Source</TableHead>
                      <TableHead>Note</TableHead>
                      <TableHead>Receipt</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead className="w-[56px] text-right"> </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {latestFundGroup.funds.map((fund) => (
                      <TableRow key={fund.id} className="border-border/50">
                        <TableCell className="font-medium flex items-center gap-2">
                          <div className="p-1.5 rounded-md bg-primary/10 text-primary">
                            <ArrowDownRight className="w-3.5 h-3.5" />
                          </div>
                          {fund.source}
                        </TableCell>
                        <TableCell className="text-muted-foreground">{fund.note || "-"}</TableCell>
                        <TableCell className="text-muted-foreground">
                          {fund.receiptUrl ? (
                            <a
                              href={fund.receiptUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline"
                            >
                              <Paperclip className="h-3.5 w-3.5" />
                              {fund.receiptName || "View"}
                            </a>
                          ) : (
                            "-"
                          )}
                        </TableCell>
                        <TableCell className="text-muted-foreground">{formatFundDate(fund.date)}</TableCell>
                        <TableCell className="text-right font-medium text-primary">
                          +{fund.amount.toLocaleString("en-IN", { style: "currency", currency: "INR" })}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                            onClick={() => setFundToDelete(fund)}
                            title={`Delete ${fund.source}`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        {previousFundGroups.length > 0 ? (
          <div className="flex justify-end">
            <Button
              variant="ghost"
              size="sm"
              className="rounded-full px-4 text-muted-foreground hover:bg-secondary/70 hover:text-foreground"
              onClick={() => setShowPreviousInflows((current) => !current)}
            >
              {showPreviousInflows ? "Hide Previous Inflows" : `Previous Inflows (${previousFundGroups.length})`}
            </Button>
          </div>
        ) : null}

        {showPreviousInflows && previousFundGroups.length > 0 ? (
          <Card className="border-border/50">
            <CardHeader>
              <CardTitle className="text-base">Previous Inflows</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {previousFundGroups.map((group) => {
                const isOpen = group.key === activeHistoryMonth;

                return (
                  <Card key={group.key} className="border-border/50 shadow-none">
                    <button
                      type="button"
                      className="flex w-full items-center justify-between gap-4 px-4 py-3 text-left"
                      onClick={() => setOpenHistoryMonth((current) => (current === group.key ? null : group.key))}
                    >
                      <div className="flex items-center gap-2">
                        {isOpen ? (
                          <ChevronDown className="h-4 w-4 text-muted-foreground" />
                        ) : (
                          <ChevronRight className="h-4 w-4 text-muted-foreground" />
                        )}
                        <div>
                          <p className="font-medium text-foreground">{group.label}</p>
                          <p className="text-xs text-muted-foreground">
                            {group.funds.length} inflow{group.funds.length !== 1 ? "s" : ""}
                          </p>
                        </div>
                      </div>
                      <p className="text-sm font-semibold text-primary">{formatCurrency(group.total)}</p>
                    </button>

                    {isOpen ? (
                      <CardContent className="pt-0">
                        <Table>
                          <TableHeader>
                            <TableRow className="border-border/50">
                              <TableHead>Source</TableHead>
                              <TableHead>Note</TableHead>
                              <TableHead>Receipt</TableHead>
                              <TableHead>Date</TableHead>
                              <TableHead className="text-right">Amount</TableHead>
                              <TableHead className="w-[56px] text-right"> </TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {group.funds.map((fund) => (
                              <TableRow key={fund.id} className="border-border/50">
                                <TableCell className="font-medium">{fund.source}</TableCell>
                                <TableCell className="text-muted-foreground">{fund.note || "-"}</TableCell>
                                <TableCell className="text-muted-foreground">
                                  {fund.receiptUrl ? (
                                    <a
                                      href={fund.receiptUrl}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline"
                                    >
                                      <Paperclip className="h-3.5 w-3.5" />
                                      {fund.receiptName || "View"}
                                    </a>
                                  ) : (
                                    "-"
                                  )}
                                </TableCell>
                                <TableCell className="text-muted-foreground">{formatFundDate(fund.date)}</TableCell>
                                <TableCell className="text-right font-medium text-primary">
                                  +{fund.amount.toLocaleString("en-IN", { style: "currency", currency: "INR" })}
                                </TableCell>
                                <TableCell className="text-right">
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                                    onClick={() => setFundToDelete(fund)}
                                    title={`Delete ${fund.source}`}
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </Button>
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </CardContent>
                    ) : null}
                  </Card>
                );
              })}
            </CardContent>
          </Card>
        ) : null}

        <AlertDialog open={Boolean(fundToDelete)} onOpenChange={(open) => !open && setFundToDelete(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete this fund entry?</AlertDialogTitle>
              <AlertDialogDescription>
                {fundToDelete
                  ? `This will remove the inflow from ${fundToDelete.source} dated ${formatFundDate(fundToDelete.date)} for ${formatCurrency(fundToDelete.amount)}.`
                  : "This fund entry will be removed."}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={deleteMutation.isPending}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                disabled={deleteMutation.isPending || !fundToDelete}
                onClick={(event) => {
                  event.preventDefault();
                  if (!fundToDelete) {
                    return;
                  }
                  deleteMutation.mutate(fundToDelete);
                }}
              >
                {deleteMutation.isPending ? "Deleting..." : "Delete Fund"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </DashboardLayout>
  );
}

function formatCurrency(value: number) {
  return value.toLocaleString("en-IN", { style: "currency", currency: "INR" });
}
