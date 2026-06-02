import { useMemo, useState } from "react";
import { format } from "date-fns";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Plus } from "lucide-react";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
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
import { api, type PreApproval, type PreApprovalPartyInfo, type PreApprovalProjectInfo } from "@/lib/api";
import { exportPreApprovalPdf } from "@/lib/pre-approval-export";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

type WorkRowDraft = {
  id: string;
  lineType: "work" | "expense";
  taskName: string;
  description: string;
  hours: string;
  rate: string;
  amount: string;
};

type FormState = {
  title: string;
  project: string;
  clientId: string;
  date: string;
  notes: string;
};

const emptyPartyInfo: PreApprovalPartyInfo = {
  companyName: "",
  address: "",
  phone: "",
  email: "",
  website: "",
};

const emptyProjectInfo: PreApprovalProjectInfo = {
  documentNumber: "",
  revision: "01",
  workDescription: "",
  projectStartDate: "",
  projectCompletionDate: "",
  totalContractValue: 0,
  retainagePercent: 0,
  retainageAmount: 0,
  previouslyBilledAmount: 0,
};

function clientToPartyInfo(client: { name: string; email: string; phone?: string; company?: string; address?: string; website?: string; billingEmail?: string } | undefined): PreApprovalPartyInfo {
  return {
    companyName: client?.company || client?.name || "",
    address: client?.address ?? "",
    phone: client?.phone ?? "",
    email: client?.billingEmail || client?.email || "",
    website: client?.website ?? "",
  };
}

function createRow(): WorkRowDraft {
  return {
    id: `row_${Math.random().toString(36).slice(2, 10)}`,
    lineType: "work",
    taskName: "",
    description: "",
    hours: "",
    rate: "",
    amount: "",
  };
}

function formatDocDateCode(value?: string) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) {
    return formatDocDateCode();
  }

  const year = String(date.getFullYear()).slice(-2);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}

