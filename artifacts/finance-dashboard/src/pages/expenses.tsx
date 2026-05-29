import { useEffect, useMemo, useState, type ChangeEvent } from "react";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { api, Expense, ExpenseCategory, type FinancialAccount } from "@/lib/api";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { DashboardCard } from "@/components/dashboard-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { uploadExpenseAttachment } from "@/lib/uploads";
import {
  Receipt, Plus, ArrowUpRight, Upload, SlidersHorizontal, X, Home, Building2, Check, Ban
} from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/store/auth";

const expenseSchema = z.object({
  group: z.enum(["personal", "office"]),
  category: z.string().min(1, "Category is required"),
  project: z.string().optional(),
  amount: z.coerce.number().min(1, "Amount must be positive"),
  date: z.string().min(1, "Date is required"),
  description: z.string().min(2, "Description is required"),
  note: z.string().optional(),
  attachmentName: z.string().optional(),
});

type ExpenseForm = z.infer<typeof expenseSchema>;
type ExpenseEntryMode = "review_flow" | "historical_paid";

function isLegacyDefaultAccount(account: FinancialAccount) {
  return account.id.startsWith("acct_operational_");
}

function accountDisplayName(account: FinancialAccount) {
  const typeLabel =
    account.accountType === "mixed_use"
      ? "Mixed Use"
      : account.accountType === "operational"
        ? "Main"
        : account.accountType === "reserve"
          ? "Reserve"
          : account.accountType === "cash"
            ? "Cash"
            : "Personal";

  return `${account.name} • ${typeLabel}`;
}

function isPendingExpense(status: Expense["status"]) {
  return status === "submitted" || status === "draft";
}

function patchExpenseList(current: Expense[] | undefined, nextExpense: Expense) {
  if (!current) {
    return [nextExpense];
  }

  const existingIndex = current.findIndex((expense) => expense.id === nextExpense.id);
  if (existingIndex === -1) {
    return [nextExpense, ...current];
  }

  return current.map((expense) => (expense.id === nextExpense.id ? nextExpense : expense));
}

