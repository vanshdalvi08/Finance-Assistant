import { useMemo, useState } from "react";
import { format } from "date-fns";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Download, MessageSquareText, ShieldCheck } from "lucide-react";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api, type PreApproval } from "@/lib/api";
import { exportPreApprovalPdf } from "@/lib/pre-approval-export";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

function formatCurrency(value: number) {
  return value.toLocaleString("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  });
}

function statusLabel(status: PreApproval["status"]) {
  return status === "changes_requested" ? "Changes Requested" : status.replace("_", " ");
}

function upsertPreApproval(current: PreApproval[] | undefined, next: PreApproval) {
  if (!current) {
    return [next];
  }

  return current.map((item) => (item.id === next.id ? next : item));
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

export default function ClientPreApprovalsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [changeNotes, setChangeNotes] = useState<Record<string, string>>({});
  const [commentDraft, setCommentDraft] = useState<Record<string, string>>({});

  const { data: preApprovals = [] } = useQuery({
    queryKey: ["preApprovals"],
    queryFn: api.getPreApprovals,
  });

  const totals = useMemo(() => {
    return preApprovals.reduce(
      (acc, item) => {
        acc.total += item.totalAmount;
        acc.hours += item.totalHours;
        acc.awaiting += item.status === "submitted" ? 1 : 0;
        acc.approved += item.status === "approved" ? 1 : 0;
        return acc;
      },
      { total: 0, hours: 0, awaiting: 0, approved: 0 },
    );
  }, [preApprovals]);

  const approveMutation = useMutation({
    mutationFn: api.approvePreApproval,
    onSuccess: (saved) => {
      queryClient.setQueryData<PreApproval[]>(["preApprovals"], (current) => upsertPreApproval(current, saved));
      toast({ title: "Pre-approval approved", description: "The admin can now move forward with this scope." });
    },
    onError: (error) => {
      toast({
        title: "Could not approve",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    },
  });

  const requestChangesMutation = useMutation({
    mutationFn: ({ id, message }: { id: string; message: string }) => api.requestPreApprovalChanges(id, message),
    onSuccess: (saved) => {
      queryClient.setQueryData<PreApproval[]>(["preApprovals"], (current) => upsertPreApproval(current, saved));
      setChangeNotes((current) => ({ ...current, [saved.id]: "" }));
      toast({ title: "Sent back to admin", description: "Your requested changes were added to the sheet." });
    },
    onError: (error) => {
      toast({
        title: "Could not request changes",
        description: error instanceof Error ? error.message : "Please add a clear comment and try again.",
        variant: "destructive",
      });
    },
  });

  const commentMutation = useMutation({
    mutationFn: ({ id, message }: { id: string; message: string }) => api.commentOnPreApproval(id, message),
    onSuccess: (saved) => {
      queryClient.setQueryData<PreApproval[]>(["preApprovals"], (current) => upsertPreApproval(current, saved));
      setCommentDraft((current) => ({ ...current, [saved.id]: "" }));
      toast({ title: "Comment sent", description: "Your note was added to the thread." });
    },
  });

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Pre Approvals</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Review proposed work rows, hours, and quotation before the admin proceeds.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          {[
            { label: "Total Quotation", value: formatCurrency(totals.total), icon: ShieldCheck },
            { label: "Total Hours", value: `${totals.hours.toFixed(1)}h`, icon: CheckCircle2 },
            { label: "Awaiting Review", value: String(totals.awaiting), icon: MessageSquareText },
          ].map((item) => (
            <Card key={item.label} className="border-border/60 bg-card/80">
              <CardContent className="flex items-center justify-between p-5">
                <div>
                  <p className="text-sm text-muted-foreground">{item.label}</p>
                  <p className="mt-2 text-2xl font-semibold">{item.value}</p>
                </div>
                <div className="rounded-xl bg-primary/10 p-3 text-primary">
                  <item.icon className="h-5 w-5" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="space-y-4">
          {preApprovals.length === 0 ? (
            <Card className="border-border/60">
              <CardContent className="py-12 text-center text-sm text-muted-foreground">
                No pre-approvals have been sent to you yet.
              </CardContent>
            </Card>
          ) : (
            preApprovals.map((item) => (
              <Card key={item.id} className="border-border/60">
                <CardHeader className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <CardTitle className="text-base">{item.title}</CardTitle>
                      <Badge variant="outline" className={cn("capitalize", statusBadgeClass(item.status))}>
                        {statusLabel(item.status)}
                      </Badge>
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {item.project} · {format(new Date(item.date), "dd MMM yyyy")}
                    </p>
                  </div>
                  <div className="text-left md:text-right">
                    <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Total Quotation</p>
                    <p className="mt-1 text-xl font-semibold">{formatCurrency(item.totalAmount)}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{item.totalHours.toFixed(1)} total hours</p>
                  </div>
                </CardHeader>
                <CardContent className="space-y-5">
                  {item.notes ? <p className="text-sm text-muted-foreground">{item.notes}</p> : null}

                  <div className="overflow-x-auto">
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
                            <TableCell className="font-medium">{task.taskName}</TableCell>
                            <TableCell className="text-muted-foreground">{task.description || "-"}</TableCell>
                            <TableCell className="text-right tabular-nums">{task.hours.toFixed(1)}</TableCell>
                            <TableCell className="text-right tabular-nums">{formatCurrency(task.rate)}</TableCell>
                            <TableCell className="text-right tabular-nums">{formatCurrency(task.amount)}</TableCell>
                          </TableRow>
                        ))}
                        <TableRow>
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

                  <div className="rounded-xl border border-border/60 bg-secondary/10 p-4">
                    <h3 className="text-sm font-medium">Conversation</h3>
                    {item.comments.length === 0 ? (
                      <p className="mt-2 text-sm text-muted-foreground">No comments yet.</p>
                    ) : (
                      <div className="mt-3 space-y-3">
                        {item.comments.map((comment) => (
                          <div key={comment.id} className="rounded-lg bg-background/70 p-3 text-sm">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-medium">{comment.authorName}</span>
                              <Badge variant="outline" className="capitalize">
                                {comment.authorRole}
                              </Badge>
                              <span className="text-xs text-muted-foreground">
                                {format(new Date(comment.createdAt), "dd MMM, HH:mm")}
                              </span>
                            </div>
                            <p className="mt-2 text-muted-foreground">{comment.message}</p>
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="mt-4 grid gap-3 md:grid-cols-[1fr_auto]">
                      <Input
                        value={commentDraft[item.id] ?? ""}
                        onChange={(event) => setCommentDraft((current) => ({ ...current, [item.id]: event.target.value }))}
                        placeholder="Ask a question or add a note..."
                      />
                      <Button
                        variant="outline"
                        disabled={!commentDraft[item.id]?.trim() || commentMutation.isPending}
                        onClick={() => commentMutation.mutate({ id: item.id, message: commentDraft[item.id] })}
                      >
                        Send Comment
                      </Button>
                    </div>
                  </div>

                  {item.status === "submitted" ? (
                    <div className="rounded-xl border border-border/60 bg-background/60 p-4">
                      <Textarea
                        value={changeNotes[item.id] ?? ""}
                        onChange={(event) => setChangeNotes((current) => ({ ...current, [item.id]: event.target.value }))}
                        placeholder="If something needs revision, explain which hours, rate, or scope should change..."
                        rows={3}
                      />
                      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:justify-end">
                        <Button
                          variant="outline"
                          disabled={!changeNotes[item.id]?.trim() || requestChangesMutation.isPending}
                          onClick={() => requestChangesMutation.mutate({ id: item.id, message: changeNotes[item.id] })}
                        >
                          Request Changes
                        </Button>
                        <Button
                          className="bg-emerald-600 text-white hover:bg-emerald-500"
                          disabled={approveMutation.isPending}
                          onClick={() => approveMutation.mutate(item.id)}
                        >
                          Approve Pre Approval
                        </Button>
                      </div>
                    </div>
                  ) : null}

                  <div className="flex justify-end">
                    <Button variant="outline" size="sm" onClick={() => exportPreApprovalPdf(item)}>
                      <Download className="mr-2 h-4 w-4" />
                      Export PDF
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}
