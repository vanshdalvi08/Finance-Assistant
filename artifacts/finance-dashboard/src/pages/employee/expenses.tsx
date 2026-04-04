import { useMemo, useState, type ChangeEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { DashboardCard } from "@/components/dashboard-card";
import { useAuthStore } from "@/store/auth";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { uploadExpenseAttachment } from "@/lib/uploads";

function formatCurrency(value: number) {
  return value.toLocaleString("en-IN", { style: "currency", currency: "INR" });
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function statusVariant(status: string) {
  if (status === "approved") return "secondary";
  if (status === "rejected") return "destructive";
  if (status === "submitted") return "default";
  return "outline";
}

export default function EmployeeExpensesPage() {
  const queryClient = useQueryClient();
  const user = useAuthStore((state) => state.user);
  const [group, setGroup] = useState<"office" | "personal">("office");
  const [form, setForm] = useState({
    category: "",
    project: "",
    amount: "",
    date: new Date().toISOString().slice(0, 10),
    description: "",
    note: "",
    attachmentName: "",
  });
  const [attachmentLabel, setAttachmentLabel] = useState("");
  const [attachmentPath, setAttachmentPath] = useState("");
  const [isUploadingAttachment, setIsUploadingAttachment] = useState(false);

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

  const { data: expenses = [] } = useQuery({
    queryKey: ["employee-expenses", employee?.id],
    queryFn: () => api.getExpenses({ employeeId: employee?.id ?? "" }),
    enabled: Boolean(employee?.id),
  });

  const { data: categories = [] } = useQuery({
    queryKey: ["categories"],
    queryFn: api.getCategories,
  });

  const visibleCategories = categories.filter((category) => category.group === group);
  const visibleExpenses = expenses.filter((expense) => expense.group === group);

  const totals = useMemo(() => {
    const pending = expenses.filter((expense) => expense.status === "submitted").reduce((sum, expense) => sum + expense.amount, 0);
    const approved = expenses.filter((expense) => expense.status === "approved").reduce((sum, expense) => sum + expense.amount, 0);
    const reimbursable = expenses.filter((expense) => expense.reimbursable).reduce((sum, expense) => sum + expense.amount, 0);
    return { pending, approved, reimbursable };
  }, [expenses]);

  const addMutation = useMutation({
    mutationFn: () =>
      api.addExpense({
        employeeId: employee?.id,
        employeeNameSnapshot: employee?.name ?? user?.name ?? user?.email ?? "Employee",
        category: form.category,
        project: form.project.trim() || undefined,
        group,
        amount: Number(form.amount),
        date: form.date,
        description: form.description.trim(),
        note: form.note.trim(),
        attachmentName: form.attachmentName.trim() || undefined,
        attachmentPath: attachmentPath.trim() || undefined,
        reimbursable: group === "office",
        status: "submitted",
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["employee-expenses", employee?.id] });
      await queryClient.invalidateQueries({ queryKey: ["expenses"] });
      await queryClient.invalidateQueries({ queryKey: ["adminOverview"] });
      setForm({
        category: "",
        project: "",
        amount: "",
        date: new Date().toISOString().slice(0, 10),
        description: "",
        note: "",
        attachmentName: "",
      });
      setAttachmentLabel("");
      setAttachmentPath("");
      setIsUploadingAttachment(false);
    },
  });

  async function handleAttachmentChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    try {
      setIsUploadingAttachment(true);
      const uploaded = await uploadExpenseAttachment(file);
      setForm((current) => ({
        ...current,
        attachmentName: uploaded.fileName,
      }));
      setAttachmentPath(uploaded.path ?? "");
      setAttachmentLabel(uploaded.fileName);
    } catch {
      setAttachmentLabel("");
      setForm((current) => ({ ...current, attachmentName: "" }));
      setAttachmentPath("");
    } finally {
      setIsUploadingAttachment(false);
      event.target.value = "";
    }
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">My Expenses</h1>
          <p className="mt-1 text-sm text-muted-foreground">Submit office or personal expenses with only the fields you actually need.</p>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
          <DashboardCard label="Pending" value={formatCurrency(totals.pending)} />
          <DashboardCard label="Approved" value={formatCurrency(totals.approved)} />
          <DashboardCard label="Reimbursable" value={formatCurrency(totals.reimbursable)} />
          <DashboardCard label="Entries" value={expenses.length.toString()} />
        </div>

        <Card className="border-border/50">
          <CardHeader>
            <CardTitle className="text-base">New Expense</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Tabs value={group} onValueChange={(value) => setGroup(value as "office" | "personal")}>
              <TabsList>
                <TabsTrigger value="office">Office</TabsTrigger>
                <TabsTrigger value="personal">Personal</TabsTrigger>
              </TabsList>
            </Tabs>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>Category</Label>
                <Select value={form.category} onValueChange={(value) => setForm((current) => ({ ...current, category: value }))}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select category" />
                  </SelectTrigger>
                  <SelectContent>
                    {visibleCategories.map((category) => (
                      <SelectItem key={category.id} value={category.name}>
                        {category.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Amount</Label>
                <Input type="number" value={form.amount} onChange={(event) => setForm((current) => ({ ...current, amount: event.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Description</Label>
                <Input value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Project</Label>
                <Input
                  placeholder="Optional project tag"
                  value={form.project}
                  onChange={(event) => setForm((current) => ({ ...current, project: event.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label>Date</Label>
                <Input type="date" value={form.date} onChange={(event) => setForm((current) => ({ ...current, date: event.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Attachment</Label>
                <div className="flex items-center gap-2 rounded-md border border-border bg-background px-3">
                  <Input
                    type="file"
                    accept="image/*,.pdf"
                    className="border-0 bg-transparent px-0 shadow-none focus-visible:ring-0"
                    onChange={(event) => void handleAttachmentChange(event)}
                    disabled={isUploadingAttachment}
                  />
                  <span className="text-xs text-muted-foreground whitespace-nowrap">
                    {isUploadingAttachment ? "Uploading..." : attachmentLabel || "Optional"}
                  </span>
                </div>
              </div>
              <div className="space-y-2">
                <Label>Note</Label>
                <Textarea value={form.note} rows={3} onChange={(event) => setForm((current) => ({ ...current, note: event.target.value }))} />
              </div>
            </div>
            <div className="flex justify-end">
              <Button
                disabled={!form.category || !form.description.trim() || !form.amount || addMutation.isPending || isUploadingAttachment}
                onClick={() => addMutation.mutate()}
              >
                Submit Expense
              </Button>
            </div>
          </CardContent>
        </Card>

        <Tabs value={group} onValueChange={(value) => setGroup(value as "office" | "personal")}>
          <TabsList>
            <TabsTrigger value="office">Office</TabsTrigger>
            <TabsTrigger value="personal">Personal</TabsTrigger>
          </TabsList>
          <TabsContent value="office" className="mt-4">
            <ExpenseLedger expenses={visibleExpenses} />
          </TabsContent>
          <TabsContent value="personal" className="mt-4">
            <ExpenseLedger expenses={visibleExpenses} />
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}

function ExpenseLedger({
  expenses,
}: {
  expenses: Awaited<ReturnType<typeof api.getExpenses>>;
}) {
  return (
    <Card className="border-border/50">
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
            {expenses.length === 0 ? (
              <TableRow className="border-border/50">
                <TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
                  No expenses in this section yet.
                </TableCell>
              </TableRow>
            ) : (
              expenses.map((expense) => (
                <TableRow key={expense.id} className="border-border/50">
                  <TableCell className="font-medium">
                    <div>
                      <div>{expense.description}</div>
                      {expense.project ? <div className="text-xs text-muted-foreground mt-0.5">Project: {expense.project}</div> : null}
                      {expense.note ? <div className="text-xs text-muted-foreground mt-0.5">{expense.note}</div> : null}
                      {expense.attachmentUrl ? (
                        <a
                          href={expense.attachmentUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-1 inline-block text-xs text-primary hover:underline"
                        >
                          {expense.attachmentName || "Open attachment"}
                        </a>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell>{expense.category}</TableCell>
                  <TableCell>{formatDate(expense.date)}</TableCell>
                  <TableCell>
                    <Badge variant={statusVariant(expense.status)} className="capitalize">
                      {expense.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right font-medium">{formatCurrency(expense.amount)}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
