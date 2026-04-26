import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Link } from "wouter";
import { AlertTriangle, CheckCircle2, ExternalLink, LifeBuoy, RefreshCw, ShieldCheck } from "lucide-react";
import { PlatformShell } from "@/layouts/platform-shell";
import { PageHeader } from "@/components/app/page-header";
import { MetricCard } from "@/components/app/metric-card";
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
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { api, type CreatePlatformRecoveryDrillInput, type PlatformRecoveryDrill } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

function monthKey(value: string) {
  return value.slice(0, 7);
}

function monthLabel(value: string) {
  const [year, month] = value.split("-");
  if (!year || !month) {
    return value;
  }
  return format(new Date(Number(year), Number(month) - 1, 1), "MMMM yyyy");
}

function statusTone(status: PlatformRecoveryDrill["status"]) {
  if (status === "failed") {
    return "border-rose-400/20 bg-rose-500/10 text-rose-100";
  }
  if (status === "partial") {
    return "border-amber-400/20 bg-amber-500/10 text-amber-100";
  }
  return "border-emerald-400/20 bg-emerald-500/10 text-emerald-100";
}

function typeLabel(value: PlatformRecoveryDrill["type"]) {
  return value.replace("-", " ");
}

function scopeLabel(value: PlatformRecoveryDrill["scope"]) {
  return value;
}

function toDateTimeLocalValue(value: Date) {
  return format(value, "yyyy-MM-dd'T'HH:mm");
}

