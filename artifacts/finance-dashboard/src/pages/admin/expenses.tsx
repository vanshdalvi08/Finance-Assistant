import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  Building2,
  CheckCircle2,
  CircleDollarSign,
  Home,
  Paperclip,
  Plus,
  Search,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { MetricCard } from "@/components/app/metric-card";
import { StatusPill } from "@/components/app/status-pill";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { formatCurrency } from "@/lib/utils";
import { yojakData, type ApprovalStatus, type ExpenseKind, type ExpenseRecord } from "@/lib/yojak-data";
import { useToast } from "@/hooks/use-toast";

type ExpenseFormState = {
  employeeId: string;
  employeeNameSnapshot: string;
  title: string;
  categoryId: string;
  kind: ExpenseKind;
  amount: string;
  date: string;
  note: string;
  attachmentName: string;
  reimbursable: boolean;
};

const today = new Date().toISOString().slice(0, 10);

const emptyForm = (): ExpenseFormState => ({
  employeeId: "",
  employeeNameSnapshot: "",
  title: "",
  categoryId: "",
  kind: "office",
  amount: "",
  date: today,
  note: "",
  attachmentName: "",
  reimbursable: true,
});

function kindIcon(kind: ExpenseKind) {
  return kind === "office" ? Building2 : Home;
}

function statusTone(status: ApprovalStatus) {
  if (status === "approved") return "approved";
  if (status === "rejected") return "rejected";
  if (status === "submitted") return "submitted";
  return "draft";
}