function ExpenseTable({
  expenses,
  categories,
  group,
  accounts = [],
  onReview,
  onReviewAccountChange,
  reviewAccountIds = {},
  isReviewing = false,
}: {
  expenses: Expense[];
  categories: ExpenseCategory[];
  group: "personal" | "office";
  accounts?: FinancialAccount[];
  onReview?: (id: string, status: "approved" | "rejected", accountId?: string) => void;
  onReviewAccountChange?: (id: string, accountId: string) => void;
  reviewAccountIds?: Record<string, string>;
  isReviewing?: boolean;
}) {
  const [filterCategory, setFilterCategory] = useState("all");
  const [filterDateFrom, setFilterDateFrom] = useState("");
  const [filterDateTo, setFilterDateTo] = useState("");
  const [filterAmountMin, setFilterAmountMin] = useState("");
  const [filterAmountMax, setFilterAmountMax] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  const groupCats = categories.filter((c) => c.group === group);
  const groupExpenses = expenses.filter((e) => e.group === group);

  const getCatColor = (name: string) =>
    groupCats.find((c) => c.name === name)?.color ?? "#6366f1";

  const filtered = groupExpenses.filter((e) => {
    if (filterCategory !== "all" && e.category !== filterCategory) return false;
    if (filterDateFrom && e.date < filterDateFrom) return false;
    if (filterDateTo && e.date > filterDateTo + "T23:59:59Z") return false;
    if (filterAmountMin && e.amount < Number(filterAmountMin)) return false;
    if (filterAmountMax && e.amount > Number(filterAmountMax)) return false;
    return true;
  });
  const activeExpenses = onReview ? filtered.filter((expense) => expense.status === "submitted") : filtered;
  const historyExpenses = onReview ? filtered.filter((expense) => expense.status !== "submitted") : [];

  const total = filtered.reduce((s, e) => s + e.amount, 0);

  const hasFilter =
    filterCategory !== "all" || filterDateFrom || filterDateTo || filterAmountMin || filterAmountMax;

  function clearFilters() {
    setFilterCategory("all");
    setFilterDateFrom("");
    setFilterDateTo("");
    setFilterAmountMin("");
    setFilterAmountMax("");
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex flex-wrap gap-2">
          {groupCats.map((cat) => (
            <button
              key={cat.id}
              onClick={() =>
                setFilterCategory(filterCategory === cat.name ? "all" : cat.name)
              }
              className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium border transition-all"
              style={{
                backgroundColor:
                  filterCategory === cat.name ? cat.color + "22" : "transparent",
                borderColor: cat.color + "55",
                color: filterCategory === cat.name ? cat.color : undefined,
              }}
            >
              <span
                className="w-2 h-2 rounded-full"
                style={{ backgroundColor: cat.color }}
              />
              {cat.name}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          {hasFilter && (
            <Button variant="ghost" size="sm" onClick={clearFilters} className="h-8 text-xs gap-1">
              <X className="w-3 h-3" /> Clear
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-xs gap-1.5"
            onClick={() => setShowFilters((v) => !v)}
          >
            <SlidersHorizontal className="w-3.5 h-3.5" /> Filters
          </Button>
        </div>
      </div>

      {showFilters && (
        <Card className="border-border/50 bg-secondary/10">
          <CardContent className="pt-4 pb-3">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">From Date</Label>
                <Input
                  type="date"
                  className="h-8 text-xs"
                  value={filterDateFrom}
                  onChange={(e) => setFilterDateFrom(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">To Date</Label>
                <Input
                  type="date"
                  className="h-8 text-xs"
                  value={filterDateTo}
                  onChange={(e) => setFilterDateTo(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Min Amount (₹)</Label>
                <Input
                  type="number"
                  placeholder="0"
                  className="h-8 text-xs"
                  value={filterAmountMin}
                  onChange={(e) => setFilterAmountMin(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Max Amount (₹)</Label>
                <Input
                  type="number"
                  placeholder="Any"
                  className="h-8 text-xs"
                  value={filterAmountMax}
                  onChange={(e) => setFilterAmountMax(e.target.value)}
                />
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <Card className="border-border/50">
        <CardHeader className="py-3 px-5 flex flex-row items-center justify-between">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            {(onReview ? activeExpenses : filtered).length} active record{(onReview ? activeExpenses : filtered).length !== 1 ? "s" : ""}
          </CardTitle>
          <span className="text-sm font-semibold">
            Total:{" "}
            {total.toLocaleString("en-IN", { style: "currency", currency: "INR" })}
          </span>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="border-border/50">
                <TableHead>Description</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(onReview ? activeExpenses : filtered).length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-10 text-muted-foreground text-sm">
                    {onReview ? "No active expense requests." : "No expenses found."}
                  </TableCell>
                </TableRow>
              ) : (
                (onReview ? activeExpenses : filtered).map((e) => {
                  const color = getCatColor(e.category);
                  return (
                    <TableRow key={e.id} className="border-border/50 hover:bg-secondary/10">
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-2">
                          <div className="p-1.5 rounded-md bg-secondary/50">
                            <ArrowUpRight className="w-3.5 h-3.5 text-muted-foreground" />
                          </div>
                          <div>
                            <div>{e.description}</div>
                            {e.project ? (
                              <div className="text-xs font-normal text-muted-foreground mt-0.5">
                                Project: {e.project}
                              </div>
                            ) : null}
                            {e.employeeNameSnapshot && (
                              <div className="text-xs font-normal text-muted-foreground mt-0.5">
                                {e.employeeNameSnapshot}
                              </div>
                            )}
                            {e.attachmentUrl ? (
                              <a
                                href={e.attachmentUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="text-xs font-normal text-primary hover:underline mt-0.5 inline-block"
                              >
                                {e.attachmentName || "Open attachment"}
                              </a>
                            ) : null}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className="font-normal text-xs"
                          style={{ borderColor: color + "66" }}
                        >
                          <span
                            className="w-1.5 h-1.5 rounded-full mr-1.5"
                            style={{ backgroundColor: color }}
                          />
                          {e.category}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {format(new Date(e.date), "MMM dd, yyyy")}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={cn(
                            "font-normal text-xs capitalize",
                            e.status === "approved" && "border-emerald-500/30 text-emerald-400",
                            e.status === "submitted" && "border-amber-500/30 text-amber-400",
                            e.status === "rejected" && "border-rose-500/30 text-rose-400",
                            e.status === "draft" && "border-border text-muted-foreground",
                          )}
                        >
                          {e.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {e.amount.toLocaleString("en-IN", {
                          style: "currency",
                          currency: "INR",
                        })}
                      </TableCell>
                      <TableCell className="text-right">
                        {e.status === "submitted" && onReview ? (
                          <div className="flex justify-end gap-2">
                            <Select
                              value={reviewAccountIds[e.id] ?? e.accountId ?? ""}
                              onValueChange={(value) => onReviewAccountChange?.(e.id, value)}
                            >
                              <SelectTrigger className="h-8 w-[190px] rounded-full border-border/60 bg-background/70 text-xs">
                                <SelectValue placeholder="Paid Through" />
                              </SelectTrigger>
                              <SelectContent>
                                {accounts.filter((account) => account.isActive).map((account) => (
                                  <SelectItem key={account.id} value={account.id}>
                                    {accountDisplayName(account)}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-emerald-400 hover:text-emerald-300"
                              disabled={isReviewing || !(reviewAccountIds[e.id] ?? e.accountId)}
                              onClick={() => onReview(e.id, "approved", reviewAccountIds[e.id] ?? e.accountId)}
                            >
                              <Check className="w-4 h-4" />
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-rose-400 hover:text-rose-300"
                              disabled={isReviewing}
                              onClick={() => onReview(e.id, "rejected", reviewAccountIds[e.id] ?? e.accountId)}
                            >
                              <Ban className="w-4 h-4" />
                            </Button>
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">-</span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {onReview && historyExpenses.length > 0 ? (
        <div className="flex justify-end">
          <Button
            variant="ghost"
            size="sm"
            className="rounded-full px-4 text-muted-foreground hover:bg-secondary/70 hover:text-foreground"
            onClick={() => setShowHistory((current) => !current)}
          >
            {showHistory ? "Hide Processed Requests" : `Previous Expense History (${historyExpenses.length})`}
          </Button>
        </div>
      ) : null}

      {onReview && showHistory && historyExpenses.length > 0 ? (
        <Card className="border-border/50">
          <CardHeader className="py-3 px-5">
            <CardTitle className="text-sm font-medium">Previous Expense History</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="border-border/50">
                  <TableHead>Description</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {historyExpenses.map((e) => {
                  const color = getCatColor(e.category);
                  return (
                    <TableRow key={e.id} className="border-border/50 hover:bg-secondary/10">
                      <TableCell className="font-medium">
                        <div>{e.description}</div>
                        {e.employeeNameSnapshot ? (
                          <div className="mt-0.5 text-xs font-normal text-muted-foreground">{e.employeeNameSnapshot}</div>
                        ) : null}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="font-normal text-xs" style={{ borderColor: color + "66" }}>
                          <span className="mr-1.5 h-1.5 w-1.5 rounded-full" style={{ backgroundColor: color }} />
                          {e.category}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {format(new Date(e.date), "MMM dd, yyyy")}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={cn(
                            "font-normal text-xs capitalize",
                            e.status === "approved" && "border-emerald-500/30 text-emerald-400",
                            e.status === "rejected" && "border-rose-500/30 text-rose-400",
                            e.status === "draft" && "border-border text-muted-foreground",
                          )}
                        >
                          {e.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {e.amount.toLocaleString("en-IN", { style: "currency", currency: "INR" })}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

export default function Expenses() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const role = useAuthStore((state) => state.role);
  const isAdmin = role === "admin";
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<"personal" | "office">("office");
  const [fileSelected, setFileSelected] = useState<string>("");
  const [attachmentPath, setAttachmentPath] = useState<string>("");
  const [isUploadingAttachment, setIsUploadingAttachment] = useState(false);
  const [selectedAccountId, setSelectedAccountId] = useState("");
  const [entryMode, setEntryMode] = useState<ExpenseEntryMode>("review_flow");
  const [reviewAccountIds, setReviewAccountIds] = useState<Record<string, string>>({});

  const { data: expenses = [] } = useQuery({
    queryKey: ["expenses"],
    queryFn: () => api.getExpenses(),
  });
  const { data: categories = [] } = useQuery({
    queryKey: ["categories"],
    queryFn: api.getCategories,
  });
  const { data: financialAccounts = [] } = useQuery({
    queryKey: ["financialAccounts"],
    queryFn: api.getFinancialAccounts,
  });
  const { data: adminOverview } = useQuery({
    queryKey: ["adminOverview"],
    queryFn: api.getAdminOverview,
    enabled: isAdmin,
  });

  const activeAccounts = useMemo(
    () => financialAccounts.filter((account) => account.isActive),
    [financialAccounts],
  );
  const accountBalances = useMemo(
    () => new Map((adminOverview?.financialAccounts ?? []).map((account) => [account.id, account.balance])),
    [adminOverview?.financialAccounts],
  );

  useEffect(() => {
    if (selectedAccountId || financialAccounts.length === 0) {
      return;
    }

    const preferred = financialAccounts.find(
      (account) => account.accountType === "operational" && account.isActive && !isLegacyDefaultAccount(account),
    )
      ?? activeAccounts.find((account) => !isLegacyDefaultAccount(account))
      ?? activeAccounts[0]
      ?? financialAccounts[0];
    if (preferred) {
      setSelectedAccountId(preferred.id);
    }
  }, [activeAccounts, financialAccounts, selectedAccountId]);

  const form = useForm<ExpenseForm>({
    resolver: zodResolver(expenseSchema),
    defaultValues: {
      group: "office",
      category: "",
      project: "",
      amount: 0,
      date: new Date().toISOString().split("T")[0],
      description: "",
      note: "",
      attachmentName: "",
    },
  });

  const watchGroup = form.watch("group");

  const addMutation = useMutation({
    mutationFn: async ({ note: _note, ...data }: ExpenseForm) => {
      const payload = {
        accountId: selectedAccountId || undefined,
        ...data,
        attachmentPath: attachmentPath.trim() || undefined,
      };

      return isAdmin && entryMode === "historical_paid"
        ? api.recordHistoricalExpense(payload)
        : api.addExpense(payload);
    },
    onSuccess: (createdExpense) => {
      queryClient.setQueryData<Expense[]>(["expenses"], (current) => patchExpenseList(current, createdExpense));
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: ["adminOverview"] }),
        queryClient.invalidateQueries({ queryKey: ["chartData"] }),
        queryClient.invalidateQueries({ queryKey: ["transactions"] }),
      ]);
      toast({
        title: entryMode === "historical_paid" ? "Historical expense recorded" : "Expense logged",
        description:
          entryMode === "historical_paid"
            ? "The older expense was recorded as already paid and posted to the selected account."
            : "Expense recorded successfully.",
      });
      setIsDialogOpen(false);
      setFileSelected("");
      setAttachmentPath("");
      setIsUploadingAttachment(false);
      setEntryMode("review_flow");
      form.reset();
    },
  });

  const selectedAccount = activeAccounts.find((account) => account.id === selectedAccountId) ?? null;
  const selectedAccountBalance = selectedAccount ? accountBalances.get(selectedAccount.id) ?? null : null;

  async function handleAttachmentChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    try {
      setIsUploadingAttachment(true);
      const uploaded = await uploadExpenseAttachment(file);
      form.setValue("attachmentName", uploaded.fileName, {
        shouldDirty: true,
        shouldValidate: true,
      });
      setAttachmentPath(uploaded.path ?? "");
      setFileSelected(uploaded.fileName);
    } catch (error) {
      toast({
        title: "Could not upload attachment",
        description: error instanceof Error ? error.message : "Please try another file.",
        variant: "destructive",
      });
      form.setValue("attachmentName", "", { shouldDirty: true, shouldValidate: true });
      setAttachmentPath("");
      setFileSelected("");
    } finally {
      setIsUploadingAttachment(false);
      event.target.value = "";
    }
  }
  const reviewMutation = useMutation({
    mutationFn: ({ id, status, accountId }: { id: string; status: "approved" | "rejected"; accountId?: string }) =>
      api.updateExpenseStatus(id, status, undefined, accountId),
    onSuccess: async (updatedExpense, variables) => {
      queryClient.setQueryData<Expense[]>(["expenses"], (current) => patchExpenseList(current, updatedExpense));
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["adminOverview"] }),
        queryClient.invalidateQueries({ queryKey: ["chartData"] }),
        queryClient.invalidateQueries({ queryKey: ["transactions"] }),
        queryClient.invalidateQueries({ queryKey: ["notifications"] }),
      ]);
      toast({
        title: variables.status === "approved" ? "Expense approved" : "Expense rejected",
        description:
          variables.status === "approved"
            ? "The request was approved and the ledger was updated."
            : "The request was rejected and the employee view was updated.",
      });
    },
    onError: (error) => {
      toast({
        title: "Could not review expense",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    },
  });

  const personalTotal = expenses
    .filter((e) => e.group === "personal")
    .reduce((s, e) => s + e.amount, 0);

  const officeTotal = expenses
    .filter((e) => e.group === "office")
    .reduce((s, e) => s + e.amount, 0);

  const totalExpenses = personalTotal + officeTotal;

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex justify-between items-center flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Expenses</h1>
            <p className="text-muted-foreground text-sm mt-1">
              Track personal and office expenditures by category.
            </p>
          </div>

          <Dialog
            open={isDialogOpen}
            onOpenChange={(open) => {
              setIsDialogOpen(open);
              if (!open) {
                setEntryMode("review_flow");
              }
            }}
          >
            <DialogTrigger asChild>
              <Button>
                <Plus className="w-4 h-4 mr-2" /> Log Expense
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[520px]">
              <DialogHeader>
                <DialogTitle>Log New Expense</DialogTitle>
              </DialogHeader>
              <Form {...form}>
                <form
                  onSubmit={form.handleSubmit((d) => addMutation.mutate(d))}
                  className="space-y-2.5 pt-1"
                >
                  {isAdmin ? (
                    <div className="space-y-1.5">
                      <Label>Entry Mode</Label>
                      <div className="grid grid-cols-2 gap-2 rounded-2xl bg-secondary/10 p-1">
                        <button
                          type="button"
                          onClick={() => setEntryMode("review_flow")}
                          className={cn(
                            "rounded-[1.1rem] px-3 py-2 text-left text-xs transition-all",
                            entryMode === "review_flow"
                              ? "bg-background shadow-[0_0_0_1px_rgba(59,130,246,0.12)] ring-1 ring-primary/20"
                              : "text-muted-foreground hover:bg-background/40 hover:text-foreground",
                          )}
                        >
                          <div className={cn("font-medium", entryMode === "review_flow" ? "text-primary" : "text-foreground")}>
                            Review Flow
                          </div>
                          <div className="mt-0.5 text-[11px] text-muted-foreground">Current expense</div>
                        </button>
                        <button
                          type="button"
                          onClick={() => setEntryMode("historical_paid")}
                          className={cn(
                            "rounded-[1.1rem] px-3 py-2 text-left text-xs transition-all",
                            entryMode === "historical_paid"
                              ? "bg-background shadow-[0_0_0_1px_rgba(59,130,246,0.12)] ring-1 ring-primary/20"
                              : "text-muted-foreground hover:bg-background/40 hover:text-foreground",
                          )}
                        >
                          <div className={cn("font-medium", entryMode === "historical_paid" ? "text-primary" : "text-foreground")}>
                            Historical Paid
                          </div>
                          <div className="mt-0.5 text-[11px] text-muted-foreground">Past paid record</div>
                        </button>
                      </div>
                    </div>
                  ) : null}

                  <div className="grid grid-cols-2 gap-3">
                    <FormField
                      control={form.control}
                      name="group"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Group</FormLabel>
                          <Select
                            onValueChange={(value) => {
                              field.onChange(value);
                              form.setValue("category", "");
                            }}
                            defaultValue={field.value}
                          >
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="personal">
                                <div className="flex items-center gap-2">
                                  <Home className="w-3.5 h-3.5" /> Personal
                                </div>
                              </SelectItem>
                              <SelectItem value="office">
                                <div className="flex items-center gap-2">
                                  <Building2 className="w-3.5 h-3.5" /> Office
                                </div>
                              </SelectItem>
                            </SelectContent>
                          </Select>
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

                  <div className="space-y-1">
                    <div className="flex items-center justify-between gap-3">
                      <Label>{entryMode === "historical_paid" ? "Source Account" : "Paid Through"}</Label>
                      {selectedAccount && selectedAccountBalance !== null ? (
                        <span className="text-[11px] text-muted-foreground">
                          Bal:{" "}
                          <span className="font-semibold text-foreground">
                            {selectedAccountBalance.toLocaleString("en-IN", {
                              style: "currency",
                              currency: "INR",
                            })}
                          </span>
                        </span>
                      ) : null}
                    </div>
                    <Select value={selectedAccountId} onValueChange={setSelectedAccountId}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select financial account" />
                      </SelectTrigger>
                      <SelectContent>
                        {activeAccounts.map((account) => (
                          <SelectItem key={account.id} value={account.id}>
                            {accountDisplayName(account)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <FormField
                      control={form.control}
                      name="category"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Category</FormLabel>
                          <Select onValueChange={field.onChange} value={field.value}>
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue placeholder="Select..." />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {categories
                                .filter((c) => c.group === watchGroup)
                                .map((cat) => (
                                  <SelectItem key={cat.id} value={cat.name}>
                                    <div className="flex items-center gap-2">
                                      <span
                                        className="w-2 h-2 rounded-full"
                                        style={{ backgroundColor: cat.color }}
                                      />
                                      {cat.name}
                                    </div>
                                  </SelectItem>
                                ))}
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="amount"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Amount (₹)</FormLabel>
                          <FormControl>
                            <Input type="number" placeholder="0" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  <FormField
                    control={form.control}
                    name="description"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Description / Vendor</FormLabel>
                        <FormControl>
                          <Input placeholder="e.g. AWS Hosting" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <div className="grid grid-cols-2 gap-3">
                    <FormField
                      control={form.control}
                      name="project"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>
                            Project <span className="text-muted-foreground font-normal">(optional)</span>
                          </FormLabel>
                          <FormControl>
                            <Input placeholder="Project / client" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="note"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>
                            Note <span className="text-muted-foreground font-normal">(optional)</span>
                          </FormLabel>
                          <FormControl>
                            <Input placeholder="Short note" {...field} />
                          </FormControl>
                        </FormItem>
                      )}
                    />
                  </div>

                  <div className="space-y-1">
                    <Label className="text-sm font-medium">
                      Attachment <span className="text-muted-foreground font-normal">(optional)</span>
                    </Label>
                    <label className="flex h-10 items-center gap-3 rounded-xl border border-dashed border-border px-3 cursor-pointer hover:bg-secondary/20 transition-colors">
                      <Upload className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="truncate text-xs text-muted-foreground">
                        {isUploadingAttachment
                          ? "Uploading..."
                          : fileSelected
                            ? fileSelected
                            : "Upload receipt / invoice"}
                      </span>
                      <input
                        type="file"
                        accept="image/*,.pdf"
                        className="hidden"
                        onChange={(e) => void handleAttachmentChange(e)}
                      />
                    </label>
                  </div>

                  <Button
                    type="submit"
                    className="mt-1 w-full"
                    disabled={addMutation.isPending || isUploadingAttachment || !selectedAccountId}
                  >
                    {entryMode === "historical_paid" ? "Record Paid Expense" : "Save Expense"}
                  </Button>
                </form>
              </Form>
            </DialogContent>
          </Dialog>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <DashboardCard
            label="Total Expenses"
            value={totalExpenses.toLocaleString("en-IN", {
              style: "currency",
              currency: "INR",
            })}
            trend={-4.2}
            trendLabel="vs last month"
            icon={<Receipt className="w-5 h-5" />}
          />
          <DashboardCard
            label="Office Expenses"
            value={officeTotal.toLocaleString("en-IN", {
              style: "currency",
              currency: "INR",
            })}
            icon={<Building2 className="w-5 h-5" />}
          />
          <DashboardCard
            label="Personal Expenses"
            value={personalTotal.toLocaleString("en-IN", {
              style: "currency",
              currency: "INR",
            })}
            icon={<Home className="w-5 h-5" />}
          />
        </div>

        <Tabs
          value={activeTab}
          onValueChange={(v) => setActiveTab(v as "personal" | "office")}
        >
          <TabsList className="mb-4">
            <TabsTrigger value="office" className="gap-2">
              <Building2 className="w-3.5 h-3.5" /> Office
            </TabsTrigger>
            <TabsTrigger value="personal" className="gap-2">
              <Home className="w-3.5 h-3.5" /> Personal
            </TabsTrigger>
          </TabsList>

          <TabsContent value="office" className="mt-0">
          <ExpenseTable
            expenses={expenses}
            categories={categories}
            group="office"
            accounts={financialAccounts}
            reviewAccountIds={reviewAccountIds}
            onReviewAccountChange={(id, accountId) =>
              setReviewAccountIds((current) => ({ ...current, [id]: accountId }))
            }
            onReview={(id, status, accountId) => reviewMutation.mutate({ id, status, accountId })}
            isReviewing={reviewMutation.isPending}
          />
        </TabsContent>
        <TabsContent value="personal" className="mt-0">
          <ExpenseTable
            expenses={expenses}
            categories={categories}
            group="personal"
            accounts={financialAccounts}
            reviewAccountIds={reviewAccountIds}
            onReviewAccountChange={(id, accountId) =>
              setReviewAccountIds((current) => ({ ...current, [id]: accountId }))
            }
            onReview={(id, status, accountId) => reviewMutation.mutate({ id, status, accountId })}
            isReviewing={reviewMutation.isPending}
          />
        </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