function createDocumentNumber(date: string) {
  return `REFO-${formatDocDateCode(date)}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

function isAutoDocumentNumber(value?: string) {
  return /^REFO-\d{6}-[A-Z0-9]{4}$/.test(value?.trim() ?? "");
}

function formatCurrency(value: number) {
  return value.toLocaleString("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  });
}

function amountFor(row: WorkRowDraft) {
  if (row.lineType === "expense") {
    return Math.round(Math.max(0, Number(row.amount || 0)));
  }

  return Math.round(Math.max(0, Number(row.hours || 0)) * Math.max(0, Number(row.rate || 0)));
}

function isExpenseTask(task: { lineType?: "work" | "expense" }) {
  return task.lineType === "expense";
}

function statusLabel(status: PreApproval["status"]) {
  return status === "changes_requested" ? "Changes Requested" : status.replace("_", " ");
}

function upsertPreApproval(current: PreApproval[] | undefined, next: PreApproval) {
  if (!current) {
    return [next];
  }

  if (current.some((item) => item.id === next.id)) {
    return current.map((item) => (item.id === next.id ? next : item));
  }

  return [next, ...current];
}

function statusBadgeClass(status: PreApproval["status"]) {
  if (status === "approved") {
    return "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400";
  }

  if (status === "changes_requested") {
    return "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400";
  }

  if (status === "submitted") {
    return "border-sky-500/40 bg-sky-500/10 text-sky-600 dark:text-sky-400";
  }

  return "";
}

export default function PreApprovalsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<PreApproval | null>(null);
  const [preApprovalToDelete, setPreApprovalToDelete] = useState<PreApproval | null>(null);
  const [commentDraft, setCommentDraft] = useState<Record<string, string>>({});
  const [showPreviousApprovals, setShowPreviousApprovals] = useState(false);
  const [companyInfo, setCompanyInfo] = useState<PreApprovalPartyInfo>(emptyPartyInfo);
  const [clientInfo, setClientInfo] = useState<PreApprovalPartyInfo>(emptyPartyInfo);
  const [projectInfo, setProjectInfo] = useState<PreApprovalProjectInfo>(emptyProjectInfo);
  const [form, setForm] = useState<FormState>({
    title: "",
    project: "",
    clientId: "",
    date: new Date().toISOString().slice(0, 10),
    notes: "",
  });
  const [rows, setRows] = useState<WorkRowDraft[]>([createRow()]);

  const { data: preApprovals = [] } = useQuery({
    queryKey: ["preApprovals"],
    queryFn: api.getPreApprovals,
  });
  const { data: clients = [] } = useQuery({
    queryKey: ["clients"],
    queryFn: api.getClients,
  });
  const { data: companySettings = emptyPartyInfo } = useQuery({
    queryKey: ["companySettings"],
    queryFn: api.getCompanySettings,
  });

  const totals = useMemo(() => {
    return preApprovals.reduce(
      (acc, item) => {
        acc.total += item.totalAmount;
        acc.hours += item.totalHours;
        acc.pending += item.status === "submitted" ? 1 : 0;
        acc.returned += item.status === "changes_requested" ? 1 : 0;
        acc.approved += item.status === "approved" ? 1 : 0;
        acc.awaitingReceipt += item.status === "approved" && !item.receivedAt ? 1 : 0;
        return acc;
      },
      { total: 0, hours: 0, pending: 0, returned: 0, approved: 0, awaitingReceipt: 0 },
    );
  }, [preApprovals]);

  const previousApprovals = useMemo(
    () => preApprovals.filter((item) => item.status === "approved"),
    [preApprovals],
  );

  const activeApprovals = useMemo(
    () => preApprovals.filter((item) => item.status !== "approved"),
    [preApprovals],
  );

  const formTotals = useMemo(() => {
    return rows.reduce(
      (acc, row) => {
        const hours = row.lineType === "expense" ? 0 : Math.max(0, Number(row.hours || 0));
        acc.hours += hours;
        acc.amount += amountFor(row);
        return acc;
      },
      { hours: 0, amount: 0 },
    );
  }, [rows]);

  const payload = () => ({
    title: form.title.trim(),
    project: form.project.trim(),
    clientId: form.clientId,
    date: form.date,
    notes: form.notes.trim(),
    companyInfo,
    clientInfo,
    projectInfo,
    tasks: rows
      .map((row) => ({
        id: row.id,
        lineType: row.lineType,
        taskName: row.taskName.trim(),
        description: row.description.trim(),
        hours: row.lineType === "expense" ? 0 : Math.max(0, Number(row.hours || 0)),
        rate: row.lineType === "expense" ? 0 : Math.max(0, Number(row.rate || 0)),
        amount: amountFor(row),
      }))
      .filter((row) => row.taskName && row.amount > 0),
  });

  const saveMutation = useMutation({
    mutationFn: () => (editing ? api.updatePreApproval({ id: editing.id, ...payload() }) : api.createPreApproval(payload())),
    onSuccess: (saved) => {
      queryClient.setQueryData<PreApproval[]>(["preApprovals"], (current) => upsertPreApproval(current, saved));
      toast({ title: editing ? "Pre-approval updated" : "Pre-approval created", description: "The client approval sheet is saved." });
      closeDialog();
    },
    onError: (error) => {
      toast({
        title: "Could not save pre-approval",
        description: error instanceof Error ? error.message : "Please check the sheet details.",
        variant: "destructive",
      });
    },
  });

  const submitMutation = useMutation({
    mutationFn: api.submitPreApproval,
    onSuccess: (saved) => {
      queryClient.setQueryData<PreApproval[]>(["preApprovals"], (current) => upsertPreApproval(current, saved));
      toast({ title: "Sent to client", description: "The pre-approval is now visible on the client dashboard." });
    },
    onError: (error) => {
      toast({
        title: "Could not send pre-approval",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    },
  });

  const commentMutation = useMutation({
    mutationFn: ({ id, message }: { id: string; message: string }) => api.commentOnPreApproval(id, message),
    onSuccess: (saved) => {
      queryClient.setQueryData<PreApproval[]>(["preApprovals"], (current) => upsertPreApproval(current, saved));
      setCommentDraft((current) => ({ ...current, [saved.id]: "" }));
      toast({ title: "Reply sent", description: "Your comment was added to the client thread." });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: api.deletePreApproval,
    onSuccess: (_, id) => {
      queryClient.setQueryData<PreApproval[]>(["preApprovals"], (current = []) => current.filter((item) => item.id !== id));
      setPreApprovalToDelete(null);
      toast({ title: "Pre-approval deleted", description: "The draft approval sheet was removed." });
    },
  });

  const receiveMutation = useMutation({
    mutationFn: api.receivePreApprovalFunds,
    onSuccess: (saved) => {
      queryClient.setQueryData<PreApproval[]>(["preApprovals"], (current) => upsertPreApproval(current, saved));
      queryClient.invalidateQueries({ queryKey: ["funds"] });
      queryClient.invalidateQueries({ queryKey: ["adminOverview"] });
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
      toast({ title: "Funds received", description: "The approved quotation has been added to Funds." });
    },
    onError: (error) => {
      toast({
        title: "Could not mark received",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    },
  });

  function openCreate() {
    const defaultClient = clients[0];
    const today = new Date().toISOString().slice(0, 10);
    setEditing(null);
    setForm({
      title: "",
      project: "",
      clientId: defaultClient?.id ?? "",
      date: today,
      notes: "",
    });
    setCompanyInfo({ ...emptyPartyInfo, ...companySettings });
    setClientInfo(clientToPartyInfo(defaultClient));
    setProjectInfo({ ...emptyProjectInfo, documentNumber: createDocumentNumber(today), revision: "01" });
    setRows([createRow()]);
    setDialogOpen(true);
  }

  function openEdit(item: PreApproval) {
    setEditing(item);
    setForm({
      title: item.title,
      project: item.project,
      clientId: item.clientId,
      date: format(new Date(item.date), "yyyy-MM-dd"),
      notes: item.notes ?? "",
    });
    setCompanyInfo({ ...emptyPartyInfo, ...item.companyInfo });
    setClientInfo({ ...emptyPartyInfo, ...item.clientInfo });
    setProjectInfo({ ...emptyProjectInfo, ...item.projectInfo });
    setRows(
      item.tasks.length
        ? item.tasks.map((task) => ({
            id: task.id,
            lineType: task.lineType === "expense" ? "expense" : "work",
            taskName: task.taskName,
            description: task.description,
            hours: String(task.hours),
            rate: String(task.rate),
            amount: String(task.amount),
          }))
        : [createRow()],
    );
    setDialogOpen(true);
  }

  function closeDialog() {
    setDialogOpen(false);
    setEditing(null);
    setRows([createRow()]);
  }

  function updateRow<K extends keyof WorkRowDraft>(index: number, field: K, value: WorkRowDraft[K]) {
    setRows((current) => current.map((row, rowIndex) => (rowIndex === index ? { ...row, [field]: value } : row)));
  }

  function updateCompanyInfo(field: keyof PreApprovalPartyInfo, value: string) {
    setCompanyInfo((current) => ({ ...current, [field]: value }));
  }

  function updateClientInfo(field: keyof PreApprovalPartyInfo, value: string) {
    setClientInfo((current) => ({ ...current, [field]: value }));
  }

  function updateProjectInfo(field: keyof PreApprovalProjectInfo, value: string) {
    setProjectInfo((current) => ({ ...current, [field]: field.includes("Amount") || field === "retainagePercent" ? Math.max(0, Number(value || 0)) : value }));
  }

  function updateDocumentDate(date: string) {
    setForm((current) => ({ ...current, date }));
    setProjectInfo((current) => ({
      ...current,
      documentNumber: !current.documentNumber || isAutoDocumentNumber(current.documentNumber) ? createDocumentNumber(date) : current.documentNumber,
    }));
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Pre Approval</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Send work-hour quotations to clients before converting them into live PO work.
            </p>
          </div>
          <Button onClick={openCreate}>
            <Plus className="mr-2 h-4 w-4" />
            Create Pre Approval
          </Button>
        </div>

        <Card className="border-border/60 bg-card/80">
          <CardContent className="grid gap-0 p-0 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { label: "Total Quotation", value: formatCurrency(totals.total) },
              { label: "Total Hours", value: `${totals.hours.toFixed(1)}h` },
              { label: "Awaiting Client", value: String(totals.pending) },
              { label: "Awaiting Receipt", value: String(totals.awaitingReceipt) },
            ].map((item, index) => (
              <div
                key={item.label}
                className={cn(
                  "px-5 py-4",
                  index > 0 && "border-t border-border/60 sm:border-l sm:border-t-0",
                  index === 2 && "sm:border-l-0 lg:border-l",
                )}
              >
                <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">{item.label}</p>
                <p className="mt-2 text-xl font-semibold tabular-nums">{item.value}</p>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="border-border/60 bg-card/80">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Client Approval Sheets</CardTitle>
            <p className="text-sm text-muted-foreground">
              Quotation records, review status, and client conversation in one place.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            {activeApprovals.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border/70 py-12 text-center text-sm text-muted-foreground">
                {preApprovals.length === 0 ? "No pre-approvals created yet." : "No active pre-approvals right now."}
              </div>
            ) : (
              activeApprovals.map((item) => (
                <div id={`pre-approval-${item.id}`} key={item.id} className="scroll-mt-6 rounded-xl border border-border/60 bg-background/70 p-4">
                  <div className="flex flex-col gap-4 border-b border-border/50 pb-4 md:flex-row md:items-start md:justify-between">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="font-semibold">{item.title}</h2>
                        <Badge variant="outline" className={cn("capitalize", statusBadgeClass(item.status))}>
                          {statusLabel(item.status)}
                        </Badge>
                      </div>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {item.project} · {item.clientNameSnapshot} · {format(new Date(item.date), "dd MMM yyyy")}
                      </p>
                      {item.notes ? <p className="mt-2 max-w-3xl text-sm text-muted-foreground">{item.notes}</p> : null}
                    </div>
                    <div className="rounded-lg border border-border/50 bg-secondary/10 px-4 py-3 text-left md:min-w-44 md:text-right">
                      <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Total Quotation</p>
                      <p className="mt-1 text-lg font-semibold">{formatCurrency(item.totalAmount)}</p>
                      <p className="mt-1 text-xs text-muted-foreground">{item.totalHours.toFixed(1)} total hours</p>
                    </div>
                  </div>

                  <div className="mt-4 overflow-x-auto rounded-lg border border-border/50">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Workflow / Discipline</TableHead>
                          <TableHead>Task Description</TableHead>
                          <TableHead className="text-right">Hours</TableHead>
                          <TableHead className="text-right">Rate / Hr</TableHead>
                          <TableHead className="text-right">Total</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {item.tasks.map((task) => (
                          <TableRow key={task.id}>
                            <TableCell className="font-medium">
                              <div>{task.taskName}</div>
                              {isExpenseTask(task) ? <div className="mt-1 text-xs text-muted-foreground">Expense item</div> : null}
                            </TableCell>
                            <TableCell className="text-muted-foreground">{task.description || "-"}</TableCell>
                            <TableCell className="text-right tabular-nums">{isExpenseTask(task) ? "-" : task.hours.toFixed(1)}</TableCell>
                            <TableCell className="text-right tabular-nums">{isExpenseTask(task) ? "-" : formatCurrency(task.rate)}</TableCell>
                            <TableCell className="text-right tabular-nums">{formatCurrency(task.amount)}</TableCell>
                          </TableRow>
                        ))}
                        <TableRow className="bg-secondary/20 hover:bg-secondary/20">
                          <TableCell className="font-semibold" colSpan={2}>
                            Total
                          </TableCell>
                          <TableCell className="text-right font-semibold tabular-nums">{item.totalHours.toFixed(1)}</TableCell>
                          <TableCell />
                          <TableCell className="text-right font-semibold tabular-nums">{formatCurrency(item.totalAmount)}</TableCell>
                        </TableRow>
                      </TableBody>
                    </Table>
                  </div>

                  {item.comments.length > 0 ? (
                    <div className="mt-4 space-y-2 rounded-lg border border-border/50 bg-secondary/10 p-3">
                      {item.comments.slice(-3).map((comment) => (
                        <div key={comment.id} className="text-sm">
                          <span className="font-medium">{comment.authorName}</span>
                          <span className="text-muted-foreground"> · {format(new Date(comment.createdAt), "dd MMM, HH:mm")}</span>
                          <p className="mt-1 text-muted-foreground">{comment.message}</p>
                        </div>
                      ))}
                    </div>
                  ) : null}

                  <div className="mt-4 grid gap-3 border-t border-border/50 pt-4 md:grid-cols-[1fr_auto]">
                    <Input
                      value={commentDraft[item.id] ?? ""}
                      onChange={(event) => setCommentDraft((current) => ({ ...current, [item.id]: event.target.value }))}
                      placeholder="Write back to the client..."
                    />
                    <Button
                      variant="outline"
                      disabled={!commentDraft[item.id]?.trim() || commentMutation.isPending}
                      onClick={() => commentMutation.mutate({ id: item.id, message: commentDraft[item.id] })}
                    >
                      Reply
                    </Button>
                  </div>

                  <div className="mt-4 flex flex-wrap justify-end gap-2">
                    <Button variant="outline" size="sm" onClick={() => exportPreApprovalPdf(item)}>
                      <Download className="mr-2 h-4 w-4" />
                      Export PDF
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => openEdit(item)} disabled={item.status === "approved"}>
                      Edit Sheet
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPreApprovalToDelete(item)}
                      disabled={item.status === "approved"}
                    >
                      Delete
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => submitMutation.mutate(item.id)}
                      disabled={item.status === "approved" || Boolean(item.receivedAt) || submitMutation.isPending}
                    >
                      {item.status === "submitted" ? "Resend" : "Send to Client"}
                    </Button>
                  </div>
                </div>
              ))
            )}

            {previousApprovals.length > 0 ? (
              <div className="flex justify-end border-t border-border/50 pt-4">
                <Button variant="outline" size="sm" onClick={() => setShowPreviousApprovals((current) => !current)}>
                  {showPreviousApprovals ? "Hide Previous Pre approvals" : `Previous Pre approvals (${previousApprovals.length})`}
                </Button>
              </div>
            ) : null}
          </CardContent>
        </Card>

        {showPreviousApprovals && previousApprovals.length > 0 ? (
          <Card className="border-border/60 bg-card/80">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Previous Pre approvals</CardTitle>
              <p className="text-sm text-muted-foreground">
                Approved quotations that were marked as received and moved into funds.
              </p>
            </CardHeader>
            <CardContent className="space-y-3">
              {previousApprovals.map((item) => (
                <div
                  key={item.id}
                  className="flex flex-col gap-3 rounded-lg border border-border/60 bg-background/70 p-4 md:flex-row md:items-center md:justify-between"
                >
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium">{item.title}</p>
                      <Badge variant="outline" className={cn("capitalize", statusBadgeClass(item.status))}>
                        {item.receivedAt ? "Received" : "Approved"}
                      </Badge>
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {item.project} - {item.clientNameSnapshot} - {item.totalHours.toFixed(1)}h - {formatCurrency(item.totalAmount)}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {item.receivedAt
                        ? `Received on ${format(new Date(item.receivedAt), "dd MMM yyyy")}`
                        : "Approved by client, waiting for funds to be marked received."}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2 md:justify-end">
                    <Button variant="outline" size="sm" onClick={() => exportPreApprovalPdf(item)}>
                      <Download className="mr-2 h-4 w-4" />
                      Export PDF
                    </Button>
                    {!item.receivedAt ? (
                      <Button
                        size="sm"
                        className="bg-emerald-600 text-white hover:bg-emerald-500"
                        disabled={receiveMutation.isPending}
                        onClick={() => receiveMutation.mutate(item.id)}
                      >
                        Received
                      </Button>
                    ) : null}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        ) : null}
      </div>

      <Dialog open={dialogOpen} onOpenChange={(open) => (open ? setDialogOpen(true) : closeDialog())}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-5xl">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Pre Approval" : "Create Pre Approval"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-5">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>Title</Label>
                <Input value={form.title} onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Project</Label>
                <Input value={form.project} onChange={(event) => setForm((current) => ({ ...current, project: event.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Client</Label>
                <select
                  value={form.clientId}
                  onChange={(event) => {
                    const clientId = event.target.value;
                    setForm((current) => ({ ...current, clientId }));
                    setClientInfo(clientToPartyInfo(clients.find((client) => client.id === clientId)));
                  }}
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="">Select client</option>
                  {clients.map((client) => (
                    <option key={client.id} value={client.id}>
                      {client.name} {client.company ? `· ${client.company}` : ""}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label>Date</Label>
                <Input type="date" value={form.date} onChange={(event) => updateDocumentDate(event.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Doc No</Label>
                <Input
                  value={projectInfo.documentNumber ?? ""}
                  onChange={(event) => updateProjectInfo("documentNumber", event.target.value)}
                  placeholder="REFO-260531-7DC9"
                />
              </div>
              <div className="space-y-2">
                <Label>Revision</Label>
                <Input
                  value={projectInfo.revision ?? ""}
                  onChange={(event) => updateProjectInfo("revision", event.target.value)}
                  placeholder="01"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Notes</Label>
              <Textarea value={form.notes} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} rows={3} />
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-xl border border-border/60 bg-secondary/10 p-4">
                <h3 className="text-sm font-medium">Company Information</h3>
                <p className="mt-1 text-xs text-muted-foreground">Prefilled from Settings. You can override it for this sheet.</p>
                <div className="mt-4 space-y-3">
                  <Input value={companyInfo.companyName ?? ""} onChange={(event) => updateCompanyInfo("companyName", event.target.value)} placeholder="Company name" />
                  <Input value={companyInfo.address ?? ""} onChange={(event) => updateCompanyInfo("address", event.target.value)} placeholder="Address" />
                  <div className="grid gap-3 md:grid-cols-2">
                    <Input value={companyInfo.phone ?? ""} onChange={(event) => updateCompanyInfo("phone", event.target.value)} placeholder="Phone" />
                    <Input value={companyInfo.email ?? ""} onChange={(event) => updateCompanyInfo("email", event.target.value)} placeholder="Email" />
                  </div>
                  <Input value={companyInfo.website ?? ""} onChange={(event) => updateCompanyInfo("website", event.target.value)} placeholder="Website" />
                </div>
              </div>

              <div className="rounded-xl border border-border/60 bg-secondary/10 p-4">
                <h3 className="text-sm font-medium">Client Information</h3>
                <p className="mt-1 text-xs text-muted-foreground">Prefilled from the selected client. You can override it for this sheet.</p>
                <div className="mt-4 space-y-3">
                  <Input value={clientInfo.companyName ?? ""} onChange={(event) => updateClientInfo("companyName", event.target.value)} placeholder="Client / company name" />
                  <Input value={clientInfo.address ?? ""} onChange={(event) => updateClientInfo("address", event.target.value)} placeholder="Address" />
                  <div className="grid gap-3 md:grid-cols-2">
                    <Input value={clientInfo.phone ?? ""} onChange={(event) => updateClientInfo("phone", event.target.value)} placeholder="Phone" />
                    <Input value={clientInfo.email ?? ""} onChange={(event) => updateClientInfo("email", event.target.value)} placeholder="Email" />
                  </div>
                  <Input value={clientInfo.website ?? ""} onChange={(event) => updateClientInfo("website", event.target.value)} placeholder="Website" />
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-border/60 bg-secondary/10 p-4">
              <h3 className="text-sm font-medium">Project Summary</h3>
              <p className="mt-1 text-xs text-muted-foreground">These fields mirror the reference progress billing format.</p>
              <div className="mt-4 grid gap-3 md:grid-cols-3">
                <div className="space-y-2 md:col-span-3">
                  <Label>Work Description</Label>
                  <Textarea
                    value={projectInfo.workDescription ?? ""}
                    onChange={(event) => updateProjectInfo("workDescription", event.target.value)}
                    placeholder="Describe the work covered by this quotation..."
                    rows={3}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Project Start Date</Label>
                  <Input type="date" value={projectInfo.projectStartDate ?? ""} onChange={(event) => updateProjectInfo("projectStartDate", event.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>Project Completion Date</Label>
                  <Input type="date" value={projectInfo.projectCompletionDate ?? ""} onChange={(event) => updateProjectInfo("projectCompletionDate", event.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>Previously Billed Amount</Label>
                  <Input type="number" value={projectInfo.previouslyBilledAmount ?? 0} onChange={(event) => updateProjectInfo("previouslyBilledAmount", event.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>Total Contract Value</Label>
                  <Input type="number" value={projectInfo.totalContractValue ?? 0} onChange={(event) => updateProjectInfo("totalContractValue", event.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>Retainage Held (%)</Label>
                  <Input type="number" value={projectInfo.retainagePercent ?? 0} onChange={(event) => updateProjectInfo("retainagePercent", event.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>Total Retainage Amount</Label>
                  <Input type="number" value={projectInfo.retainageAmount ?? 0} onChange={(event) => updateProjectInfo("retainageAmount", event.target.value)} />
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-border/60 bg-card/70 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-medium">Quotation Rows</h3>
                  <p className="text-xs text-muted-foreground">Use work rows for hours x rate, or expense rows for direct costs like tickets and vendor bills.</p>
                </div>
                <Button variant="outline" size="sm" onClick={() => setRows((current) => [...current, createRow()])}>
                  <Plus className="mr-2 h-4 w-4" />
                  Add Row
                </Button>
              </div>
              <div className="mt-4 space-y-3">
                {rows.map((row, index) => (
                  <div
                    key={row.id}
                    className="grid gap-3 rounded-lg border border-border/50 bg-background/70 p-3 md:grid-cols-[0.85fr_1.1fr_1.35fr_0.7fr_0.7fr_0.8fr]"
                  >
                    <select
                      value={row.lineType}
                      onChange={(event) => updateRow(index, "lineType", event.target.value === "expense" ? "expense" : "work")}
                      className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                    >
                      <option value="work">Work point</option>
                      <option value="expense">Expense point</option>
                    </select>
                    <Input value={row.taskName} onChange={(event) => updateRow(index, "taskName", event.target.value)} placeholder="Workflow / Discipline" />
                    <Input value={row.description} onChange={(event) => updateRow(index, "description", event.target.value)} placeholder="Task Description" />
                    {row.lineType === "expense" ? (
                      <>
                        <Input type="number" value={row.amount} onChange={(event) => updateRow(index, "amount", event.target.value)} placeholder="Amount" />
                        <div className="flex h-10 items-center rounded-md border border-dashed border-border/60 px-3 text-sm text-muted-foreground">Direct cost</div>
                      </>
                    ) : (
                      <>
                        <Input type="number" step="0.5" value={row.hours} onChange={(event) => updateRow(index, "hours", event.target.value)} placeholder="Hours" />
                        <Input type="number" value={row.rate} onChange={(event) => updateRow(index, "rate", event.target.value)} placeholder="Rate / Hr" />
                      </>
                    )}
                    <div className="flex items-center rounded-md border border-border/50 bg-secondary/10 px-3 text-sm font-medium tabular-nums">
                      {formatCurrency(amountFor(row))}
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-4 grid gap-3 border-t border-border/60 pt-4 md:grid-cols-2">
                <div className="rounded-lg border border-border/50 bg-secondary/10 p-4">
                  <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Total Hours</p>
                  <p className="mt-2 text-2xl font-semibold tabular-nums">{formTotals.hours.toFixed(1)}h</p>
                </div>
                <div className="rounded-lg border border-border/50 bg-secondary/10 p-4">
                  <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Final Quotation</p>
                  <p className="mt-2 text-2xl font-semibold tabular-nums">{formatCurrency(formTotals.amount)}</p>
                </div>
              </div>
            </div>

            <Button
              className="w-full"
              disabled={!form.title.trim() || !form.project.trim() || !form.clientId || saveMutation.isPending}
              onClick={() => saveMutation.mutate()}
            >
              {saveMutation.isPending ? "Saving..." : "Save Pre Approval"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={Boolean(preApprovalToDelete)} onOpenChange={(open) => !open && setPreApprovalToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete pre-approval?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the approval sheet for {preApprovalToDelete?.clientNameSnapshot}. Approved sheets cannot be deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                if (preApprovalToDelete) {
                  deleteMutation.mutate(preApprovalToDelete.id);
                }
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </DashboardLayout>
  );
}
