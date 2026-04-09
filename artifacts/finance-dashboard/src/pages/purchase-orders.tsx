import { useMemo, useState } from "react";
import { format } from "date-fns";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, Wallet, Coins, ArrowRight, CheckCircle2 } from "lucide-react";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { DashboardCard } from "@/components/dashboard-card";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api, type PurchaseOrder, type PurchaseOrderTask } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";

type PurchaseOrderForm = {
  title: string;
  totalAmount: string;
  vendor: string;
  date: string;
  notes: string;
};

type TaskDraft = {
  id: string;
  taskName: string;
  description: string;
  hours: string;
  rate: string;
};

type EditingState =
  | { mode: "create" }
  | { mode: "edit"; orderId: string };

function formatCurrency(value: number) {
  return value.toLocaleString("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  });
}

function normalizeNumber(value: string) {
  return Math.max(0, Number(value || 0));
}

function computeTaskAmount(input: Pick<TaskDraft, "hours" | "rate">) {
  return Math.round(normalizeNumber(input.hours) * normalizeNumber(input.rate));
}

function createTaskDraft(): TaskDraft {
  return {
    id: `draft_${Math.random().toString(36).slice(2, 10)}`,
    taskName: "",
    description: "",
    hours: "",
    rate: "",
  };
}

function getOrderTotals(order: PurchaseOrder) {
  const total = Math.max(0, Number(order.totalAmount ?? 0));
  const used = Math.max(0, Number(order.usedAmount ?? 0));
  const remaining = Math.max(0, Number(order.remainingAmount ?? total - used));
  return { total, used, remaining };
}

function getPlannedAmount(order: Pick<PurchaseOrder, "tasks">) {
  return order.tasks.reduce((sum, task) => sum + Math.max(0, Number(task.amount ?? 0)), 0);
}

function upsertPurchaseOrder(current: PurchaseOrder[] | undefined, nextOrder: PurchaseOrder) {
  if (!current) {
    return [nextOrder];
  }

  if (current.some((order) => order.id === nextOrder.id)) {
    return current.map((order) => (order.id === nextOrder.id ? nextOrder : order));
  }

  return [nextOrder, ...current];
}

function appendPurchaseOrderTask(current: PurchaseOrder[] | undefined, poId: string, task: PurchaseOrderTask) {
  if (!current) {
    return current;
  }

  return current.map((order) =>
    order.id === poId
      ? {
          ...order,
          tasks: [...order.tasks, task],
        }
      : order,
  );
}

export default function PurchaseOrdersPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [sheetDialogOpen, setSheetDialogOpen] = useState(false);
  const [editingState, setEditingState] = useState<EditingState>({ mode: "create" });
  const [purchaseOrderToDelete, setPurchaseOrderToDelete] = useState<PurchaseOrder | null>(null);
  const [form, setForm] = useState<PurchaseOrderForm>({
    title: "",
    totalAmount: "",
    vendor: "",
    date: new Date().toISOString().split("T")[0],
    notes: "",
  });
  const [taskRows, setTaskRows] = useState<TaskDraft[]>([createTaskDraft()]);
  const [taskForm, setTaskForm] = useState<TaskDraft>(createTaskDraft());
  const [showSettledSheets, setShowSettledSheets] = useState(false);

  const { data: purchaseOrders = [] } = useQuery({
    queryKey: ["purchaseOrders"],
    queryFn: api.getPurchaseOrders,
  });

  const activeEditingOrder =
    editingState.mode === "edit"
      ? purchaseOrders.find((order) => order.id === editingState.orderId) ?? null
      : null;
  const activeEditingPlannedAmount = activeEditingOrder ? getPlannedAmount(activeEditingOrder) : 0;
  const activeEditingHeadroom = activeEditingOrder
    ? Math.max(0, Number(activeEditingOrder.totalAmount ?? 0) - activeEditingPlannedAmount)
    : 0;

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

  const { activePurchaseOrders, settledPurchaseOrders } = useMemo(() => {
    const active: PurchaseOrder[] = [];
    const settled: PurchaseOrder[] = [];

    for (const order of purchaseOrders) {
      if (order.tasks.length > 0 && order.tasks.every((task) => task.status === "paid")) {
        settled.push(order);
      } else {
        active.push(order);
      }
    }

    return {
      activePurchaseOrders: active,
      settledPurchaseOrders: settled,
    };
  }, [purchaseOrders]);

  const createMutation = useMutation({
    mutationFn: async () =>
      api.createPurchaseOrder({
        title: form.title.trim(),
        totalAmount: normalizeNumber(form.totalAmount),
        vendor: form.vendor.trim(),
        date: form.date,
        notes: form.notes.trim(),
        tasks: taskRows
          .map((task) => ({
            taskName: task.taskName.trim(),
            description: task.description.trim(),
            hours: normalizeNumber(task.hours),
            rate: normalizeNumber(task.rate),
          }))
          .filter((task) => task.taskName && Math.round(task.hours * task.rate) > 0),
      }),
    onSuccess: (createdOrder) => {
      queryClient.setQueryData<PurchaseOrder[]>(["purchaseOrders"], (current) => upsertPurchaseOrder(current, createdOrder));
      toast({
        title: "PO created",
        description: "The sheet cap is saved. Funds will move only when a task row is paid.",
      });
      resetEditor();
      setSheetDialogOpen(false);
    },
    onError: (error) => {
      toast({
        title: "Could not create PO",
        description: error instanceof Error ? error.message : "Please check the form details.",
        variant: "destructive",
      });
    },
  });

  const saveHeaderMutation = useMutation({
    mutationFn: async () => {
      if (!activeEditingOrder) {
        throw new Error("Select a purchase order to edit.");
      }

      return api.updatePurchaseOrder({
        id: activeEditingOrder.id,
        title: form.title.trim(),
        totalAmount: normalizeNumber(form.totalAmount),
        vendor: form.vendor.trim(),
        date: form.date,
        notes: form.notes.trim(),
      });
    },
    onSuccess: (updatedOrder) => {
      queryClient.setQueryData<PurchaseOrder[]>(["purchaseOrders"], (current) => upsertPurchaseOrder(current, updatedOrder));
      toast({
        title: "PO updated",
        description: "The sheet cap and header details were updated.",
      });
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

  const addTaskMutation = useMutation({
    mutationFn: async ({ poId, task }: { poId: string; task: TaskDraft }) =>
      api.addPurchaseOrderTask({
        poId,
        taskName: task.taskName.trim(),
        description: task.description.trim(),
        hours: normalizeNumber(task.hours),
        rate: normalizeNumber(task.rate),
      }),
    onSuccess: (createdTask, variables) => {
      queryClient.setQueryData<PurchaseOrder[]>(["purchaseOrders"], (current) =>
        appendPurchaseOrderTask(current, variables.poId, createdTask),
      );
      toast({
        title: "Task row added",
        description: "The new work row is now part of this PO sheet.",
      });
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
    mutationFn: async ({ poId, taskId }: { poId: string; taskId: string }) => api.payPurchaseOrderTask({ poId, taskId }),
    onSuccess: (updatedOrder) => {
      queryClient.setQueryData<PurchaseOrder[]>(["purchaseOrders"], (current) => upsertPurchaseOrder(current, updatedOrder));
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: ["expenses"] }),
        queryClient.invalidateQueries({ queryKey: ["transactions"] }),
        queryClient.invalidateQueries({ queryKey: ["adminOverview"] }),
      ]);
      toast({
        title: "Task paid",
        description: "Only this paid row was deducted from the cap and available funds.",
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

  const deleteMutation = useMutation({
    mutationFn: async (purchaseOrderId: string) => {
      await api.deletePurchaseOrder(purchaseOrderId);
      return purchaseOrderId;
    },
    onSuccess: (deletedId) => {
      queryClient.setQueryData<PurchaseOrder[]>(["purchaseOrders"], (current) =>
        (current ?? []).filter((order) => order.id !== deletedId),
      );
      if (activeEditingOrder?.id === deletedId) {
        setSheetDialogOpen(false);
        resetEditor();
      }
      setPurchaseOrderToDelete(null);
      toast({
        title: "PO deleted",
        description: "The purchase order sheet was removed.",
      });
    },
    onError: (error) => {
      toast({
        title: "Could not delete PO",
        description: error instanceof Error ? error.message : "Please try again.",
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
    setEditingState({ mode: "edit", orderId: order.id });
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

  function addDraftTaskRow() {
    setTaskRows((current) => [...current, createTaskDraft()]);
  }

  function updateTaskRow(index: number, field: keyof TaskDraft, value: string) {
    setTaskRows((current) => current.map((row, rowIndex) => (rowIndex === index ? { ...row, [field]: value } : row)));
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Purchase Orders</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Work billing sheets with a fixed cap. Funds move only when an individual row is marked as paid.
            </p>
          </div>
          <Button onClick={openCreateSheet}>
            <Plus className="mr-2 h-4 w-4" />
            Create PO
          </Button>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
          <DashboardCard label="Sheet Cap" value={formatCurrency(totals.total)} icon={<Wallet className="h-5 w-5" />} />
          <DashboardCard label="Paid Rows" value={formatCurrency(totals.used)} icon={<Coins className="h-5 w-5" />} />
          <DashboardCard label="Cap Remaining" value={formatCurrency(totals.remaining)} icon={<ArrowRight className="h-5 w-5" />} />
          <DashboardCard label="Active Sheets" value={String(totals.active)} icon={<CheckCircle2 className="h-5 w-5" />} />
        </div>

        <Card className="border-border/50">
          <CardHeader className="flex flex-row items-center justify-between">
            <div className="space-y-1">
              <CardTitle className="text-base">PO Work Sheets</CardTitle>
              <p className="text-sm text-muted-foreground">
                The sheet amount is only a limit. Paying a task row is what actually deducts funds.
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={openCreateSheet}>
              <Plus className="mr-2 h-4 w-4" />
              New Sheet
            </Button>
          </CardHeader>
          <CardContent className="space-y-4">
            {activePurchaseOrders.length === 0 ? (
              <div className="py-12 text-center text-sm text-muted-foreground">No purchase orders created yet.</div>
            ) : (
              activePurchaseOrders.map((order) => {
                const { total, used, remaining } = getOrderTotals(order);
                const planned = getPlannedAmount(order);
                const planningHeadroom = Math.max(0, total - planned);
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

                      <div className="grid grid-cols-4 gap-3 text-right text-sm">
                        <div>
                          <p className="text-xs text-muted-foreground">Cap</p>
                          <p className="mt-1 font-medium">{formatCurrency(total)}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Planned</p>
                          <p className="mt-1 font-medium">{formatCurrency(planned)}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Paid</p>
                          <p className="mt-1 font-medium">{formatCurrency(used)}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Remaining</p>
                          <p className="mt-1 font-medium">{formatCurrency(remaining)}</p>
                        </div>
                      </div>
                    </div>

                    <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                      <p className="text-sm text-muted-foreground">
                        Each row calculates its own total from hours and hourly rate. Unpaid rows remain only planned work.
                        {` Planning headroom: ${formatCurrency(planningHeadroom)}.`}
                      </p>
                      <div className="flex items-center gap-2">
                        <Button variant="outline" size="sm" onClick={() => openEditSheet(order)}>
                          <Pencil className="mr-2 h-4 w-4" />
                          Edit Sheet
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => setPurchaseOrderToDelete(order)}>
                          Delete PO
                        </Button>
                      </div>
                    </div>

                    <div className="mt-4 overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow className="border-border/50">
                            <TableHead>Work Row</TableHead>
                            <TableHead>Description</TableHead>
                            <TableHead className="text-right">Hours</TableHead>
                            <TableHead className="text-right">Rate / Hr</TableHead>
                            <TableHead className="text-right">Total</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead className="text-right">Pay</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {order.tasks.length === 0 ? (
                            <TableRow className="border-border/50">
                              <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                                No work rows inside this sheet yet.
                              </TableCell>
                            </TableRow>
                          ) : (
                            order.tasks.map((task) => (
                              <TableRow key={task.id} className="border-border/50">
                                <TableCell className="font-medium">{task.taskName}</TableCell>
                                <TableCell className="text-muted-foreground">{task.description || "-"}</TableCell>
                                <TableCell className="text-right tabular-nums">{task.hours.toFixed(1)}</TableCell>
                                <TableCell className="text-right tabular-nums">{formatCurrency(task.rate)}</TableCell>
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

        {settledPurchaseOrders.length > 0 ? (
          <div className="flex justify-end">
            <Button
              variant="outline"
              className="rounded-xl"
              onClick={() => setShowSettledSheets((current) => !current)}
            >
              {showSettledSheets ? "Hide Settled POs" : `Settled POs (${settledPurchaseOrders.length})`}
            </Button>
          </div>
        ) : null}

        {showSettledSheets && settledPurchaseOrders.length > 0 ? (
          <Card className="border-border/50">
            <CardHeader>
              <CardTitle className="text-base">Settled PO Sheets</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {settledPurchaseOrders.map((order) => {
                const { total, used, remaining } = getOrderTotals(order);
                const planned = getPlannedAmount(order);

                return (
                  <div key={order.id} className="rounded-xl border border-border/50 bg-secondary/10 p-4">
                    <div className="flex flex-col gap-4 border-b border-border/50 pb-4 md:flex-row md:items-start md:justify-between">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <h2 className="text-base font-semibold">{order.title}</h2>
                          <Badge variant="outline" className="font-normal">
                            Settled
                          </Badge>
                        </div>
                        <p className="text-sm text-muted-foreground">
                          {order.vendor ? `${order.vendor} - ` : ""}
                          {format(new Date(order.date), "dd MMM yyyy")}
                        </p>
                      </div>

                      <div className="grid grid-cols-4 gap-3 text-right text-sm">
                        <div>
                          <p className="text-xs text-muted-foreground">Cap</p>
                          <p className="mt-1 font-medium">{formatCurrency(total)}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Planned</p>
                          <p className="mt-1 font-medium">{formatCurrency(planned)}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Paid</p>
                          <p className="mt-1 font-medium">{formatCurrency(used)}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Remaining</p>
                          <p className="mt-1 font-medium">{formatCurrency(remaining)}</p>
                        </div>
                      </div>
                    </div>

                    <div className="mt-4 overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow className="border-border/50">
                            <TableHead>Work Row</TableHead>
                            <TableHead>Description</TableHead>
                            <TableHead className="text-right">Hours</TableHead>
                            <TableHead className="text-right">Rate / Hr</TableHead>
                            <TableHead className="text-right">Total</TableHead>
                            <TableHead>Status</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {order.tasks.map((task) => (
                            <TableRow key={task.id} className="border-border/50">
                              <TableCell className="font-medium">{task.taskName}</TableCell>
                              <TableCell className="text-muted-foreground">{task.description || "-"}</TableCell>
                              <TableCell className="text-right tabular-nums">{task.hours.toFixed(1)}</TableCell>
                              <TableCell className="text-right tabular-nums">{formatCurrency(task.rate)}</TableCell>
                              <TableCell className="text-right tabular-nums">{formatCurrency(task.amount)}</TableCell>
                              <TableCell>
                                <Badge variant="outline" className="font-normal capitalize">
                                  {task.status}
                                </Badge>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        ) : null}
      </div>

      <Dialog open={sheetDialogOpen} onOpenChange={setSheetDialogOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-5xl">
          <DialogHeader>
            <DialogTitle>{editingState.mode === "create" ? "Create Purchase Order" : "Edit Purchase Order"}</DialogTitle>
          </DialogHeader>

          <div className="space-y-5">
            <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4 text-sm text-muted-foreground">
              This PO amount acts only as a cap. Creating the sheet or adding rows does not deduct funds. Money moves only when a row is marked as paid.
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>PO Title / Purpose</Label>
                <Input
                  value={form.title}
                  onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}
                  placeholder="March outsourced drafting work"
                />
              </div>
              <div className="space-y-2">
                <Label>PO Cap Amount</Label>
                <Input
                  type="number"
                  value={form.totalAmount}
                  onChange={(event) => setForm((current) => ({ ...current, totalAmount: event.target.value }))}
                  placeholder="50000"
                />
              </div>
              <div className="space-y-2">
                <Label>
                  Vendor <span className="font-normal text-muted-foreground">(optional)</span>
                </Label>
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
              <Label>
                Notes <span className="font-normal text-muted-foreground">(optional)</span>
              </Label>
              <Textarea
                value={form.notes}
                onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))}
                rows={3}
                placeholder="Internal notes about this outsourced work sheet"
              />
            </div>

            {editingState.mode === "edit" && activeEditingOrder ? (
              <div className="space-y-4">
                <div className="grid gap-4 md:grid-cols-4">
                  {[
                    { label: "Cap", value: formatCurrency(getOrderTotals(activeEditingOrder).total) },
                    { label: "Planned", value: formatCurrency(activeEditingPlannedAmount) },
                    { label: "Paid", value: formatCurrency(getOrderTotals(activeEditingOrder).used) },
                    { label: "Remaining", value: formatCurrency(getOrderTotals(activeEditingOrder).remaining) },
                  ].map((item) => (
                    <div key={item.label} className="rounded-xl border border-border/50 bg-secondary/10 p-4">
                      <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">{item.label}</p>
                      <p className="mt-2 text-lg font-semibold">{item.value}</p>
                    </div>
                  ))}
                </div>

                <div className="rounded-xl border border-border/50 bg-secondary/10 p-4 text-sm text-muted-foreground">
                  Remaining planning headroom: <span className="font-medium text-foreground">{formatCurrency(activeEditingHeadroom)}</span>
                </div>

                <div className="rounded-xl border border-border/50 bg-secondary/10 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-medium">Header and Cap</h3>
                      <p className="text-xs text-muted-foreground">
                        Update the sheet header or cap any time, as long as the cap stays above the already paid total.
                      </p>
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
                  <div className="mt-3 flex justify-end">
                    <Button
                      variant="outline"
                      size="sm"
                      type="button"
                      disabled={deleteMutation.isPending}
                      onClick={() => setPurchaseOrderToDelete(activeEditingOrder)}
                    >
                      Delete PO
                    </Button>
                  </div>
                </div>

                <div className="rounded-xl border border-border/50 bg-secondary/10 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-medium">Add Work Row</h3>
                      <p className="text-xs text-muted-foreground">
                        Add more rows later. Each row total is calculated from hours and rate.
                      </p>
                    </div>
                  </div>

                  <div className="mt-4 grid gap-3 md:grid-cols-[1.1fr_1.4fr_0.6fr_0.7fr_0.8fr_auto]">
                    <Input
                      value={taskForm.taskName}
                      onChange={(event) => setTaskForm((current) => ({ ...current, taskName: event.target.value }))}
                      placeholder="Work row"
                    />
                    <Input
                      value={taskForm.description}
                      onChange={(event) => setTaskForm((current) => ({ ...current, description: event.target.value }))}
                      placeholder="Description"
                    />
                    <Input
                      type="number"
                      step="0.5"
                      value={taskForm.hours}
                      onChange={(event) => setTaskForm((current) => ({ ...current, hours: event.target.value }))}
                      placeholder="Hours"
                    />
                    <Input
                      type="number"
                      value={taskForm.rate}
                      onChange={(event) => setTaskForm((current) => ({ ...current, rate: event.target.value }))}
                      placeholder="Rate"
                    />
                    <div className="flex items-center rounded-md border border-border/50 bg-background px-3 text-sm font-medium">
                      {formatCurrency(computeTaskAmount(taskForm))}
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={
                        !taskForm.taskName.trim() ||
                        computeTaskAmount(taskForm) <= 0 ||
                        computeTaskAmount(taskForm) > activeEditingHeadroom ||
                        addTaskMutation.isPending
                      }
                      onClick={() => addTaskMutation.mutate({ poId: activeEditingOrder.id, task: taskForm })}
                    >
                      <Plus className="mr-2 h-4 w-4" />
                      Add
                    </Button>
                  </div>
                </div>

                <div className="rounded-xl border border-border/50 bg-secondary/10 p-4">
                  <h3 className="text-sm font-medium">Current Work Rows</h3>
                  <div className="mt-4 overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow className="border-border/50">
                          <TableHead>Work Row</TableHead>
                          <TableHead>Description</TableHead>
                          <TableHead className="text-right">Hours</TableHead>
                          <TableHead className="text-right">Rate / Hr</TableHead>
                          <TableHead className="text-right">Total</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead className="text-right">Pay</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {activeEditingOrder.tasks.length ? (
                          activeEditingOrder.tasks.map((task) => (
                            <TableRow key={task.id} className="border-border/50">
                              <TableCell className="font-medium">{task.taskName}</TableCell>
                              <TableCell className="text-muted-foreground">{task.description || "-"}</TableCell>
                              <TableCell className="text-right tabular-nums">{task.hours.toFixed(1)}</TableCell>
                              <TableCell className="text-right tabular-nums">{formatCurrency(task.rate)}</TableCell>
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
                                  onClick={() => payTaskMutation.mutate({ poId: activeEditingOrder.id, taskId: task.id })}
                                >
                                  {task.status === "paid" ? "Paid" : "Pay"}
                                </Button>
                              </TableCell>
                            </TableRow>
                          ))
                        ) : (
                          <TableRow className="border-border/50">
                            <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                              No work rows inside this sheet yet.
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
                      <h3 className="text-sm font-medium">Initial Work Rows</h3>
                      <p className="text-xs text-muted-foreground">
                        Add any rows you already know. You can still append more later after the sheet is created.
                      </p>
                    </div>
                    <Button type="button" variant="outline" size="sm" onClick={addDraftTaskRow}>
                      <Plus className="mr-2 h-4 w-4" />
                      Add Row
                    </Button>
                  </div>

                  <div className="mt-4 space-y-3">
                    {taskRows.map((task, index) => (
                      <div
                        key={task.id}
                        className="grid gap-3 rounded-lg border border-border/50 bg-background/80 p-3 md:grid-cols-[1.1fr_1.4fr_0.6fr_0.7fr_0.8fr]"
                      >
                        <Input
                          value={task.taskName}
                          onChange={(event) => updateTaskRow(index, "taskName", event.target.value)}
                          placeholder="Work row"
                        />
                        <Input
                          value={task.description}
                          onChange={(event) => updateTaskRow(index, "description", event.target.value)}
                          placeholder="Description"
                        />
                        <Input
                          type="number"
                          step="0.5"
                          value={task.hours}
                          onChange={(event) => updateTaskRow(index, "hours", event.target.value)}
                          placeholder="Hours"
                        />
                        <Input
                          type="number"
                          value={task.rate}
                          onChange={(event) => updateTaskRow(index, "rate", event.target.value)}
                          placeholder="Rate / Hr"
                        />
                        <div className="flex items-center rounded-md border border-border/50 bg-secondary/10 px-3 text-sm font-medium">
                          {formatCurrency(computeTaskAmount(task))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <Button
                  className="w-full"
                  type="button"
                  disabled={!form.title.trim() || !form.totalAmount || createMutation.isPending}
                  onClick={() => createMutation.mutate()}
                >
                  Create Purchase Order
                </Button>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={Boolean(purchaseOrderToDelete)} onOpenChange={(open) => !open && setPurchaseOrderToDelete(null)}>
        <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete purchase order?</AlertDialogTitle>
              <AlertDialogDescription>
                {purchaseOrderToDelete?.tasks.some((task) => task.status === "paid")
                  ? `This sheet already has paid rows, so it should be kept for record history and cannot be deleted.`
                  : `This will permanently remove `}
                {!purchaseOrderToDelete?.tasks.some((task) => task.status === "paid") ? (
                  <span className="font-medium text-foreground">{purchaseOrderToDelete?.title}</span>
                ) : null}
                {!purchaseOrderToDelete?.tasks.some((task) => task.status === "paid")
                  ? " and all of its planned work rows. This action cannot be undone."
                  : ""}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={deleteMutation.isPending}>Cancel</AlertDialogCancel>
              <AlertDialogAction
              disabled={
                deleteMutation.isPending ||
                !purchaseOrderToDelete ||
                purchaseOrderToDelete.tasks.some((task) => task.status === "paid")
              }
              onClick={(event) => {
                event.preventDefault();
                if (!purchaseOrderToDelete) {
                  return;
                }
                deleteMutation.mutate(purchaseOrderToDelete.id);
              }}
            >
              {deleteMutation.isPending ? "Deleting..." : "Delete PO"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </DashboardLayout>
  );
}