export default function PlatformRecoveryPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [tenantToRestore, setTenantToRestore] = useState<{
    id: string;
    name: string;
    slug: string;
    status: "active" | "inactive";
  } | null>(null);
  const [drillForm, setDrillForm] = useState<{
    type: PlatformRecoveryDrill["type"];
    scope: PlatformRecoveryDrill["scope"];
    status: PlatformRecoveryDrill["status"];
    summary: string;
    notes: string;
    durationMinutes: string;
    performedAt: string;
  }>({
    type: "tabletop",
    scope: "platform",
    status: "passed",
    summary: "",
    notes: "",
    durationMinutes: "",
    performedAt: toDateTimeLocalValue(new Date()),
  });

  const { data: tenantsData } = useQuery({
    queryKey: ["platform-tenants"],
    queryFn: api.getPlatformTenants,
  });

  const { data: overview } = useQuery({
    queryKey: ["platform-overview"],
    queryFn: api.getPlatformOverview,
  });

  const { data: monitoring } = useQuery({
    queryKey: ["platform-monitoring"],
    queryFn: () => api.getPlatformMonitoring(24),
  });
  const { data: settings } = useQuery({
    queryKey: ["platform-settings"],
    queryFn: api.getPlatformSettings,
  });
  const recoveryDrillsQuery = useQuery({
    queryKey: ["platform-recovery-drills"],
    queryFn: () => api.getPlatformRecoveryDrills(120),
    retry: false,
  });

  const restoreMutation = useMutation({
    mutationFn: (tenantId: string) => api.updatePlatformTenantStatus(tenantId, "active"),
    onSuccess: async () => {
      toast({ title: "Tenant restored", description: "The workspace is active again." });
      setTenantToRestore(null);
      await queryClient.invalidateQueries({ queryKey: ["platform-tenants"] });
      await queryClient.invalidateQueries({ queryKey: ["platform-overview"] });
    },
    onError: (error) => {
      toast({
        title: "Could not restore tenant",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    },
  });
  const createDrillMutation = useMutation({
    mutationFn: (input: CreatePlatformRecoveryDrillInput) => api.createPlatformRecoveryDrill(input),
    onSuccess: async () => {
      toast({ title: "Recovery drill recorded", description: "Drill evidence has been added to the platform log." });
      setDrillForm((current) => ({
        ...current,
        summary: "",
        notes: "",
        durationMinutes: "",
        performedAt: toDateTimeLocalValue(new Date()),
      }));
      await queryClient.invalidateQueries({ queryKey: ["platform-recovery-drills"] });
      await queryClient.invalidateQueries({ queryKey: ["platform-settings"] });
      await queryClient.invalidateQueries({ queryKey: ["platform-overview"] });
    },
    onError: (error) => {
      toast({
        title: "Could not record recovery drill",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    },
  });

  const tenants = tenantsData ?? [];
  const inactiveTenants = useMemo(() => tenants.filter((tenant) => tenant.status !== "active"), [tenants]);
  const incidents = monitoring?.events ?? [];
  const criticalCount = incidents.filter((event) => event.severity === "error").length;
  const drills = recoveryDrillsQuery.data ?? [];
  const latestDrill = drills[0] ?? null;
  const ninetyDayCutoff = Date.now() - 90 * 24 * 60 * 60 * 1000;
  const drillsLast90Days = drills.filter((drill) => new Date(drill.performedAt).getTime() >= ninetyDayCutoff).length;
  const currentMonth = format(new Date(), "yyyy-MM");
  const incidentsByMonth = useMemo(() => {
    const groups = new Map<string, typeof incidents>();
    for (const event of incidents) {
      const key = monthKey(event.createdAt);
      groups.set(key, [...(groups.get(key) ?? []), event]);
    }
    return [...groups.entries()]
      .sort((left, right) => right[0].localeCompare(left[0]))
      .map(([month, rows]) => ({
        month,
        rows: [...rows].sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()),
      }));
  }, [incidents]);
  const drillsByMonth = useMemo(() => {
    const groups = new Map<string, PlatformRecoveryDrill[]>();
    for (const drill of drills) {
      const key = monthKey(drill.performedAt);
      groups.set(key, [...(groups.get(key) ?? []), drill]);
    }
    return [...groups.entries()]
      .sort((left, right) => right[0].localeCompare(left[0]))
      .map(([month, rows]) => ({
        month,
        rows: [...rows].sort((left, right) => new Date(right.performedAt).getTime() - new Date(left.performedAt).getTime()),
      }));
  }, [drills]);

  const onRecordDrill = () => {
    if (!drillForm.summary.trim()) {
      toast({ title: "Drill summary is required", variant: "destructive" });
      return;
    }

    const durationValue = drillForm.durationMinutes.trim();
    const parsedDuration = durationValue ? Number(durationValue) : undefined;
    if (typeof parsedDuration === "number" && (!Number.isFinite(parsedDuration) || parsedDuration < 0)) {
      toast({ title: "Duration must be zero or greater", variant: "destructive" });
      return;
    }

    const payload: CreatePlatformRecoveryDrillInput = {
      type: drillForm.type,
      scope: drillForm.scope,
      status: drillForm.status,
      summary: drillForm.summary.trim(),
      notes: drillForm.notes.trim() || undefined,
      durationMinutes: typeof parsedDuration === "number" ? parsedDuration : undefined,
      performedAt: drillForm.performedAt ? new Date(drillForm.performedAt).toISOString() : undefined,
    };
    createDrillMutation.mutate(payload);
  };

  return (
    <PlatformShell>
      <div className="space-y-8">
        <PageHeader
          eyebrow="Recovery"
          title="Support desk"
          description="Restore tenants, inspect recent incidents, and keep operator recovery actions quiet and well-organized."
        />

        <div className="grid gap-4 xl:grid-cols-5">
          <MetricCard label="Inactive tenants" value={`${inactiveTenants.length}`} icon={<AlertTriangle className="h-5 w-5" />} />
          <MetricCard label="Active tenants" value={`${overview?.activeTenants ?? 0}`} icon={<CheckCircle2 className="h-5 w-5" />} />
          <MetricCard label="Critical incidents" value={`${criticalCount}`} icon={<ShieldCheck className="h-5 w-5" />} />
          <MetricCard label="Drills (90d)" value={`${drillsLast90Days}`} icon={<LifeBuoy className="h-5 w-5" />} />
          <MetricCard label="Recovery state" value={restoreMutation.isPending || createDrillMutation.isPending ? "Working..." : "Ready"} icon={<RefreshCw className="h-5 w-5" />} />
        </div>

        <div className="grid gap-6 xl:grid-cols-[1.35fr_0.95fr]">
          <Card className="border-border/50 bg-card">
            <CardHeader className="space-y-3">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <CardTitle className="text-2xl font-semibold tracking-tight">Inactive tenants</CardTitle>
                  <p className="mt-1 text-sm text-muted-foreground">Restore paused workspaces from here without entering any tenant dashboard.</p>
                </div>
                <Badge variant="outline" className="border-border/50 bg-muted/20 text-muted-foreground">
                  {inactiveTenants.length} recoverable
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow className="border-border/50">
                    <TableHead>Tenant</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Users</TableHead>
                    <TableHead className="text-right">Last activity</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {inactiveTenants.map((tenant) => (
                    <TableRow key={tenant.id} className="border-border/50">
                      <TableCell>
                        <div className="space-y-1">
                          <p className="font-medium text-foreground">{tenant.name}</p>
                          <p className="text-xs text-muted-foreground">{tenant.slug}</p>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="border-border/50 bg-muted/20 text-muted-foreground">
                          {tenant.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground">{tenant.userCount}</TableCell>
                      <TableCell className="text-right text-muted-foreground">
                        {tenant.lastActivityAt ? format(new Date(tenant.lastActivityAt), "dd MMM, HH:mm") : "No activity"}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          variant="outline"
                          className="border-border/50 bg-card"
                          onClick={() =>
                            setTenantToRestore({
                              id: tenant.id,
                              name: tenant.name,
                              slug: tenant.slug,
                              status: tenant.status,
                            })
                          }
                          disabled={restoreMutation.isPending}
                        >
                          Restore
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {!inactiveTenants.length ? (
                <p className="px-6 py-6 text-sm text-muted-foreground">No inactive tenants to recover right now.</p>
              ) : null}
            </CardContent>
          </Card>

          <div className="space-y-6">
            <Card className="border-border/50 bg-card">
              <CardHeader>
                <CardTitle className="text-2xl font-semibold tracking-tight">Recovery posture</CardTitle>
                <p className="text-sm text-muted-foreground">A quiet snapshot of current platform conditions and support readiness.</p>
              </CardHeader>
              <CardContent className="grid gap-3">
                <RecoveryLine label="Tenant health" value={`${overview?.activeTenants ?? 0} active / ${overview?.inactiveTenants ?? 0} inactive`} />
                <RecoveryLine label="Recent incidents" value={`${incidents.length} events in the latest telemetry window`} />
                <RecoveryLine label="Critical issues" value={`${criticalCount} errors need attention`} />
                <RecoveryLine label="Recorded drills" value={`${drills.length} total drills (${drillsLast90Days} in last 90 days)`} />
                <RecoveryLine
                  label="Backup retention"
                  value={`${settings?.operationalDefaults.backupRecovery.retentionDays ?? 30} days (${settings?.operationalDefaults.backupRecovery.frequency ?? "daily + wal/pitr"})`}
                />
                <RecoveryLine label="Support state" value={restoreMutation.isPending ? "Restoration in progress" : "Ready for action"} />
                <RecoveryLine
                  label="Last recovery drill"
                  value={latestDrill ? format(new Date(latestDrill.performedAt), "dd MMM yyyy, HH:mm") : settings?.operationalDefaults.backupRecovery.lastRecoveryDrillDate ?? "Not recorded"}
                />
              </CardContent>
            </Card>

            <Card className="border-border/50 bg-card">
              <CardHeader className="space-y-2">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <CardTitle className="text-2xl font-semibold tracking-tight">Recovery drills</CardTitle>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Keep restore simulations and tabletop runs documented in one place with timeline evidence.
                    </p>
                  </div>
                  <Badge variant="outline" className="border-border/50 bg-muted/20 text-muted-foreground">
                    {drills.length} recorded
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="rounded-2xl border border-border/50 bg-muted/20 p-4">
                  <p className="text-[11px] uppercase tracking-[0.22em] text-muted-foreground">Record a new drill</p>
                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    <div className="space-y-2">
                      <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Type</p>
                      <Select
                        value={drillForm.type}
                        onValueChange={(value: PlatformRecoveryDrill["type"]) => setDrillForm((current) => ({ ...current, type: value }))}
                      >
                        <SelectTrigger className="border-border/50 bg-background/60">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="tabletop">Tabletop</SelectItem>
                          <SelectItem value="restore">Restore</SelectItem>
                          <SelectItem value="failover">Failover</SelectItem>
                          <SelectItem value="backup-validation">Backup validation</SelectItem>
                          <SelectItem value="other">Other</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Scope</p>
                      <Select
                        value={drillForm.scope}
                        onValueChange={(value: PlatformRecoveryDrill["scope"]) => setDrillForm((current) => ({ ...current, scope: value }))}
                      >
                        <SelectTrigger className="border-border/50 bg-background/60">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="platform">Platform</SelectItem>
                          <SelectItem value="tenant">Tenant</SelectItem>
                          <SelectItem value="database">Database</SelectItem>
                          <SelectItem value="storage">Storage</SelectItem>
                          <SelectItem value="service">Service</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Result</p>
                      <Select
                        value={drillForm.status}
                        onValueChange={(value: PlatformRecoveryDrill["status"]) => setDrillForm((current) => ({ ...current, status: value }))}
                      >
                        <SelectTrigger className="border-border/50 bg-background/60">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="passed">Passed</SelectItem>
                          <SelectItem value="partial">Partial</SelectItem>
                          <SelectItem value="failed">Failed</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Performed at</p>
                      <Input
                        type="datetime-local"
                        value={drillForm.performedAt}
                        onChange={(event) => setDrillForm((current) => ({ ...current, performedAt: event.target.value }))}
                        className="border-border/50 bg-background/60"
                      />
                    </div>
                  </div>

                  <div className="mt-3 grid gap-3 md:grid-cols-[1fr_220px]">
                    <Input
                      value={drillForm.summary}
                      onChange={(event) => setDrillForm((current) => ({ ...current, summary: event.target.value }))}
                      placeholder="Summary: PITR restore validated in staging in 38 minutes"
                      className="border-border/50 bg-background/60"
                    />
                    <Input
                      type="number"
                      min={0}
                      value={drillForm.durationMinutes}
                      onChange={(event) => setDrillForm((current) => ({ ...current, durationMinutes: event.target.value }))}
                      placeholder="Duration (min)"
                      className="border-border/50 bg-background/60"
                    />
                  </div>

                  <Textarea
                    value={drillForm.notes}
                    onChange={(event) => setDrillForm((current) => ({ ...current, notes: event.target.value }))}
                    rows={3}
                    placeholder="Notes: blockers, rollback points, and follow-up tasks"
                    className="mt-3 border-border/50 bg-background/60"
                  />

                  <div className="mt-3 flex justify-end">
                    <Button onClick={onRecordDrill} disabled={createDrillMutation.isPending}>
                      {createDrillMutation.isPending ? "Recording..." : "Record drill"}
                    </Button>
                  </div>
                </div>

                {recoveryDrillsQuery.isLoading ? (
                  <p className="rounded-2xl border border-border/50 bg-muted/20 px-4 py-6 text-sm text-muted-foreground">Loading recovery drills...</p>
                ) : recoveryDrillsQuery.isError ? (
                  <p className="rounded-2xl border border-amber-400/15 bg-amber-500/10 px-4 py-6 text-sm text-amber-100">
                    Recovery drill API is not available yet in this environment. The recording form is ready and will start working once backend routes are enabled.
                  </p>
                ) : drillsByMonth.length ? (
                  <div className="space-y-3">
                    {drillsByMonth.map((monthGroup) => (
                      <Collapsible key={`drills-${monthGroup.month}`} defaultOpen={monthGroup.month === currentMonth}>
                        <div className="overflow-hidden rounded-2xl border border-border/50 bg-muted/20">
                          <CollapsibleTrigger asChild>
                            <button type="button" className="flex w-full items-center justify-between gap-3 border-b border-border/50 px-4 py-3 text-left">
                              <div>
                                <p className="text-sm font-medium text-foreground">{monthLabel(monthGroup.month)}</p>
                                <p className="text-xs text-muted-foreground">{monthGroup.rows.length} drills</p>
                              </div>
                              <LifeBuoy className="h-4 w-4 text-muted-foreground" />
                            </button>
                          </CollapsibleTrigger>
                          <CollapsibleContent>
                            <div className="space-y-2 p-3">
                              {monthGroup.rows.map((drill) => (
                                <div key={drill.id} className="rounded-2xl border border-border/50 bg-background/60 p-3">
                                  <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
                                    <div className="min-w-0 space-y-1">
                                      <div className="flex flex-wrap items-center gap-2">
                                        <Badge variant="outline" className={statusTone(drill.status)}>{drill.status}</Badge>
                                        <span className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{typeLabel(drill.type)}</span>
                                        <span className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{scopeLabel(drill.scope)}</span>
                                      </div>
                                      <p className="font-medium text-foreground">{drill.summary}</p>
                                      {drill.notes ? <p className="line-clamp-2 text-xs text-muted-foreground">{drill.notes}</p> : null}
                                    </div>
                                    <div className="rounded-xl border border-border/50 bg-background/60 px-3 py-2 text-right">
                                      <p className="text-xs text-muted-foreground">{format(new Date(drill.performedAt), "dd MMM yyyy, HH:mm")}</p>
                                      <p className="mt-1 text-xs text-muted-foreground">
                                        {typeof drill.durationMinutes === "number" ? `${drill.durationMinutes} min` : "Duration n/a"}
                                      </p>
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </CollapsibleContent>
                        </div>
                      </Collapsible>
                    ))}
                  </div>
                ) : (
                  <p className="rounded-2xl border border-border/50 bg-muted/20 px-4 py-6 text-sm text-muted-foreground">
                    No recovery drills recorded yet.
                  </p>
                )}
              </CardContent>
            </Card>

            <Card className="border-border/50 bg-card">
              <CardHeader className="flex flex-row items-center justify-between space-y-0">
                <div>
                  <CardTitle className="text-2xl font-semibold tracking-tight">Incident feed</CardTitle>
                  <p className="mt-1 text-sm text-muted-foreground">The latest runtime events that matter for support and recovery.</p>
                </div>
                <LifeBuoy className="h-5 w-5 text-muted-foreground" />
              </CardHeader>
              <CardContent className="space-y-3">
                {incidentsByMonth.map((monthGroup) => (
                  <Collapsible key={`recovery-${monthGroup.month}`} defaultOpen={monthGroup.month === currentMonth}>
                    <div className="overflow-hidden rounded-2xl border border-border/50 bg-muted/20">
                      <CollapsibleTrigger asChild>
                        <button type="button" className="flex w-full items-center justify-between gap-3 border-b border-border/50 px-4 py-3 text-left">
                          <div>
                            <p className="text-sm font-medium text-foreground">{monthLabel(monthGroup.month)}</p>
                            <p className="text-xs text-muted-foreground">{monthGroup.rows.length} incidents</p>
                          </div>
                          <LifeBuoy className="h-4 w-4 text-muted-foreground" />
                        </button>
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        <div className="space-y-3 p-3">
                          {monthGroup.rows.slice(0, 10).map((event) => (
                            <div
                              key={event.id}
                              className={cn(
                                "rounded-3xl border p-4",
                                event.severity === "error"
                                  ? "border-rose-400/15 bg-rose-400/5"
                                  : event.severity === "warning"
                                    ? "border-amber-400/15 bg-amber-400/5"
                                    : "border-border/50 bg-muted/20",
                              )}
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0 space-y-1">
                                  <div className="flex items-center gap-2">
                                    <Badge
                                      variant="outline"
                                      className={
                                        event.severity === "error"
                                          ? "border-rose-400/20 bg-rose-400/10 text-rose-200"
                                          : event.severity === "warning"
                                            ? "border-amber-400/20 bg-amber-400/10 text-amber-200"
                                            : "border-border/50 bg-muted/20 text-foreground"
                                      }
                                    >
                                      {event.severity}
                                    </Badge>
                                    <span className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{event.category}</span>
                                  </div>
                                  <p className="font-medium text-foreground">{event.title}</p>
                                  <p className="line-clamp-2 text-sm text-muted-foreground">{event.message}</p>
                                </div>
                                <div className="text-right text-xs text-muted-foreground">
                                  <p>{format(new Date(event.createdAt), "dd MMM")}</p>
                                  <p className="mt-1">{format(new Date(event.createdAt), "HH:mm")}</p>
                                </div>
                              </div>
                              {event.path ? (
                                <p className="mt-3 text-xs text-muted-foreground">
                                  {event.method ?? "GET"} {event.path}
                                </p>
                              ) : null}
                            </div>
                          ))}
                        </div>
                      </CollapsibleContent>
                    </div>
                  </Collapsible>
                ))}
                {!incidents.length ? <p className="py-4 text-sm text-muted-foreground">No incidents recorded yet.</p> : null}
              </CardContent>
            </Card>

            <Card className="border-border/50 bg-card">
              <CardHeader>
                <CardTitle className="text-2xl font-semibold tracking-tight">Quick support actions</CardTitle>
                <p className="text-sm text-muted-foreground">Use these when you need to jump between recovery, monitoring, and tenant controls.</p>
              </CardHeader>
              <CardContent className="grid gap-3 sm:grid-cols-2">
                <Link href="/platform/monitoring">
                  <span className="rounded-2xl border border-border/50 bg-muted/20 px-4 py-3 text-sm text-muted-foreground transition hover:text-foreground">
                    Open Monitoring
                  </span>
                </Link>
                <Link href="/platform/tenants">
                  <span className="rounded-2xl border border-border/50 bg-muted/20 px-4 py-3 text-sm text-muted-foreground transition hover:text-foreground">
                    Review Tenants
                  </span>
                </Link>
                <Link href="/platform/settings">
                  <span className="rounded-2xl border border-border/50 bg-muted/20 px-4 py-3 text-sm text-muted-foreground transition hover:text-foreground">
                    Inspect Platform Settings
                  </span>
                </Link>
                <a
                  href={settings?.operationalDefaults.backupRecovery.runbookUrl ?? "/platform/recovery"}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center justify-between rounded-2xl border border-border/50 bg-muted/20 px-4 py-3 text-left text-sm text-muted-foreground transition hover:text-foreground"
                >
                  Open Recovery Runbook
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
                <button
                  type="button"
                  onClick={async () => {
                    await queryClient.invalidateQueries({ queryKey: ["platform-tenants"] });
                    await queryClient.invalidateQueries({ queryKey: ["platform-overview"] });
                    await queryClient.invalidateQueries({ queryKey: ["platform-monitoring"] });
                    await queryClient.invalidateQueries({ queryKey: ["platform-recovery-drills"] });
                    toast({ title: "Recovery state refreshed" });
                  }}
                  className="rounded-2xl border border-border/50 bg-muted/20 px-4 py-3 text-left text-sm text-muted-foreground transition hover:text-foreground"
                >
                  Refresh Recovery State
                </button>
              </CardContent>
            </Card>
          </div>
        </div>

        <AlertDialog open={Boolean(tenantToRestore)} onOpenChange={(open) => !open && setTenantToRestore(null)}>
          <AlertDialogContent className="border-border/50 bg-card text-foreground">
            <AlertDialogHeader>
              <AlertDialogTitle>Restore tenant workspace?</AlertDialogTitle>
              <AlertDialogDescription className="text-muted-foreground">
                This will re-enable the tenant from the platform console without changing any tenant data.
              </AlertDialogDescription>
            </AlertDialogHeader>
            {tenantToRestore ? (
              <div className="grid gap-3">
                <RecoveryLine label="Tenant" value={tenantToRestore.name} />
                <RecoveryLine label="Slug" value={tenantToRestore.slug} />
                <RecoveryLine label="Current status" value={tenantToRestore.status} />
              </div>
            ) : null}
            <AlertDialogFooter>
              <AlertDialogCancel className="border-border/50 bg-card text-foreground">Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => tenantToRestore && restoreMutation.mutate(tenantToRestore.id)}
                className="bg-foreground text-background hover:bg-foreground/90"
              >
                {restoreMutation.isPending ? "Restoring..." : "Restore tenant"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </PlatformShell>
  );
}

function RecoveryLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-border/50 bg-muted/20 px-4 py-3">
      <p className="text-[11px] uppercase tracking-[0.22em] text-muted-foreground">{label}</p>
      <p className="mt-1 text-sm text-foreground">{value}</p>
    </div>
  );
}