export default function AdminExpensesPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [formOpen, setFormOpen] = useState(false);
  const [reviewing, setReviewing] = useState<ExpenseRecord | null>(null);
  const [reviewNote, setReviewNote] = useState("");
  const [form, setForm] = useState<ExpenseFormState>(emptyForm());
  const [kindFilter, setKindFilter] = useState<"all" | ExpenseKind>("all");
  const [statusFilter, setStatusFilter] = useState<"all" | ApprovalStatus>("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [employeeFilter, setEmployeeFilter] = useState("all");
  const [search, setSearch] = useState("");

  const { data: expenses = [] } = useQuery({ queryKey: ["yojak-expenses"], queryFn: () => yojakData.getExpenses() });
  const { data: categories = [] } = useQuery({ queryKey: ["yojak-expense-categories"], queryFn: () => yojakData.getExpenseCategories() });
  const { data: employees = [] } = useQuery({ queryKey: ["yojak-employees"], queryFn: yojakData.getEmployees });
  const { data: overview } = useQuery({ queryKey: ["yojak-admin-overview"], queryFn: yojakData.getAdminOverview });
  const { data: categoryBreakdown = [] } = useQuery({ queryKey: ["yojak-expense-breakdown"], queryFn: yojakData.getExpenseCategoryBreakdown });

  const filteredExpenses = useMemo(() => {
    return expenses.filter((expense) => {
      if (kindFilter !== "all" && expense.kind !== kindFilter) return false;
      if (statusFilter !== "all" && expense.status !== statusFilter) return false;
      if (categoryFilter !== "all" && expense.categoryId !== categoryFilter) return false;
      if (employeeFilter !== "all" && expense.employeeId !== employeeFilter) return false;
      if (search.trim()) {
        const needle = search.trim().toLowerCase();
        const haystack = [expense.title, expense.note, expense.employeeNameSnapshot, expense.categoryNameSnapshot]
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(needle)) return false;
      }
      return true;
    });
  }, [categoryFilter, employeeFilter, expenses, kindFilter, search, statusFilter]);

  const officeTotal = useMemo(
    () => expenses.filter((expense) => expense.kind === "office").reduce((sum, expense) => sum + expense.amount, 0),
    [expenses],
  );
  const personalTotal = useMemo(
    () => expenses.filter((expense) => expense.kind === "personal").reduce((sum, expense) => sum + expense.amount, 0),
    [expenses],
  );
  const pendingCount = expenses.filter((expense) => expense.status === "submitted").length;

  const addMutation = useMutation({
    mutationFn: async () =>
      yojakData.addExpense({
        employeeId: form.employeeId || "system",
        employeeNameSnapshot: form.employeeNameSnapshot || "Admin",
        title: form.title.trim(),
        categoryId: form.categoryId,
        categoryNameSnapshot: categories.find((category) => category.id === form.categoryId)?.name ?? "Uncategorized",
        kind: form.kind,
        amount: Number(form.amount),
        date: form.date,
        note: form.note.trim(),
        attachmentName: form.attachmentName.trim() || undefined,
        reimbursable: form.reimbursable,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["yojak-expenses"] });
      await queryClient.invalidateQueries({ queryKey: ["yojak-transactions"] });
      await queryClient.invalidateQueries({ queryKey: ["yojak-admin-overview"] });
      await queryClient.invalidateQueries({ queryKey: ["yojak-expense-breakdown"] });
      setFormOpen(false);
      setForm(emptyForm());
      toast({
        title: "Expense recorded",
        description: "The entry was added to the ledger.",
      });
    },
  });

  const reviewMutation = useMutation({
    mutationFn: async ({ id, status, reviewerNote }: { id: string; status: ApprovalStatus; reviewerNote?: string }) =>
      yojakData.updateExpenseStatus(id, status, reviewerNote),
    onSuccess: async (_data, variables) => {
      await queryClient.invalidateQueries({ queryKey: ["yojak-expenses"] });
      await queryClient.invalidateQueries({ queryKey: ["yojak-transactions"] });
      await queryClient.invalidateQueries({ queryKey: ["yojak-admin-overview"] });
      await queryClient.invalidateQueries({ queryKey: ["yojak-expense-breakdown"] });
      toast({
        title: variables.status === "approved" ? "Expense approved" : "Expense rejected",
        description: variables.reviewerNote ? variables.reviewerNote : "Ledger state updated.",
      });
      setReviewing(null);
      setReviewNote("");
    },
  });

  const selectedCategories = useMemo(
    () => categories.filter((category) => category.kind === form.kind),
    [categories, form.kind],
  );

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Operations"
        title="Expense control"
        description="Capture office and personal spend, attach receipts, and validate submissions from a single ledger view."
        actions={
          <Dialog open={formOpen} onOpenChange={setFormOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="mr-2 h-4 w-4" />
                Add expense
              </Button>
            </DialogTrigger>
            <DialogContent className="border-white/8 bg-[#0f0f10] text-foreground sm:max-w-2xl">
              <DialogHeader>
                <DialogTitle>Log expense entry</DialogTitle>
              </DialogHeader>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>Employee</Label>
                  <Select
                    value={form.employeeId}
                    onValueChange={(value) => {
                      const employee = employees.find((item) => item.id === value);
                      setForm((current) => ({
                        ...current,
                        employeeId: value,
                        employeeNameSnapshot: employee?.name ?? current.employeeNameSnapshot,
                      }));
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select employee or system" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="system">System / Admin</SelectItem>
                      {employees.map((employee) => (
                        <SelectItem key={employee.id} value={employee.id}>
                          {employee.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Type</Label>
                  <Select
                    value={form.kind}
                    onValueChange={(value) =>
                      setForm((current) => ({
                        ...current,
                        kind: value as ExpenseKind,
                        categoryId: "",
                      }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="office">Office expenses</SelectItem>
                      <SelectItem value="personal">Personal expenses</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Title</Label>
                  <Input
                    value={form.title}
                    onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}
                    placeholder="Equipment rental"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Category</Label>
                  <Select
                    value={form.categoryId}
                    onValueChange={(value) => setForm((current) => ({ ...current, categoryId: value }))}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Choose a category" />
                    </SelectTrigger>
                    <SelectContent>
                      {selectedCategories.map((category) => (
                        <SelectItem key={category.id} value={category.id}>
                          {category.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Amount</Label>
                  <Input
                    type="number"
                    min={0}
                    value={form.amount}
                    onChange={(event) => setForm((current) => ({ ...current, amount: event.target.value }))}
                    placeholder="0"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Date</Label>
                  <Input
                    type="date"
                    value={form.date}
                    onChange={(event) => setForm((current) => ({ ...current, date: event.target.value }))}
                  />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label>Notes</Label>
                  <Textarea
                    value={form.note}
                    onChange={(event) => setForm((current) => ({ ...current, note: event.target.value }))}
                    rows={3}
                    placeholder="Context for the expense, vendor details, or reimbursement note."
                    className="border-white/8 bg-black/20"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Attachment</Label>
                  <div className="flex items-center gap-2 rounded-2xl border border-dashed border-white/10 bg-black/20 px-3 py-2.5 text-sm text-muted-foreground">
                    <Paperclip className="h-4 w-4" />
                    <Input
                      value={form.attachmentName}
                      onChange={(event) => setForm((current) => ({ ...current, attachmentName: event.target.value }))}
                      placeholder="receipt.pdf"
                      className="border-0 bg-transparent p-0 shadow-none focus-visible:ring-0"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Reimbursable</Label>
                  <Select
                    value={form.reimbursable ? "yes" : "no"}
                    onValueChange={(value) => setForm((current) => ({ ...current, reimbursable: value === "yes" }))}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="yes">Yes</SelectItem>
                      <SelectItem value="no">No</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="mt-6 flex justify-end gap-3">
                <Button variant="outline" onClick={() => setFormOpen(false)}>
                  Cancel
                </Button>
                <Button
                  onClick={() => addMutation.mutate()}
                  disabled={!form.title.trim() || !form.categoryId || !form.amount}
                >
                  Save expense
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        }
      />

      <div className="grid gap-4 xl:grid-cols-4">
        <MetricCard label="Total expenses" value={formatCurrency(overview?.totalExpenses ?? 0)} icon={<CircleDollarSign className="h-5 w-5" />} />
        <MetricCard label="Pending approval" value={`${pendingCount}`} icon={<ShieldCheck className="h-5 w-5" />} />
        <MetricCard label="Office spend" value={formatCurrency(officeTotal)} icon={<Building2 className="h-5 w-5" />} />
        <MetricCard label="Personal spend" value={formatCurrency(personalTotal)} icon={<Home className="h-5 w-5" />} />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.6fr_1fr]">
        <Card className="border-white/8 bg-white/[0.03]">
          <CardHeader className="space-y-4">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <CardTitle className="font-serif text-2xl">Expense ledger</CardTitle>
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex items-center gap-2 rounded-2xl border border-white/8 bg-black/20 px-3 py-2">
                  <Search className="h-4 w-4 text-muted-foreground" />
                  <Input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Search title, employee, or category"
                    className="h-auto border-0 bg-transparent p-0 shadow-none focus-visible:ring-0"
                  />
                </div>
                <Select value={kindFilter} onValueChange={(value) => setKindFilter(value as "all" | ExpenseKind)}>
                  <SelectTrigger className="w-[160px]">
                    <SelectValue placeholder="Type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All types</SelectItem>
                    <SelectItem value="office">Office</SelectItem>
                    <SelectItem value="personal">Personal</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as "all" | ApprovalStatus)}>
                  <SelectTrigger className="w-[160px]">
                    <SelectValue placeholder="Status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All statuses</SelectItem>
                    <SelectItem value="draft">Draft</SelectItem>
                    <SelectItem value="submitted">Submitted</SelectItem>
                    <SelectItem value="approved">Approved</SelectItem>
                    <SelectItem value="rejected">Rejected</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                  <SelectTrigger className="w-[180px]">
                    <SelectValue placeholder="Category" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All categories</SelectItem>
                    {categories.map((category) => (
                      <SelectItem key={category.id} value={category.id}>
                        {category.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={employeeFilter} onValueChange={setEmployeeFilter}>
                  <SelectTrigger className="w-[180px]">
                    <SelectValue placeholder="Employee" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All employees</SelectItem>
                    {employees.map((employee) => (
                      <SelectItem key={employee.id} value={employee.id}>
                        {employee.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="overflow-hidden rounded-3xl border border-white/8">
              <div className="grid grid-cols-[1.4fr_1fr_1fr_0.8fr_0.7fr_0.8fr] border-b border-white/8 bg-white/[0.02] px-4 py-3 text-xs uppercase tracking-[0.18em] text-muted-foreground">
                <span>Expense</span>
                <span>Employee</span>
                <span>Category</span>
                <span>Date</span>
                <span className="text-right">Amount</span>
                <span className="text-right">Status</span>
              </div>
              <div className="divide-y divide-white/6">
                {filteredExpenses.length === 0 ? (
                  <div className="px-4 py-12 text-center text-sm text-muted-foreground">
                    No expenses match the current filters.
                  </div>
                ) : (
                  filteredExpenses.map((expense) => {
                    const Icon = kindIcon(expense.kind);
                    return (
                      <div key={expense.id} className="grid grid-cols-[1.4fr_1fr_1fr_0.8fr_0.7fr_0.8fr] items-center gap-3 px-4 py-4">
                        <div className="flex items-center gap-3">
                          <div className="rounded-2xl border border-white/8 bg-black/20 p-2.5 text-[#d8b26a]">
                            <Icon className="h-4 w-4" />
                          </div>
                          <div className="min-w-0">
                            <p className="truncate font-medium text-foreground">{expense.title}</p>
                            <p className="truncate text-xs text-muted-foreground">
                              {expense.note || "No note provided"}
                            </p>
                          </div>
                        </div>
                        <div className="min-w-0">
                          <p className="truncate text-sm text-foreground">{expense.employeeNameSnapshot}</p>
                          <p className="text-xs text-muted-foreground">{expense.reimbursable ? "Reimbursable" : "Non-reimbursable"}</p>
                        </div>
                        <div className="min-w-0">
                          <p className="truncate text-sm text-foreground">{expense.categoryNameSnapshot}</p>
                          <p className="text-xs text-muted-foreground capitalize">{expense.kind}</p>
                        </div>
                        <div className="text-sm text-muted-foreground">{format(new Date(expense.date), "dd MMM yyyy")}</div>
                        <div className="text-right font-medium text-foreground">{formatCurrency(expense.amount)}</div>
                        <div className="flex items-center justify-end gap-2">
                          <StatusPill status={statusTone(expense.status)} />
                          {expense.status === "submitted" ? (
                            <div className="flex items-center gap-1">
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => {
                                  setReviewing(expense);
                                  setReviewNote("");
                                }}
                              >
                                <CheckCircle2 className="h-4 w-4 text-emerald-300" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => {
                                  setReviewing(expense);
                                  setReviewNote("Please revise and resubmit.");
                                }}
                              >
                                <XCircle className="h-4 w-4 text-rose-300" />
                              </Button>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card className="border-white/8 bg-white/[0.03]">
            <CardHeader>
              <CardTitle className="font-serif text-2xl">Category mix</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {categoryBreakdown.length === 0 ? (
                <p className="text-sm text-muted-foreground">No category spend yet.</p>
              ) : (
                categoryBreakdown.slice(0, 8).map((item) => (
                  <div key={item.name} className="space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-foreground">{item.name}</span>
                      <span className="text-muted-foreground">{formatCurrency(item.value)}</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-white/6">
                      <div
                        className="h-full rounded-full bg-[linear-gradient(90deg,#d8b26a,#8e6d34)]"
                        style={{ width: `${Math.max(8, Math.min(100, (item.value / Math.max(1, overview?.totalExpenses ?? item.value)) * 100))}%` }}
                      />
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <Card className="border-white/8 bg-white/[0.03]">
            <CardHeader>
              <CardTitle className="font-serif text-2xl">Review queue</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                <div className="flex items-center justify-between rounded-2xl border border-white/8 bg-black/20 px-4 py-3">
                  <span className="text-sm text-muted-foreground">Pending submissions</span>
                  <span className="text-lg font-semibold text-foreground">{pendingCount}</span>
                </div>
                <div className="flex items-center justify-between rounded-2xl border border-white/8 bg-black/20 px-4 py-3">
                  <span className="text-sm text-muted-foreground">Office categories</span>
                  <span className="text-lg font-semibold text-foreground">{categories.filter((category) => category.kind === "office").length}</span>
                </div>
                <div className="flex items-center justify-between rounded-2xl border border-white/8 bg-black/20 px-4 py-3">
                  <span className="text-sm text-muted-foreground">Personal categories</span>
                  <span className="text-lg font-semibold text-foreground">{categories.filter((category) => category.kind === "personal").length}</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <Dialog open={Boolean(reviewing)} onOpenChange={(open) => !open && setReviewing(null)}>
        <DialogContent className="border-white/8 bg-[#0f0f10] text-foreground sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Review expense</DialogTitle>
          </DialogHeader>
          {reviewing ? (
            <div className="space-y-4">
              <div className="rounded-2xl border border-white/8 bg-black/20 p-4">
                <p className="text-sm font-medium text-foreground">{reviewing.title}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {reviewing.employeeNameSnapshot} - {reviewing.categoryNameSnapshot} - {formatCurrency(reviewing.amount)}
                </p>
              </div>
              <div className="space-y-2">
                <Label>Reviewer note</Label>
                <Textarea
                  value={reviewNote}
                  onChange={(event) => setReviewNote(event.target.value)}
                  rows={4}
                  placeholder="Leave an approval note or rejection guidance."
                  className="border-white/8 bg-black/20"
                />
              </div>
              <Separator className="bg-white/8" />
              <div className="flex gap-3">
                <Button
                  className="flex-1"
                  onClick={() => reviewMutation.mutate({ id: reviewing.id, status: "approved", reviewerNote: reviewNote.trim() || "Approved" })}
                >
                  Approve
                </Button>
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => reviewMutation.mutate({ id: reviewing.id, status: "rejected", reviewerNote: reviewNote.trim() || "Rejected" })}
                >
                  Reject
                </Button>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
