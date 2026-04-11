import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Link } from "wouter";
import { AlertTriangle, CheckCircle2, ExternalLink, LifeBuoy, RefreshCw, ShieldCheck, Sparkles } from "lucide-react";
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

export default function PlatformRecoveryPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [tenantToRestore, setTenantToRestore] = useState<{
    id: string;
    name: string;
    slug: string;
    status: "active" | "inactive";
  } | null>(null);

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

  const tenants = tenantsData ?? [];
  const inactiveTenants = useMemo(() => tenants.filter((tenant) => tenant.status !== "active"), [tenants]);
  const incidents = monitoring?.events ?? [];
  const criticalCount = incidents.filter((event) => event.severity === "error").length;

  return (
    <PlatformShell>
      <div className="space-y-8">
        <PageHeader
          eyebrow="Recovery"
          title="Support desk"
          description="Restore tenants, inspect recent incidents, and keep operator recovery actions quiet and well-organized."
        />

        <div className="grid gap-4 xl:grid-cols-4">
          <MetricCard label="Inactive tenants" value={`${inactiveTenants.length}`} icon={<AlertTriangle className="h-5 w-5" />} />
          <MetricCard label="Active tenants" value={`${overview?.activeTenants ?? 0}`} icon={<CheckCircle2 className="h-5 w-5" />} />
          <MetricCard label="Critical incidents" value={`${criticalCount}`} icon={<ShieldCheck className="h-5 w-5" />} />
          <MetricCard label="Recovery state" value={restoreMutation.isPending ? "Working..." : "Ready"} icon={<RefreshCw className="h-5 w-5" />} />
        </div>

        <div className="grid gap-6 xl:grid-cols-[1.35fr_0.95fr]">
          <Card className="border-white/8 bg-white/[0.03]">
            <CardHeader className="space-y-3">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <CardTitle className="font-serif text-2xl">Inactive tenants</CardTitle>
                  <p className="mt-1 text-sm text-muted-foreground">Restore paused workspaces from here without entering any tenant dashboard.</p>
                </div>
                <Badge variant="outline" className="border-white/10 bg-black/15 text-muted-foreground">
                  {inactiveTenants.length} recoverable
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow className="border-white/5">
                    <TableHead>Tenant</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Users</TableHead>
                    <TableHead className="text-right">Last activity</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {inactiveTenants.map((tenant) => (
                    <TableRow key={tenant.id} className="border-white/5">
                      <TableCell>
                        <div className="space-y-1">
                          <p className="font-medium text-foreground">{tenant.name}</p>
                          <p className="text-xs text-muted-foreground">{tenant.slug}</p>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="border-white/10 bg-white/5 text-muted-foreground">
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
                          className="border-white/10 bg-white/[0.03]"
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
            <Card className="border-white/8 bg-white/[0.03]">
              <CardHeader>
                <CardTitle className="font-serif text-2xl">Recovery posture</CardTitle>
                <p className="text-sm text-muted-foreground">A quiet snapshot of current platform conditions and support readiness.</p>
              </CardHeader>
              <CardContent className="grid gap-3">
                <RecoveryLine label="Tenant health" value={`${overview?.activeTenants ?? 0} active / ${overview?.inactiveTenants ?? 0} inactive`} />
                <RecoveryLine label="Recent incidents" value={`${incidents.length} events in the latest telemetry window`} />
                <RecoveryLine label="Critical issues" value={`${criticalCount} errors need attention`} />
                <RecoveryLine
                  label="Backup retention"
                  value={`${settings?.operationalDefaults.backupRecovery.retentionDays ?? 30} days (${settings?.operationalDefaults.backupRecovery.frequency ?? "daily + wal/pitr"})`}
                />
                <RecoveryLine label="Support state" value={restoreMutation.isPending ? "Restoration in progress" : "Ready for action"} />
                <RecoveryLine
                  label="Last recovery drill"
                  value={settings?.operationalDefaults.backupRecovery.lastRecoveryDrillDate ?? "Not recorded"}
                />
              </CardContent>
            </Card>

            <Card className="border-white/8 bg-white/[0.03]">
              <CardHeader className="flex flex-row items-center justify-between space-y-0">
                <div>
                  <CardTitle className="font-serif text-2xl">Incident feed</CardTitle>
                  <p className="mt-1 text-sm text-muted-foreground">The latest runtime events that matter for support and recovery.</p>
                </div>
                <LifeBuoy className="h-5 w-5 text-cyan-300" />
              </CardHeader>
              <CardContent className="space-y-3">
                {incidents.slice(0, 5).map((event) => (
                  <div
                    key={event.id}
                    className={cn(
                      "rounded-3xl border p-4",
                      event.severity === "error"
                        ? "border-rose-400/15 bg-rose-400/5"
                        : event.severity === "warning"
                          ? "border-amber-400/15 bg-amber-400/5"
                          : "border-cyan-400/15 bg-cyan-400/5",
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
                                  : "border-cyan-400/20 bg-cyan-400/10 text-cyan-200"
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
                {!incidents.length ? <p className="py-4 text-sm text-muted-foreground">No incidents recorded yet.</p> : null}
              </CardContent>
            </Card>

            <Card className="border-white/8 bg-white/[0.03]">
              <CardHeader>
                <CardTitle className="font-serif text-2xl">Quick support actions</CardTitle>
                <p className="text-sm text-muted-foreground">Use these when you need to jump between recovery, monitoring, and tenant controls.</p>
              </CardHeader>
              <CardContent className="grid gap-3 sm:grid-cols-2">
                <Link href="/platform/monitoring">
                  <span className="rounded-2xl border border-white/8 bg-black/15 px-4 py-3 text-sm text-muted-foreground transition hover:border-cyan-400/20 hover:text-foreground">
                    Open Monitoring
                  </span>
                </Link>
                <Link href="/platform/tenants">
                  <span className="rounded-2xl border border-white/8 bg-black/15 px-4 py-3 text-sm text-muted-foreground transition hover:border-cyan-400/20 hover:text-foreground">
                    Review Tenants
                  </span>
                </Link>
                <Link href="/platform/settings">
                  <span className="rounded-2xl border border-white/8 bg-black/15 px-4 py-3 text-sm text-muted-foreground transition hover:border-cyan-400/20 hover:text-foreground">
                    Inspect Platform Settings
                  </span>
                </Link>
                <a
                  href={settings?.operationalDefaults.backupRecovery.runbookUrl ?? "/platform/recovery"}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center justify-between rounded-2xl border border-white/8 bg-black/15 px-4 py-3 text-left text-sm text-muted-foreground transition hover:border-cyan-400/20 hover:text-foreground"
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
                    toast({ title: "Recovery state refreshed" });
                  }}
                  className="rounded-2xl border border-white/8 bg-black/15 px-4 py-3 text-left text-sm text-muted-foreground transition hover:border-cyan-400/20 hover:text-foreground"
                >
                  Refresh Recovery State
                </button>
              </CardContent>
            </Card>
          </div>
        </div>

        <AlertDialog open={Boolean(tenantToRestore)} onOpenChange={(open) => !open && setTenantToRestore(null)}>
          <AlertDialogContent className="border-white/10 bg-[#111111] text-white">
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
              <AlertDialogCancel className="border-white/10 bg-white/[0.03] text-foreground">Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => tenantToRestore && restoreMutation.mutate(tenantToRestore.id)}
                className="bg-emerald-600 text-white hover:bg-emerald-500"
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
    <div className="rounded-2xl border border-white/8 bg-black/15 px-4 py-3">
      <p className="text-[11px] uppercase tracking-[0.22em] text-muted-foreground">{label}</p>
      <p className="mt-1 text-sm text-foreground">{value}</p>
    </div>
  );
}
