import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { DashboardCard } from "@/components/dashboard-card";
import { api, type PurchaseOrder, type PurchaseOrderTask } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Pencil, Wallet, Coins, ArrowRight, CheckCircle2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

type PurchaseOrderForm = {
  title: string;
  totalAmount: string;
  vendor: string;
  date: string;
  notes: string;
};

type TaskDraft = {
  taskName: string;
  description: string;
  amount: string;
};

type EditingState =
  | { mode: "create" }
  | { mode: "edit"; order: PurchaseOrder };

const STORAGE_KEY = "finance-dashboard-store-v2";

function formatCurrency(value: number) {
  return value.toLocaleString("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  });
}

function createTaskDraft(): TaskDraft {
  return { taskName: "", description: "", amount: "" };
}

function normalizeAmount(value: string) {
  return Math.max(0, Number(value || 0));
}

function updateLocalPurchaseOrders(
  updater: (orders: PurchaseOrder[]) => PurchaseOrder[],
): PurchaseOrder[] | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return null;
    }

    const store = JSON.parse(raw) as { purchaseOrders?: PurchaseOrder[] };
    const currentOrders = Array.isArray(store.purchaseOrders) ? store.purchaseOrders : [];
    const nextOrders = updater(currentOrders);

    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        ...store,
        purchaseOrders: nextOrders,
      }),
    );

    return nextOrders;
  } catch {
    return null;
  }
}

function getOrderTotals(order: PurchaseOrder) {
  const total = Math.max(0, Number(order.totalAmount ?? 0));
  const used = Math.max(0, Number(order.usedAmount ?? 0));
  const remaining = Math.max(0, Number(order.remainingAmount ?? total - used));
  return { total, used, remaining };
}

