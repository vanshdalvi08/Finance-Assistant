import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, Clock3, Copy, ExternalLink, RefreshCcw, Shield, Sparkles, Trash2 } from "lucide-react";
import { PlatformShell } from "@/layouts/platform-shell";
import { PageHeader } from "@/components/app/page-header";
import { MetricCard } from "@/components/app/metric-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { useAuthStore } from "@/store/auth";
import { api } from "@/lib/api";

export default function PlatformSettingsPage() {
  const { toast } = useToast();
  const { user, userEmail } = useAuthStore();
  const queryClient = useQueryClient();

  const { data: settings } = useQuery({
    queryKey: ["platform-settings"],
    queryFn: api.getPlatformSettings,
  });

  const { data: overview } = useQuery({
    queryKey: ["platform-overview"],
    queryFn: api.getPlatformOverview,
  });

  const platformTenant = settings?.platformTenant;
  const admins = settings?.platformAdmins ?? [];
  const externalMonitoring = settings?.operationalDefaults.externalMonitoring;
  const backupRecovery = settings?.operationalDefaults.backupRecovery;
  const retention = settings?.operationalDefaults.retention;

  const healthHighlights = useMemo(
    () => [
      { label: "Tenants", value: `${overview?.totalTenants ?? 0}` },
      { label: "Admins", value: `${overview?.platformAdmins ?? 0}` },
      { label: "Errors", value: `${overview?.errorCount ?? 0}` },
      { label: "Slow Requests", value: `${overview?.slowRequestCount ?? 0}` },
    ],
    [overview],
  );

  async function copy(value: string, label: string) {
    await navigator.clipboard.writeText(value);
    toast({ title: `${label} copied` });
  }

  const retentionMutation = useMutation({
    mutationFn: (input: { dryRun?: boolean; limit?: number }) => api.runPlatformRetentionPrune(input),
    onSuccess: (result) => {
      toast({
        title: result.dryRun ? "Retention preview refreshed" : "Platform event prune completed",
        description: result.dryRun
          ? `${result.eligibleCount} resolved events are currently eligible for cleanup.`
          : `${result.deletedCount} resolved platform events were pruned. Audit history was left untouched.`,
      });
      void queryClient.invalidateQueries({ queryKey: ["platform-settings"] });
    },
    onError: () => {
      toast({
        title: "Retention action failed",
        description: "The platform console could not complete that retention action.",
        variant: "destructive",
      });
    },
  });

  return (
    <PlatformShell>
      <div className="space-y-8">
        <PageHeader
          eyebrow="Platform settings"
          title="Console identity"
          description="Quiet operator defaults, bootstrap identity, and access boundaries for the platform workspace."
        />

        <div className="grid gap-4 xl:grid-cols-4">
          {healthHighlights.map((item) => (
            <MetricCard key={item.label} label={item.label} value={item.value} icon={<Sparkles className="h-5 w-5" />} />
          ))}
        </div>

        <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
          <Card className="border-border/50 bg-card">
            <CardHeader className="space-y-3">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <CardTitle className="font-serif text-2xl">Bootstrap identity</CardTitle>
                  <p className="mt-1 text-sm text-muted-foreground">This console lives in its own platform tenant and is separated from client workspaces.</p>
                </div>
                <Badge variant="outline" className="border-border/50 bg-muted/30 text-muted-foreground">
                  protected
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 md:grid-cols-2">
                <SettingTile
                  label="Current user"
                  value={user?.name ?? "Platform Super Admin"}
                  detail={userEmail ?? "No email"}
                />
                <SettingTile
                  label="Current role"
                  value={user?.role ?? "platform_super_admin"}
                  detail="Separate from tenant admin roles."
                />
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <SettingTile
                  label="Platform tenant ID"
                  value={platformTenant?.id ?? "Loading..."}
                  detail="Primary ownership boundary for the platform console."
                  onCopy={platformTenant ? () => void copy(platformTenant.id, "Platform tenant ID") : undefined}
                />
                <SettingTile
                  label="Platform slug"
                  value={platformTenant?.slug ?? "platform"}
                  detail="Reserved slug for the console workspace."
                  onCopy={platformTenant ? () => void copy(platformTenant.slug, "Platform slug") : undefined}
                />
              </div>

              <div className="rounded-3xl border border-border/50 bg-card p-4">
                <div className="flex items-start gap-3">
                  <div className="rounded-2xl border border-border/50 bg-muted/30 p-2 text-[#d8b26a]">
                    <Shield className="h-4 w-4" />
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-foreground">Access boundaries</p>
                    <p className="text-sm text-muted-foreground">
                      Platform access is role-guarded. Tenant owners can only manage their own workspace; platform actions stay inside this console.
                    </p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="space-y-6">
            <Card className="border-border/50 bg-card">
              <CardHeader>
                <CardTitle className="font-serif text-2xl">Operational defaults</CardTitle>
                <p className="text-sm text-muted-foreground">Read-only platform defaults that shape monitoring and operator response expectations.</p>
              </CardHeader>
              <CardContent className="grid gap-3">
                <SettingTile
                  label="Support contact"
                  value={settings?.operationalDefaults.supportEmail ?? "platform@yojak.in"}
                  detail="Primary support identity used for platform operations."
                />
                <SettingTile
                  label="Slow request threshold"
                  value={`${settings?.operationalDefaults.incidentLatencyThresholdMs ?? 1500} ms`}
                  detail="Requests slower than this are recorded as warnings in the telemetry feed."
                />
                <SettingTile
                  label="Monitoring window"
                  value={`${settings?.operationalDefaults.monitoringWindowSize ?? 80} events`}
                  detail="Default operator view returned from the platform monitoring endpoint."
                />
                <SettingTile
                  label="Hardening tier"
                  value={settings?.operationalDefaults.hardeningTier ?? "baseline"}
                  detail={settings?.operationalDefaults.auditRetention ?? "Database-backed platform event history"}
                />
                <SettingTile
                  label="External monitoring"
                  value={externalMonitoring?.enabled ? "Enabled" : "Disabled"}
                  detail={
                    externalMonitoring?.enabled
                      ? `${externalMonitoring.provider} • min ${externalMonitoring.minSeverity} • cooldown ${externalMonitoring.cooldownMs}ms`
                      : "Configure webhook env variables to enable external alert dispatch."
                  }
                />
                <SettingTile
                  label="Monitoring destination"
                  value={externalMonitoring?.endpoint ?? "Not configured"}
                  detail="Masked endpoint shown for security."
                />
              </CardContent>
            </Card>

            <Card className="border-border/50 bg-card">
              <CardHeader>
                <CardTitle className="font-serif text-2xl">Backup & recovery</CardTitle>
                <p className="text-sm text-muted-foreground">Runbook-facing settings for restore readiness and operational recovery drills.</p>
              </CardHeader>
              <CardContent className="grid gap-3">
                <SettingTile
                  label="Strategy"
                  value={backupRecovery?.strategy ?? "managed-postgres-pitr"}
                  detail={`Frequency: ${backupRecovery?.frequency ?? "daily + wal/pitr"}`}
                />
                <SettingTile
                  label="Retention"
                  value={`${backupRecovery?.retentionDays ?? 30} days`}
                  detail={`Storage: ${backupRecovery?.storage ?? "managed-provider"}`}
                />
                <SettingTile
                  label="Last recovery drill"
                  value={backupRecovery?.lastRecoveryDrillDate ?? "Not recorded"}
                  detail="Track this after each restore rehearsal."
                />
                <a
                  href={backupRecovery?.runbookUrl ?? "/docs/operations/backup-recovery-runbook.md"}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center justify-between rounded-2xl border border-border/50 bg-card px-4 py-3 text-sm text-muted-foreground transition hover:border-[#d8b26a]/25 hover:text-foreground"
                >
                  Open backup runbook
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </CardContent>
            </Card>

            <Card className="border-border/50 bg-card">
              <CardHeader className="space-y-3">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <CardTitle className="font-serif text-2xl">Retention & pruning</CardTitle>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Runtime telemetry can be pruned conservatively. Audit and finance history stay protected by default.
                    </p>
                  </div>
                  <Badge variant="outline" className="border-border/50 bg-muted/30 text-muted-foreground">
                    manual only
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-4">
                  <div className="rounded-3xl border border-border/50 bg-card p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2 text-foreground">
                          <Archive className="h-4 w-4 text-[#d8b26a]" />
                          <p className="text-sm font-medium">Platform telemetry</p>
                        </div>
                        <p className="text-sm text-muted-foreground">
                          Only resolved platform events are eligible. Open incidents and recovery drill records stay preserved.
                        </p>
                      </div>
                      <Badge
                        variant="outline"
                        className={
                          retention?.platformEvents.supported
                            ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-200"
                            : "border-border/50 bg-muted/30 text-muted-foreground"
                        }
                      >
                        {retention?.platformEvents.supported ? "ready" : "legacy mode"}
                      </Badge>
                    </div>

                    <div className="mt-4 grid gap-3 md:grid-cols-2">
                      <RetentionMetric
                        label="Eligible now"
                        value={`${retention?.platformEvents.stats.pruneEligibleTotal ?? 0}`}
                        detail="Resolved events past retention windows."
                      />
                      <RetentionMetric
                        label="Last prune run"
                        value={
                          retention?.platformEvents.latestPruneRun?.at
                            ? new Date(retention.platformEvents.latestPruneRun.at).toLocaleString()
                            : "Not yet run"
                        }
                        detail={
                          retention?.platformEvents.latestPruneRun
                            ? `${retention.platformEvents.latestPruneRun.deletedCount} deleted in latest run`
                            : "No operator prune recorded yet."
                        }
                      />
                    </div>

                    <div className="mt-4 grid gap-3 md:grid-cols-3">
                      <SettingTile
                        label="Info retention"
                        value={`${retention?.platformEvents.resolvedRetentionDays.info ?? 30} days`}
                        detail={`Eligible: ${retention?.platformEvents.stats.pruneEligibleBySeverity.info ?? 0}`}
                      />
                      <SettingTile
                        label="Warning retention"
                        value={`${retention?.platformEvents.resolvedRetentionDays.warning ?? 90} days`}
                        detail={`Eligible: ${retention?.platformEvents.stats.pruneEligibleBySeverity.warning ?? 0}`}
                      />
                      <SettingTile
                        label="Error retention"
                        value={`${retention?.platformEvents.resolvedRetentionDays.error ?? 180} days`}
                        detail={`Eligible: ${retention?.platformEvents.stats.pruneEligibleBySeverity.error ?? 0}`}
                      />
                    </div>

                    <div className="mt-4 flex flex-wrap items-center gap-3 rounded-2xl border border-border/50 bg-card p-3">
                      <Button
                        type="button"
                        variant="outline"
                        className="border-border/50 bg-card"
                        onClick={() => retentionMutation.mutate({ dryRun: true, limit: 500 })}
                        disabled={retentionMutation.isPending}
                      >
                        <RefreshCcw className="mr-2 h-4 w-4" />
                        Preview prune
                      </Button>
                      <Button
                        type="button"
                        className="bg-foreground text-background hover:bg-foreground/90"
                        onClick={() => retentionMutation.mutate({ dryRun: false, limit: 500 })}
                        disabled={retentionMutation.isPending || !retention?.platformEvents.supported}
                      >
                        <Trash2 className="mr-2 h-4 w-4" />
                        Prune resolved events
                      </Button>
                      <p className="text-xs text-muted-foreground">
                        Recovery drills are excluded. Unresolved incidents remain indefinitely.
                      </p>
                    </div>
                  </div>

                  <div className="rounded-3xl border border-border/50 bg-card p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2 text-foreground">
                          <Shield className="h-4 w-4 text-[#d8b26a]" />
                          <p className="text-sm font-medium">Audit & finance history</p>
                        </div>
                        <p className="text-sm text-muted-foreground">{retention?.auditTrail.note ?? "Protected by default."}</p>
                      </div>
                      <Badge variant="outline" className="border-border/50 bg-muted/30 text-muted-foreground">
                        protected
                      </Badge>
                    </div>

                    <div className="mt-4 grid gap-3 md:grid-cols-3">
                      <RetentionMetric
                        label="Stored entries"
                        value={`${retention?.auditTrail.stats.totalEntries ?? 0}`}
                        detail="Long-lived business audit history."
                      />
                      <RetentionMetric
                        label="Default archival horizon"
                        value={`${retention?.auditTrail.defaultRetentionDays ?? 2555} days`}
                        detail="Used as guidance, not destructive cleanup."
                      />
                      <RetentionMetric
                        label="Oldest retained"
                        value={
                          retention?.auditTrail.stats.oldestEntryAt
                            ? new Date(retention.auditTrail.stats.oldestEntryAt).toLocaleDateString()
                            : "No history yet"
                        }
                        detail="Finance/audit records remain available for long-term review."
                      />
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="border-border/50 bg-card">
              <CardHeader>
                <CardTitle className="font-serif text-2xl">Security posture</CardTitle>
                <p className="text-sm text-muted-foreground">A compact view of how the console stays quiet, isolated, and support-ready.</p>
              </CardHeader>
              <CardContent className="grid gap-3">
                {[
                  "Tenant data is isolated by tenant ID.",
                  "Platform routes only accept platform super admin access.",
                  "Slow requests and errors are recorded from live traffic.",
                  "Recovery actions stay inside the platform console.",
                ].map((item, index) => (
                  <div key={item} className="flex items-start gap-3 rounded-2xl border border-border/50 bg-card p-4">
                    <div className="mt-0.5 flex h-6 w-6 items-center justify-center rounded-full border border-border/50 bg-muted/30 text-xs font-semibold text-[#d8b26a]">
                      {index + 1}
                    </div>
                    <p className="text-sm text-muted-foreground">{item}</p>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card className="border-border/50 bg-card">
              <CardHeader>
                <CardTitle className="font-serif text-2xl">Platform admins</CardTitle>
                <p className="text-sm text-muted-foreground">Current super admin accounts in the platform tenant.</p>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow className="border-border/50">
                      <TableHead>Name</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Last login</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {admins.map((admin) => (
                      <TableRow key={admin.id} className="border-border/50">
                        <TableCell>
                          <div className="space-y-1">
                            <p className="font-medium text-foreground">{admin.name}</p>
                            <p className="text-xs text-muted-foreground">{admin.email}</p>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className={
                              admin.status === "active"
                                ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-200"
                                : "border-border/50 bg-muted/30 text-muted-foreground"
                            }
                          >
                            {admin.role}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right text-muted-foreground">
                          {admin.lastLoginAt ? new Date(admin.lastLoginAt).toLocaleString() : "Never"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {!admins.length ? <p className="px-6 py-6 text-sm text-muted-foreground">No platform admins loaded yet.</p> : null}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </PlatformShell>
  );
}

function SettingTile({
  label,
  value,
  detail,
  onCopy,
}: {
  label: string;
  value: string;
  detail: string;
  onCopy?: () => void;
}) {
  return (
    <div className="rounded-2xl border border-border/50 bg-card p-4">
      <p className="text-[11px] uppercase tracking-[0.22em] text-muted-foreground">{label}</p>
      <div className="mt-2 flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="break-all text-sm font-medium text-foreground">{value}</p>
          <p className="mt-1 text-sm text-muted-foreground">{detail}</p>
        </div>
        {onCopy ? (
          <button
            type="button"
            className="rounded-lg border border-border/50 bg-card p-2 text-muted-foreground transition hover:border-[#d8b26a]/25 hover:text-foreground"
            onClick={onCopy}
          >
            <Copy className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>
    </div>
  );
}

function RetentionMetric({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="rounded-2xl border border-border/50 bg-card p-4">
      <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
        <Clock3 className="h-3.5 w-3.5" />
        <span>{label}</span>
      </div>
      <p className="mt-3 text-xl font-semibold text-foreground">{value}</p>
      <p className="mt-1 text-sm text-muted-foreground">{detail}</p>
    </div>
  );
}