export default function PurchaseOrdersPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [sheetDialogOpen, setSheetDialogOpen] = useState(false);
  const [editingState, setEditingState] = useState<EditingState>({ mode: "create" });
  const [form, setForm] = useState<PurchaseOrderForm>({
    title: "",
    totalAmount: "",
    vendor: "",
    date: new Date().toISOString().split("T")[0],
    notes: "",
  });
  const [taskRows, setTaskRows] = useState<TaskDraft[]>([createTaskDraft()]);
  const [taskForm, setTaskForm] = useState<TaskDraft>(createTaskDraft());

  const { data: purchaseOrders = [] } = useQuery({
    queryKey: ["purchaseOrders"],
    queryFn: api.getPurchaseOrders,
  });

  const totals = useMemo(() => {
    return purchaseOrders.reduce(
      (acc, order) => {
        const { total, used, remaining } = getOrderTotals(order);
        acc.total += total;
        acc.used += used;
        acc.remaining += remaining;
        if (order.tasks.some((task) => task.status === "pending")) {
          acc.active += 1;
        }
        return acc;
      },
      { total: 0, used: 0, remaining: 0, active: 0 },
    );
  }, [purchaseOrders]);

  const createMutation = useMutation({
    mutationFn: async () => {
      return api.createPurchaseOrder({
        title: form.title.trim(),
        totalAmount: normalizeAmount(form.totalAmount),
        vendor: form.vendor.trim(),
        date: form.date,
        notes: form.notes.trim(),
        tasks: taskRows
          .filter((task) => task.taskName.trim() && normalizeAmount(task.amount) > 0)
          .map((task) => ({
            taskName: task.taskName,
            description: task.description,
            amount: normalizeAmount(task.amount),
          })),
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["purchaseOrders"] });
      await queryClient.invalidateQueries({ queryKey: ["adminOverview"] });
      await queryClient.invalidateQueries({ queryKey: ["transactions"] });
      toast({
        title: "Purchase order created",
        description: "The outsourced work budget sheet is ready.",
      });
      resetEditor();
    },
    onError: (error) => {
      toast({
        title: "Could not create PO",
        description: error instanceof Error ? error.message : "Please check the form details.",
        variant: "destructive",
      });
    },
  });

  const addTaskMutation = useMutation({
    mutationFn: async ({ poId, task }: { poId: string; task: TaskDraft }) => {
      const addPurchaseOrderTask = (api as any).addPurchaseOrderTask as
        | undefined
        | ((input: { poId: string; taskName: string; description?: string; amount: number }) => Promise<unknown>);

      if (typeof addPurchaseOrderTask === "function") {
        await addPurchaseOrderTask({
          poId,
          taskName: task.taskName.trim(),
          description: task.description.trim(),
          amount: normalizeAmount(task.amount),
        });
        return true;
      }

      const updated = updateLocalPurchaseOrders((orders) =>
        orders.map((order) =>
          order.id === poId
            ? {
                ...order,
                tasks: [
                  ...order.tasks,
                  {
                    id: `po_task_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
                    taskName: task.taskName.trim(),
                    description: task.description.trim(),
                    amount: normalizeAmount(task.amount),
                    status: "pending",
                  },
                ],
              }
            : order,
        ),
      );

      if (!updated) {
        throw new Error("Unable to update the purchase order.");
      }

      return true;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["purchaseOrders"] });
      await queryClient.invalidateQueries({ queryKey: ["adminOverview"] });
      await queryClient.invalidateQueries({ queryKey: ["transactions"] });
      toast({ title: "Task added", description: "A new outsourced work row was added." });
      setTaskForm(createTaskDraft());
    },
    onError: (error) => {
      toast({
        title: "Could not add task",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    },
  });

  const payTaskMutation = useMutation({
    mutationFn: async ({ poId, taskId }: { poId: string; taskId: string }) => {
      return api.payPurchaseOrderTask({ poId, taskId });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["purchaseOrders"] });
      await queryClient.invalidateQueries({ queryKey: ["expenses"] });
      await queryClient.invalidateQueries({ queryKey: ["transactions"] });
      await queryClient.invalidateQueries({ queryKey: ["adminOverview"] });
      toast({
        title: "Task paid",
        description: "The amount has been deducted from the PO balance.",
      });
    },
    onError: (error) => {
      toast({
        title: "Could not pay task",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    },
  });

  const saveHeaderMutation = useMutation({
    mutationFn: async () => {
      if (editingState.mode !== "edit") {
        throw new Error("Select a purchase order to edit.");
      }

      const updatePurchaseOrder = (api as any).updatePurchaseOrder as
        | undefined
        | ((input: {
            id: string;
            title: string;
            totalAmount: number;
            vendor?: string;
            date: string;
            notes?: string;
          }) => Promise<unknown>);

      const payload = {
        id: editingState.order.id,
        title: form.title.trim(),
        totalAmount: normalizeAmount(form.totalAmount),
        vendor: form.vendor.trim(),
        date: form.date,
        notes: form.notes.trim(),
      };

      if (typeof updatePurchaseOrder === "function") {
        await updatePurchaseOrder(payload);
        return true;
      }

      const updated = updateLocalPurchaseOrders((orders) =>
        orders.map((order) =>
          order.id === payload.id
            ? {
                ...order,
                title: payload.title,
                totalAmount: payload.totalAmount,
                vendor: payload.vendor || undefined,
                date: payload.date,
                notes: payload.notes || "",
              }
            : order,
        ),
      );

      if (!updated) {
        throw new Error("Unable to update the purchase order.");
      }

      return true;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["purchaseOrders"] });
      await queryClient.invalidateQueries({ queryKey: ["adminOverview"] });
      toast({ title: "Purchase order updated", description: "The sheet header was saved successfully." });
      setSheetDialogOpen(false);
      resetEditor();
    },
    onError: (error) => {
      toast({
        title: "Could not save changes",
        description: error instanceof Error ? error.message : "Please check the values again.",
        variant: "destructive",
      });
    },
  });

  function resetEditor() {
    setEditingState({ mode: "create" });
    setForm({
      title: "",
      totalAmount: "",
      vendor: "",
      date: new Date().toISOString().split("T")[0],
      notes: "",
    });
    setTaskRows([createTaskDraft()]);
    setTaskForm(createTaskDraft());
  }

  function openCreateSheet() {
    resetEditor();
    setSheetDialogOpen(true);
  }

  function openEditSheet(order: PurchaseOrder) {
    setEditingState({ mode: "edit", order });
    setForm({
      title: order.title,
      totalAmount: String(getOrderTotals(order).total),
      vendor: order.vendor ?? "",
      date: format(new Date(order.date), "yyyy-MM-dd"),
      notes: order.notes ?? "",
    });
    setTaskRows([createTaskDraft()]);
    setTaskForm(createTaskDraft());
    setSheetDialogOpen(true);
  }

  function updateTaskRow(index: number, field: keyof TaskDraft, value: string) {
    setTaskRows((current) =>
      current.map((task, taskIndex) => (taskIndex === index ? { ...task, [field]: value } : task)),
    );
  }

  function addDraftTaskRow() {
    setTaskRows((current) => [...current, createTaskDraft()]);
  }

  function createOrderSheet() {
    createMutation.mutate();
  }

  const editingOrder = editingState.mode === "edit" ? editingState.order : null;

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Purchase Orders</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Outsourced work sheets for vendor tasks, payments, and remaining balances.
            </p>
          </div>
          <Button onClick={openCreateSheet}>
            <Plus className="mr-2 h-4 w-4" />
            Create PO
          </Button>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
          <DashboardCard label="Total PO Fund" value={formatCurrency(totals.total)} icon={<Wallet className="h-5 w-5" />} />
          <DashboardCard label="Used Amount" value={formatCurrency(totals.used)} icon={<Coins className="h-5 w-5" />} />
          <DashboardCard label="Remaining Amount" value={formatCurrency(totals.remaining)} icon={<ArrowRight className="h-5 w-5" />} />
          <DashboardCard label="Active Sheets" value={String(totals.active)} icon={<CheckCircle2 className="h-5 w-5" />} />
        </div>

        <Card className="border-border/50">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Purchase Order Sheets</CardTitle>
            <Button variant="outline" size="sm" onClick={openCreateSheet}>
              <Plus className="mr-2 h-4 w-4" />
              New Sheet
            </Button>
          </CardHeader>
          <CardContent className="space-y-4">
            {purchaseOrders.length === 0 ? (
              <div className="py-12 text-center text-sm text-muted-foreground">
                No purchase orders created yet.
              </div>
            ) : (
              purchaseOrders.map((order) => {
                const { total, used, remaining } = getOrderTotals(order);

                return (
                  <div key={order.id} className="rounded-xl border border-border/50 bg-secondary/10 p-4">
                    <div className="flex flex-col gap-4 border-b border-border/50 pb-4 md:flex-row md:items-start md:justify-between">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <h2 className="text-base font-semibold">{order.title}</h2>
                          <Badge variant="outline" className="font-normal">
                            {order.tasks.some((task) => task.status === "pending") ? "Active" : "Closed"}
                          </Badge>
                        </div>
                        <p className="text-sm text-muted-foreground">
                          {order.vendor ? `${order.vendor} - ` : ""}
                          {format(new Date(order.date), "dd MMM yyyy")}
                        </p>
                        {order.notes ? <p className="max-w-3xl text-sm text-muted-foreground">{order.notes}</p> : null}
                      </div>

                      <div className="grid grid-cols-3 gap-3 text-right text-sm">
                        <div>
                          <p className="text-xs text-muted-foreground">Total</p>
                          <p className="mt-1 font-medium">{formatCurrency(total)}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Used</p>
                          <p className="mt-1 font-medium">{formatCurrency(used)}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Remaining</p>
                          <p className="mt-1 font-medium">{formatCurrency(remaining)}</p>
                        </div>
                      </div>
                    </div>

                    <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                      <div className="text-sm text-muted-foreground">
                        Add more outsourced work rows after creation. Pay each row when the vendor work is completed.
                      </div>
                      <Button variant="outline" size="sm" onClick={() => openEditSheet(order)}>
                        <Pencil className="mr-2 h-4 w-4" />
                        Edit Sheet
                      </Button>
                    </div>

                    <div className="mt-4 overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow className="border-border/50">
                            <TableHead>Task Name</TableHead>
                            <TableHead>Description</TableHead>
                            <TableHead className="text-right">Amount</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead className="text-right">Pay</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {order.tasks.length === 0 ? (
                            <TableRow className="border-border/50">
                              <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                                No task rows inside this sheet yet.
                              </TableCell>
                            </TableRow>
                          ) : (
                            order.tasks.map((task: PurchaseOrderTask) => (
                              <TableRow key={task.id} className="border-border/50">
                                <TableCell className="font-medium">{task.taskName}</TableCell>
                                <TableCell className="text-muted-foreground">{task.description || "-"}</TableCell>
                                <TableCell className="text-right tabular-nums">{formatCurrency(task.amount)}</TableCell>
                                <TableCell>
                                  <Badge variant={task.status === "paid" ? "secondary" : "outline"} className="capitalize">
                                    {task.status}
                                  </Badge>
                                </TableCell>
                                <TableCell className="text-right">
                                  <Button
                                    size="sm"
                                    variant={task.status === "paid" ? "outline" : "default"}
                                    disabled={task.status === "paid" || payTaskMutation.isPending}
                                    onClick={() => payTaskMutation.mutate({ poId: order.id, taskId: task.id })}
                                  >
                                    {task.status === "paid" ? "Paid" : "Pay"}
                                  </Button>
                                </TableCell>
                              </TableRow>
                            ))
                          )}
                        </TableBody>
                      </Table>
                    </div>
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={sheetDialogOpen} onOpenChange={setSheetDialogOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>{editingState.mode === "create" ? "Create Purchase Order" : "Edit Purchase Order"}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>PO Title / Purpose</Label>
                <Input
                  value={form.title}
                  onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}
                  placeholder="Office Materials March"
                />
              </div>
              <div className="space-y-2">
                <Label>Total Fund Amount</Label>
                <Input
                  type="number"
                  value={form.totalAmount}
                  onChange={(event) => setForm((current) => ({ ...current, totalAmount: event.target.value }))}
                  placeholder="50000"
                />
              </div>
              <div className="space-y-2">
                <Label>Vendor <span className="font-normal text-muted-foreground">(optional)</span></Label>
                <Input
                  value={form.vendor}
                  onChange={(event) => setForm((current) => ({ ...current, vendor: event.target.value }))}
                  placeholder="External vendor name"
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
            </div>

            <div className="space-y-2">
              <Label>Notes <span className="font-normal text-muted-foreground">(optional)</span></Label>
              <Textarea
                value={form.notes}
                onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))}
                rows={3}
                placeholder="Internal notes about this outsourced work sheet"
              />
            </div>

            {editingState.mode === "edit" ? (
              <div className="space-y-4">
                <div className="rounded-xl border border-border/50 bg-secondary/10 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-medium">Add Task Later</h3>
                      <p className="text-xs text-muted-foreground">Append more outsourced work rows to this sheet whenever needed.</p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      type="button"
                      disabled={saveHeaderMutation.isPending}
                      onClick={() => saveHeaderMutation.mutate()}
                    >
                      Save Changes
                    </Button>
                  </div>

                  <div className="mt-4 grid gap-3 md:grid-cols-[1.2fr_1.5fr_0.7fr_auto]">
                    <Input
                      value={taskForm.taskName}
                      onChange={(event) => setTaskForm((current) => ({ ...current, taskName: event.target.value }))}
                      placeholder="Task name"
                    />
                    <Input
                      value={taskForm.description}
                      onChange={(event) => setTaskForm((current) => ({ ...current, description: event.target.value }))}
                      placeholder="Description"
                    />
                    <Input
                      type="number"
                      value={taskForm.amount}
                      onChange={(event) => setTaskForm((current) => ({ ...current, amount: event.target.value }))}
                      placeholder="Amount"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      disabled={!taskForm.taskName.trim() || normalizeAmount(taskForm.amount) <= 0 || addTaskMutation.isPending}
                      onClick={() => {
                        if (!editingOrder) {
                          return;
                        }

                        addTaskMutation.mutate({
                          poId: editingOrder.id,
                          task: taskForm,
                        });
                      }}
                    >
                      <Plus className="mr-2 h-4 w-4" />
                      Add
                    </Button>
                  </div>
                </div>

                <div className="rounded-xl border border-border/50 bg-secondary/10 p-4">
                  <h3 className="text-sm font-medium">Current Task Rows</h3>
                  <div className="mt-4 overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow className="border-border/50">
                          <TableHead>Task Name</TableHead>
                          <TableHead>Description</TableHead>
                          <TableHead className="text-right">Amount</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead className="text-right">Pay</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {editingOrder?.tasks.length ? (
                          editingOrder.tasks.map((task: PurchaseOrderTask) => (
                            <TableRow key={task.id} className="border-border/50">
                              <TableCell className="font-medium">{task.taskName}</TableCell>
                              <TableCell className="text-muted-foreground">{task.description || "-"}</TableCell>
                              <TableCell className="text-right tabular-nums">{formatCurrency(task.amount)}</TableCell>
                              <TableCell>
                                <Badge variant={task.status === "paid" ? "secondary" : "outline"} className="capitalize">
                                  {task.status}
                                </Badge>
                              </TableCell>
                              <TableCell className="text-right">
                                <Button
                                  size="sm"
                                  variant={task.status === "paid" ? "outline" : "default"}
                                  disabled={task.status === "paid" || payTaskMutation.isPending}
                                  onClick={() => payTaskMutation.mutate({ poId: editingOrder.id, taskId: task.id })}
                                >
                                  {task.status === "paid" ? "Paid" : "Pay"}
                                </Button>
                              </TableCell>
                            </TableRow>
                          ))
                        ) : (
                          <TableRow className="border-border/50">
                            <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                              No task rows inside this sheet yet.
                            </TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="rounded-xl border border-border/50 bg-secondary/10 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-medium">Initial Task Rows</h3>
                      <p className="text-xs text-muted-foreground">Add the outsourced work rows that belong to this PO.</p>
                    </div>
                    <Button type="button" variant="outline" size="sm" onClick={addDraftTaskRow}>
                      <Plus className="mr-2 h-4 w-4" />
                      Add Row
                    </Button>
                  </div>

                  <div className="mt-4 space-y-3">
                    {taskRows.map((task, index) => (
                      <div key={`${index}-${task.taskName}`} className="grid gap-3 rounded-lg border border-border/50 bg-background/80 p-3 md:grid-cols-[1.2fr_1.5fr_0.7fr]">
                        <Input
                          value={task.taskName}
                          onChange={(event) => updateTaskRow(index, "taskName", event.target.value)}
                          placeholder="Task name"
                        />
                        <Input
                          value={task.description}
                          onChange={(event) => updateTaskRow(index, "description", event.target.value)}
                          placeholder="Description"
                        />
                        <Input
                          type="number"
                          value={task.amount}
                          onChange={(event) => updateTaskRow(index, "amount", event.target.value)}
                          placeholder="Allocated amount"
                        />
                      </div>
                    ))}
                  </div>
                </div>

                <Button
                  className="w-full"
                  type="button"
                  disabled={!form.title.trim() || !form.totalAmount || createMutation.isPending}
                  onClick={createOrderSheet}
                >
                  Create Purchase Order
                </Button>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
