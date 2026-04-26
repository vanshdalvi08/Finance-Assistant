import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  Activity,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Clock3,
  RefreshCcw,
  Radar,
  Search,
} from "lucide-react";
import { PlatformShell } from "@/layouts/platform-shell";
import { PageHeader } from "@/components/app/page-header";
import { MetricCard } from "@/components/app/metric-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api, type PlatformEvent } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

type SeverityFilter = "all" | "info" | "warning" | "error";
type CategoryFilter = "all" | "request" | "auth" | "database" | "upload" | "tenant" | "system";
type StateFilter = "all" | "open" | "acknowledged" | "resolved";
type DeliveryPosture = "delivered" | "failed" | "suppressed" | "pending" | "unknown";
type TrendPoint = {
  day: string;
  label: string;
  info: number;
  warning: number;
  error: number;
  total: number;
};

type TenantImpact = {
  key: string;
  label: string;
  issues: number;
  total: number;
  error: number;
  warning: number;
  info: number;
  latestAt: string;
};

type EventDeliveryInsight = {
  posture: DeliveryPosture;
  provider: string | null;
  destination: string | null;
  attemptedAt: string | null;
  deliveredAt: string | null;
  failedAt: string | null;
  statusCode: number | null;
  attempts: number | null;
  reason: string | null;
  error: string | null;
};

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function readString(record: Record<string, unknown> | null, keys: string[]): string | null {
  if (!record) {
    return null;
  }
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

function readNumber(record: Record<string, unknown> | null, keys: string[]): number | null {
  if (!record) {
    return null;
  }
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === "string" && value.trim()) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }
  return null;
}

function readBoolean(record: Record<string, unknown> | null, keys: string[]): boolean | null {
  if (!record) {
    return null;
  }
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "boolean") {
      return value;
    }
  }
  return null;
}

function normalizePosture(value: string | null): DeliveryPosture | null {
  if (!value) {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === "delivered" || normalized === "sent" || normalized === "ok" || normalized === "success") {
    return "delivered";
  }
  if (normalized === "failed" || normalized === "error" || normalized === "timeout") {
    return "failed";
  }
  if (normalized === "suppressed" || normalized === "skipped" || normalized === "cooldown") {
    return "suppressed";
  }
  if (normalized === "pending" || normalized === "queued" || normalized === "retrying" || normalized === "processing") {
    return "pending";
  }
  if (normalized === "unknown") {
    return "unknown";
  }
  return null;
}

function deliveryClass(posture: DeliveryPosture) {
  if (posture === "delivered") {
    return "border-border/60 bg-emerald-500/8 text-emerald-300";
  }
  if (posture === "failed") {
    return "border-border/60 bg-rose-500/8 text-rose-300";
  }
  if (posture === "suppressed") {
    return "border-border/60 bg-amber-500/8 text-amber-300";
  }
  if (posture === "pending") {
    return "border-border/60 bg-sky-500/8 text-sky-300";
  }
  return "border-border/60 bg-muted/30 text-muted-foreground";
}

function deliveryLabel(posture: DeliveryPosture) {
  if (posture === "delivered") return "delivered";
  if (posture === "failed") return "failed";
  if (posture === "suppressed") return "suppressed";
  if (posture === "pending") return "pending";
  return "unknown";
}

function getEventDeliveryInsight(event: PlatformEvent): EventDeliveryInsight {
  const metadata = asObject(event.metadata);
  const metadataCandidate =
    asObject(metadata?.externalDelivery) ??
    asObject(metadata?.delivery) ??
    asObject(metadata?.externalAlert) ??
    asObject(metadata?.alertDelivery) ??
    asObject(metadata?.monitoringDelivery) ??
    asObject(metadata?.webhookDelivery);
  const topLevelDelivery = asObject(event.delivery as unknown);
  const source = topLevelDelivery ?? metadataCandidate;

  const explicitState = normalizePosture(readString(source, ["state", "status", "result"]));
  const deliveredAt = readString(source, ["deliveredAt", "sentAt", "completedAt"]);
  const failedAt = readString(source, ["failedAt", "errorAt"]);
  const attemptedAt = readString(source, ["attemptedAt", "lastAttemptAt", "dispatchedAt", "updatedAt", "createdAt"]);
  const reason = readString(source, ["reason", "skipReason", "suppressedReason"]);
  const error = readString(source, ["error", "errorMessage", "failureReason"]);
  const success = readBoolean(source, ["success", "delivered"]);
  const statusCode = readNumber(source, ["statusCode", "responseStatus", "httpStatus"]);
  const attempts = readNumber(source, ["attempts", "attemptCount", "retries"]);

  const posture =
    explicitState ??
    (deliveredAt || success === true
      ? "delivered"
      : failedAt || success === false || Boolean(error)
        ? "failed"
        : reason && ["cooldown", "below_threshold", "min_severity", "suppressed", "skipped"].some((token) => reason.toLowerCase().includes(token))
          ? "suppressed"
          : attemptedAt
            ? "pending"
            : "unknown");

  return {
    posture,
    provider: readString(source, ["provider", "channel", "transport"]),
    destination: readString(source, ["destination", "endpoint", "target", "url"]),
    attemptedAt,
    deliveredAt,
    failedAt,
    statusCode,
    attempts,
    reason,
    error,
  };
}

function severityClass(severity: "info" | "warning" | "error") {
  return severity === "error"
    ? "border-border/60 bg-rose-500/8 text-rose-300"
    : severity === "warning"
      ? "border-border/60 bg-amber-500/8 text-amber-300"
      : "border-border/60 bg-sky-500/8 text-sky-300";
}

function incidentTone(severity: "info" | "warning" | "error") {
  return "border-border/60 bg-card";
}

function eventState(event: PlatformEvent): StateFilter {
  if (event.resolvedAt) {
    return "resolved";
  }
  if (event.acknowledgedAt) {
    return "acknowledged";
  }
  return "open";
}

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

function groupEventsByMonth(events: PlatformEvent[]) {
  const map = new Map<string, PlatformEvent[]>();
  for (const event of events) {
    const key = monthKey(event.createdAt);
    map.set(key, [...(map.get(key) ?? []), event]);
  }
  return [...map.entries()]
    .sort((left, right) => right[0].localeCompare(left[0]))
    .map(([month, rows]) => ({
      month,
      rows: [...rows].sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()),
    })); 
}

function buildTrendData(events: PlatformEvent[], days = 7): TrendPoint[] {
  const buckets = new Map<string, TrendPoint>();
  const now = new Date();

  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const date = new Date(now);
    date.setDate(now.getDate() - offset);
    const key = format(date, "yyyy-MM-dd");
    buckets.set(key, {
      day: key,
      label: format(date, "dd MMM"),
      info: 0,
      warning: 0,
      error: 0,
      total: 0,
    });
  }

  for (const event of events) {
    const key = event.createdAt.slice(0, 10);
    const bucket = buckets.get(key);
    if (!bucket) {
      continue;
    }

    bucket[event.severity] += 1;
    bucket.total += 1;
  }

  return [...buckets.values()];
}

function resolveTenantLabel(tenantId: string | undefined, tenantMap: Map<string, string>) {
  if (!tenantId) {
    return "Platform";
  }
  return tenantMap.get(tenantId) ?? tenantId;
}

export default function PlatformMonitoringPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>("all");
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>("all");
  const [stateFilter, setStateFilter] = useState<StateFilter>("all");
  const [search, setSearch] = useState("");
  const [selectedEvent, setSelectedEvent] = useState<PlatformEvent | null>(null);
  const [openGroups, setOpenGroups] = useState<Record<"info" | "warning" | "error", boolean>>({
    info: true,
    warning: true,
    error: true,
  });

  const monitoringQuery = useQuery({
    queryKey: ["platform-monitoring", severityFilter, categoryFilter, stateFilter, search],
    queryFn: () =>
      api.getFilteredPlatformMonitoring({
        limit: 120,
        severity: severityFilter === "all" ? undefined : severityFilter,
        category: categoryFilter === "all" ? undefined : categoryFilter,
        state: stateFilter,
        search: search.trim() || undefined,
      }),
    refetchInterval: 5000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });

  const tenantsQuery = useQuery({
    queryKey: ["platform-tenants"],
    queryFn: api.getPlatformTenants,
  });

  const tenantMap = useMemo(
    () => new Map((tenantsQuery.data ?? []).map((tenant) => [tenant.id, tenant.name])),
    [tenantsQuery.data],
  );

  const acknowledgeMutation = useMutation({
    mutationFn: (eventId: string) => api.acknowledgePlatformEvent(eventId),
    onSuccess: async () => {
      toast({ title: "Incident acknowledged" });
      await queryClient.invalidateQueries({ queryKey: ["platform-monitoring"] });
    },
    onError: (error) => {
      toast({
        title: "Could not acknowledge incident",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    },
  });

  const resolveMutation = useMutation({
    mutationFn: (eventId: string) => api.resolvePlatformEvent(eventId),
    onSuccess: async () => {
      toast({ title: "Incident resolved" });
      await queryClient.invalidateQueries({ queryKey: ["platform-monitoring"] });
    },
    onError: (error) => {
      toast({
        title: "Could not resolve incident",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    },
  });

  const triggerTestAlertMutation = useMutation({
    mutationFn: (input: { severity: "warning" | "error"; title: string }) =>
      api.triggerPlatformTestAlert({
        severity: input.severity,
        category: "system",
        title: input.title,
      }),
    onSuccess: async (result) => {
      toast({
        title: "Test alert queued",
        description: `Request ${result.testAlert.requestId.slice(0, 8)} submitted for external monitoring flow.`,
      });
      await queryClient.invalidateQueries({ queryKey: ["platform-monitoring"] });
      await queryClient.invalidateQueries({ queryKey: ["platform-overview"] });
    },
    onError: (error) => {
      toast({
        title: "Could not trigger test alert",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    },
  });

  const retryFailedDeliveryMutation = useMutation({
    mutationFn: (input?: { dryRun?: boolean; limit?: number }) => api.retryFailedPlatformEventDeliveries(input),
    onSuccess: async (result) => {
      toast({
        title: result.dryRun ? "Retry preview prepared" : "Retry batch completed",
        description: result.dryRun
          ? `${result.candidateCount} failed deliveries are currently retry candidates.`
          : `${result.retried} retried (${result.delivered} delivered, ${result.failed} failed, ${result.suppressed} suppressed).`,
      });
      await queryClient.invalidateQueries({ queryKey: ["platform-monitoring"] });
      await queryClient.invalidateQueries({ queryKey: ["platform-overview"] });
    },
    onError: (error) => {
      toast({
        title: "Could not retry failed deliveries",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    },
  });

  const retrySingleDeliveryMutation = useMutation({
    mutationFn: (eventId: string) => api.retryPlatformEventDelivery(eventId),
    onSuccess: async (result) => {
      toast({
        title: result.status === "retried" ? "Delivery retry sent" : "Delivery retry skipped",
        description:
          result.status === "retried"
            ? `State changed from ${result.previousState ?? "unknown"} to ${result.nextState ?? "unknown"}.`
            : `Reason: ${result.reason ?? "not eligible for retry"}.`,
      });
      await queryClient.invalidateQueries({ queryKey: ["platform-monitoring"] });
      await queryClient.invalidateQueries({ queryKey: ["platform-overview"] });
    },
    onError: (error) => {
      toast({
        title: "Could not retry this delivery",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    },
  });

  const monitoring = monitoringQuery.data;
  const filteredEvents = monitoring?.events ?? [];
  const deliveryInsights = useMemo(
    () => filteredEvents.map((event) => ({ eventId: event.id, insight: getEventDeliveryInsight(event) })),
    [filteredEvents],
  );
  const deliverySummary = useMemo(() => {
    const base = { delivered: 0, failed: 0, suppressed: 0, pending: 0, unknown: 0 } satisfies Record<DeliveryPosture, number>;
    for (const row of deliveryInsights) {
      base[row.insight.posture] += 1;
    }
    return base;
  }, [deliveryInsights]);
  const selectedDelivery = selectedEvent ? getEventDeliveryInsight(selectedEvent) : null;
  const currentMonth = format(new Date(), "yyyy-MM");
  const workflowSupported = monitoring?.workflowSupported !== false;
  const groupedEvents = useMemo(
    () =>
      ({
        info: filteredEvents.filter((event) => event.severity === "info"),
        warning: filteredEvents.filter((event) => event.severity === "warning"),
        error: filteredEvents.filter((event) => event.severity === "error"),
      }) as const,
    [filteredEvents],
  );
  const groupedEventsByMonth = useMemo(
    () =>
      ({
        info: groupEventsByMonth(groupedEvents.info),
        warning: groupEventsByMonth(groupedEvents.warning),
        error: groupEventsByMonth(groupedEvents.error),
      }) as const,
    [groupedEvents],
  );
  const ledgerByMonth = useMemo(() => groupEventsByMonth(filteredEvents).slice(0, 6), [filteredEvents]);
  const trendData = useMemo(() => buildTrendData(filteredEvents, 7), [filteredEvents]);
  const tenantImpact = useMemo(() => {
    const buckets = new Map<string, TenantImpact>();

    for (const event of filteredEvents) {
      const key = event.tenantId ?? "__platform__";
      const label = resolveTenantLabel(event.tenantId, tenantMap);
      const current = buckets.get(key) ?? {
        key,
        label,
        issues: 0,
        total: 0,
        error: 0,
        warning: 0,
        info: 0,
        latestAt: event.createdAt,
      };

      current.total += 1;
      current[event.severity] += 1;
      if (event.severity !== "info") {
        current.issues += 1;
      }
      if (new Date(event.createdAt).getTime() > new Date(current.latestAt).getTime()) {
        current.latestAt = event.createdAt;
      }
      current.label = label;
      buckets.set(key, current);
    }

    return [...buckets.values()]
      .sort((left, right) => right.issues - left.issues || right.total - left.total || right.latestAt.localeCompare(left.latestAt))
      .slice(0, 5);
  }, [filteredEvents, tenantMap]);

  const severitySegments = [
    {
      key: "error",
      label: "Action must be taken",
      count: monitoring?.summary.error ?? 0,
      detail: "Unresolved failures and incidents that need operator attention first.",
      className: "border-rose-500/15 bg-rose-500/8 text-rose-200",
      barClassName: "bg-rose-500/70",
    },
    {
      key: "warning",
      label: "Needs attention",
      count: monitoring?.summary.warning ?? 0,
      detail: "Review soon and keep an eye on drift, latency, or retry pressure.",
      className: "border-amber-500/15 bg-amber-500/8 text-amber-200",
      barClassName: "bg-amber-500/70",
    },
    {
      key: "info",
      label: "Looks fine",
      count: monitoring?.summary.info ?? 0,
      detail: "Healthy operational events and lower-risk telemetry.",
      className: "border-cyan-500/15 bg-cyan-500/8 text-cyan-200",
      barClassName: "bg-cyan-500/70",
    },
  ] as const;

  return (
    <PlatformShell>
      <div className="space-y-8">
        <PageHeader
          eyebrow="Monitoring"
          title="Operational telemetry"
          description="Acknowledge incidents, inspect payloads, and separate open issues from resolved noise."
        />

        <div className="grid gap-4 xl:grid-cols-4">
          <MetricCard label="Info" value={`${monitoring?.summary.info ?? 0}`} icon={<Activity className="h-5 w-5" />} />
          <MetricCard label="Warnings" value={`${monitoring?.summary.warning ?? 0}`} icon={<Clock3 className="h-5 w-5" />} />
          <MetricCard label="Errors" value={`${monitoring?.summary.error ?? 0}`} icon={<AlertTriangle className="h-5 w-5" />} />
          <MetricCard label="Visible Events" value={`${filteredEvents.length}`} icon={<Radar className="h-5 w-5" />} />
        </div>

        <div className="grid gap-6 xl:grid-cols-[1.25fr_0.75fr]">
          <Card className="border-border/60 bg-card shadow-sm">
            <CardHeader className="space-y-2">
              <CardTitle className="text-2xl font-semibold tracking-tight">Live event trend</CardTitle>
              <p className="text-sm text-muted-foreground">
                Auto-refreshes every 5 seconds. The chart shows the last 7 days of platform activity.
              </p>
            </CardHeader>
            <CardContent>
              <div className="h-[260px]">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={trendData} margin={{ top: 10, right: 8, left: -12, bottom: 0 }}>
                    <defs>
                      <linearGradient id="trendInfo" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#38bdf8" stopOpacity={0.35} />
                        <stop offset="95%" stopColor="#38bdf8" stopOpacity={0.02} />
                      </linearGradient>
                      <linearGradient id="trendWarning" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.28} />
                        <stop offset="95%" stopColor="#f59e0b" stopOpacity={0.02} />
                      </linearGradient>
                      <linearGradient id="trendError" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#ef4444" stopOpacity={0.28} />
                        <stop offset="95%" stopColor="#ef4444" stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.55} />
                    <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={12} stroke="hsl(var(--muted-foreground))" />
                    <YAxis allowDecimals={false} tickLine={false} axisLine={false} fontSize={12} stroke="hsl(var(--muted-foreground))" />
                    <Tooltip
                      contentStyle={{
                        background: "hsl(var(--card))",
                        border: "1px solid hsl(var(--border))",
                        borderRadius: "12px",
                        color: "hsl(var(--foreground))",
                      }}
                      labelStyle={{ color: "hsl(var(--foreground))" }}
                    />
                    <Area type="monotone" dataKey="error" stackId="1" stroke="#ef4444" fill="url(#trendError)" strokeWidth={2} />
                    <Area type="monotone" dataKey="warning" stackId="1" stroke="#f59e0b" fill="url(#trendWarning)" strokeWidth={2} />
                    <Area type="monotone" dataKey="info" stackId="1" stroke="#38bdf8" fill="url(#trendInfo)" strokeWidth={2} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          <Card className="border-border/60 bg-card shadow-sm">
            <CardHeader className="space-y-2">
              <CardTitle className="text-2xl font-semibold tracking-tight">Severity guide</CardTitle>
              <p className="text-sm text-muted-foreground">Plain-language status cues for fast scanning.</p>
            </CardHeader>
            <CardContent className="space-y-3">
              {severitySegments.map((segment) => (
                <div key={segment.key} className={cn("rounded-xl border p-4", segment.className)}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1">
                      <p className="text-sm font-medium">{segment.label}</p>
                      <p className="text-xs leading-5 text-muted-foreground">{segment.detail}</p>
                    </div>
                    <p className="text-2xl font-semibold tracking-tight">{segment.count}</p>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        <Card className="border-border/60 bg-card shadow-sm">
          <CardHeader className="space-y-2">
            <CardTitle className="text-2xl font-semibold tracking-tight">External alert delivery posture</CardTitle>
            <p className="text-sm text-muted-foreground">
              Delivery state inferred from per-event metadata and direct delivery fields. Unknown means delivery details were not attached.
            </p>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            {(["delivered", "failed", "suppressed", "pending", "unknown"] as DeliveryPosture[]).map((posture) => (
              <div key={posture} className={cn("rounded-xl border px-4 py-3", deliveryClass(posture))}>
                <p className="text-[11px] uppercase tracking-[0.22em]">{deliveryLabel(posture)}</p>
                <p className="mt-2 text-2xl font-semibold">{deliverySummary[posture]}</p>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="border-border/60 bg-card shadow-sm">
          <CardHeader className="space-y-2">
            <CardTitle className="text-2xl font-semibold tracking-tight">Top affected tenants</CardTitle>
            <p className="text-sm text-muted-foreground">Shows which tenant is generating the most warning and error activity right now.</p>
          </CardHeader>
          <CardContent className="space-y-3">
            {tenantImpact.length ? (
              tenantImpact.map((tenant) => (
                <div key={tenant.key} className="rounded-xl border border-border/60 bg-muted/20 p-4">
                  <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline" className="border-border/60 bg-background/60 text-foreground">
                          {tenant.label}
                        </Badge>
                        <span className="text-sm text-muted-foreground">
                          {tenant.issues} issue{tenant.issues === 1 ? "" : "s"} · {tenant.total} event{tenant.total === 1 ? "" : "s"}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Error {tenant.error} · warning {tenant.warning} · info {tenant.info} · latest {format(new Date(tenant.latestAt), "dd MMM, HH:mm")}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Badge variant="outline" className="border-rose-500/15 bg-rose-500/8 text-rose-300">
                        {tenant.error} red
                      </Badge>
                      <Badge variant="outline" className="border-amber-500/15 bg-amber-500/8 text-amber-300">
                        {tenant.warning} orange
                      </Badge>
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <div className="rounded-xl border border-dashed border-border/60 bg-muted/20 px-4 py-6 text-sm text-muted-foreground">
                No tenant-specific activity yet.
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border-border/60 bg-card shadow-sm">
          <CardHeader className="space-y-4">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <CardTitle className="text-2xl font-semibold tracking-tight">Incident workspace</CardTitle>
                <p className="mt-1 text-sm text-muted-foreground">
                  Filter by severity, category, or incident state, then open a record for the full payload.
                </p>
              </div>
              <div className="grid gap-3 lg:min-w-[26rem]">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Search title, path, message, or fingerprint"
                    className="pl-9"
                  />
                </div>
                <div className="flex flex-wrap gap-2">
                  {(["all", "info", "warning", "error"] as SeverityFilter[]).map((value) => (
                    <Button
                      key={value}
                      size="sm"
                      variant={severityFilter === value ? "default" : "outline"}
                      className={severityFilter === value ? "" : "border-border/60 bg-card"}
                      onClick={() => setSeverityFilter(value)}
                    >
                      {value}
                    </Button>
                  ))}
                </div>
                <div className="flex flex-wrap gap-2">
                  {(["all", "request", "auth", "database", "upload", "tenant", "system"] as CategoryFilter[]).map((value) => (
                    <Button
                      key={value}
                      size="sm"
                      variant={categoryFilter === value ? "default" : "outline"}
                      className={categoryFilter === value ? "" : "border-border/60 bg-card"}
                      onClick={() => setCategoryFilter(value)}
                    >
                      {value}
                    </Button>
                  ))}
                </div>
                <div className="flex flex-wrap gap-2">
                  {(["all", "open", "acknowledged", "resolved"] as StateFilter[]).map((value) => (
                    <Button
                      key={value}
                      size="sm"
                      variant={stateFilter === value ? "default" : "outline"}
                      disabled={!workflowSupported && value !== "all" && value !== "open"}
                      className={stateFilter === value ? "" : "border-border/60 bg-card"}
                      onClick={() => setStateFilter(value)}
                    >
                      {value}
                    </Button>
                  ))}
                </div>
              </div>
              {!workflowSupported ? (
                <div className="rounded-xl border border-border/60 bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
                  Incident workflow is temporarily read-only because the active database has not finished the monitoring workflow upgrade yet.
                </div>
              ) : null}
              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  className="border-border/60 bg-card"
                  onClick={() => retryFailedDeliveryMutation.mutate({ dryRun: false, limit: 25 })}
                  disabled={retryFailedDeliveryMutation.isPending}
                >
                  <RefreshCcw className="mr-2 h-4 w-4" />
                  {retryFailedDeliveryMutation.isPending ? "Retrying..." : "Retry Failed Deliveries"}
                </Button>
                <Button
                  variant="outline"
                    className="border-border/60 bg-card"
                  onClick={() =>
                    triggerTestAlertMutation.mutate({
                      severity: "warning",
                      title: "Manual warning test alert",
                    })
                  }
                  disabled={triggerTestAlertMutation.isPending}
                >
                  {triggerTestAlertMutation.isPending ? "Triggering..." : "Trigger Warning Test"}
                </Button>
                <Button
                  variant="outline"
                  className="border-border/60 bg-card"
                  onClick={() =>
                    triggerTestAlertMutation.mutate({
                      severity: "error",
                      title: "Manual error escalation test",
                    })
                  }
                  disabled={triggerTestAlertMutation.isPending}
                >
                  {triggerTestAlertMutation.isPending ? "Triggering..." : "Trigger Error Test"}
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {monitoringQuery.isLoading ? (
              <div className="rounded-xl border border-border/60 bg-card px-4 py-8 text-sm text-muted-foreground">
                Loading monitoring data...
              </div>
            ) : monitoringQuery.isError ? (
              <div className="rounded-xl border border-border/60 bg-card px-4 py-8 text-sm text-muted-foreground">
                Could not load monitoring data right now.
              </div>
            ) : (
              (["error", "warning", "info"] as const).map((severity) => {
                const rows = groupedEvents[severity];
                const open = openGroups[severity];
                return (
                  <div key={severity} className={cn("rounded-xl border p-4", incidentTone(severity))}>
                    <button
                      type="button"
                      className="flex w-full items-start justify-between gap-4 text-left"
                      onClick={() => setOpenGroups((current) => ({ ...current, [severity]: !current[severity] }))}
                    >
                      <div>
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className={severityClass(severity)}>
                            {severity}
                          </Badge>
                          <span className="text-xs uppercase tracking-[0.2em] text-muted-foreground">{rows.length} events</span>
                        </div>
                        <p className="mt-2 text-sm text-muted-foreground">
                          {severity === "error"
                            ? "Failures and unresolved incidents that need operator attention first."
                            : severity === "warning"
                              ? "Recoverable issues, latency spikes, and monitored friction."
                              : "Healthy operational events and lower-risk telemetry."}
                        </p>
                      </div>
                      <div className="mt-1 text-muted-foreground">{open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</div>
                    </button>

                    {open ? (
                      <div className="mt-4 space-y-3">
                        {rows.length ? (
                          groupedEventsByMonth[severity].map((monthGroup) => (
                            <Collapsible key={`${severity}-${monthGroup.month}`} defaultOpen={monthGroup.month === currentMonth}>
                              <div className="overflow-hidden rounded-xl border border-border/60 bg-card">
                                <CollapsibleTrigger asChild>
                                  <button type="button" className="flex w-full items-center justify-between gap-4 border-b border-border/60 px-4 py-3 text-left">
                                    <div>
                                      <p className="text-sm font-medium text-foreground">{monthLabel(monthGroup.month)}</p>
                                      <p className="mt-1 text-xs text-muted-foreground">{monthGroup.rows.length} events</p>
                                    </div>
                                    <ChevronDown className="h-4 w-4 text-muted-foreground" />
                                  </button>
                                </CollapsibleTrigger>
                                <CollapsibleContent>
                                  <div className="space-y-3 p-3">
                                    {monthGroup.rows.map((event) => (
                                      <button
                                        key={event.id}
                                        type="button"
                                        className="block w-full rounded-xl border border-border/60 bg-card p-4 text-left transition hover:border-border/80 hover:bg-muted/30"
                                        onClick={() => setSelectedEvent(event)}
                                      >
                                        <div className="space-y-2">
                                          <div className="flex flex-wrap items-center gap-2">
                                            <p className="font-medium text-foreground">{event.title}</p>
                                            <Badge variant="outline" className="border-border/60 bg-muted/30 text-muted-foreground">
                                              {event.category}
                                            </Badge>
                                            <Badge variant="outline" className="border-border/60 bg-muted/30 text-muted-foreground">
                                              {eventState(event)}
                                            </Badge>
                                          </div>
                                          <p className="line-clamp-2 text-sm text-muted-foreground">{event.message}</p>
                                          <p className="text-xs text-muted-foreground">
                                            {(event.method ?? "GET")} {event.path ?? "system"}
                                            {" · "}
                                            {event.tenantId ? tenantMap.get(event.tenantId) ?? "Scoped" : "Platform"}
                                            {" · "}
                                            {typeof event.durationMs === "number" ? `${event.durationMs} ms` : "n/a"}
                                          </p>
                                        </div>
                                      </button>
                                    ))}
                                  </div>
                                </CollapsibleContent>
                              </div>
                            </Collapsible>
                          ))
                        ) : (
                          <div className="rounded-xl border border-dashed border-border/60 bg-card px-4 py-6 text-sm text-muted-foreground">
                            No {severity} events match the current filters.
                          </div>
                        )}
                      </div>
                    ) : null}
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>

        <Card className="border-border/60 bg-card shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <div>
              <CardTitle className="text-2xl font-semibold tracking-tight">Recent incidents ledger</CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">A denser ledger for operators who want the latest runtime picture quickly.</p>
            </div>
          </CardHeader>
          <CardContent className="space-y-3 p-4">
            {ledgerByMonth.length ? (
              ledgerByMonth.map((monthGroup) => (
                <Collapsible key={`ledger-${monthGroup.month}`} defaultOpen={monthGroup.month === currentMonth}>
                  <div className="overflow-hidden rounded-xl border border-border/60 bg-card">
                    <CollapsibleTrigger asChild>
                      <button type="button" className="flex w-full items-center justify-between gap-3 border-b border-border/60 px-4 py-3 text-left">
                        <div>
                          <p className="text-sm font-medium text-foreground">{monthLabel(monthGroup.month)}</p>
                          <p className="text-xs text-muted-foreground">{monthGroup.rows.length} ledger rows</p>
                        </div>
                        <ChevronDown className="h-4 w-4 text-muted-foreground" />
                      </button>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <Table>
                <TableHeader>
                          <TableRow className="border-border/60">
                            <TableHead>Severity</TableHead>
                            <TableHead>Title</TableHead>
                            <TableHead>Target</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead>Delivery</TableHead>
                            <TableHead className="text-right">Duration</TableHead>
                            <TableHead className="text-right">Time</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {monthGroup.rows.slice(0, 20).map((event) => (
                    <TableRow key={event.id} className="cursor-pointer border-border/60" onClick={() => setSelectedEvent(event)}>
                              <TableCell>
                                <Badge variant="outline" className={severityClass(event.severity)}>
                                  {event.severity}
                                </Badge>
                              </TableCell>
                              <TableCell>
                                <div className="space-y-1">
                                  <p className="font-medium text-foreground">{event.title}</p>
                                  <p className="line-clamp-1 text-xs text-muted-foreground">{event.message}</p>
                                </div>
                              </TableCell>
                              <TableCell>
                                <div className="space-y-1">
                                  <p className="text-sm text-foreground">{event.category}</p>
                                  <p className="text-xs text-muted-foreground">
                                    {event.tenantId ? tenantMap.get(event.tenantId) ?? event.tenantId : "Platform"} | {event.method ?? "GET"} {event.path ?? "system"}
                                  </p>
                                </div>
                              </TableCell>
                              <TableCell className="text-muted-foreground">{eventState(event)}</TableCell>
                              <TableCell>
                                {(() => {
                                  const delivery = getEventDeliveryInsight(event);
                                  return (
                                    <Badge variant="outline" className={deliveryClass(delivery.posture)}>
                                      {deliveryLabel(delivery.posture)}
                                    </Badge>
                                  );
                                })()}
                              </TableCell>
                              <TableCell className="text-right text-muted-foreground">
                                {typeof event.durationMs === "number" ? `${event.durationMs} ms` : "-"}
                              </TableCell>
                              <TableCell className="text-right text-muted-foreground">{format(new Date(event.createdAt), "dd MMM, HH:mm")}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </CollapsibleContent>
                  </div>
                </Collapsible>
              ))
            ) : (
              <p className="px-2 py-6 text-sm text-muted-foreground">No events match the current filters.</p>
            )}
          </CardContent>
        </Card>

        <Dialog open={Boolean(selectedEvent)} onOpenChange={(open) => !open && setSelectedEvent(null)}>
          <DialogContent className="max-w-3xl border-border/50 bg-background text-foreground">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-2xl">
                <Badge variant="outline" className={selectedEvent ? severityClass(selectedEvent.severity) : ""}>
                  {selectedEvent?.severity ?? "info"}
                </Badge>
                {selectedEvent?.title}
              </DialogTitle>
              <DialogDescription className="text-muted-foreground">
                Full incident payload, current state, and operator actions.
              </DialogDescription>
            </DialogHeader>

            {selectedEvent ? (
              <div className="space-y-5">
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  <InspectorTile label="Category" value={selectedEvent.category} />
                  <InspectorTile label="State" value={eventState(selectedEvent)} />
                  <InspectorTile label="Tenant" value={selectedEvent.tenantId ? tenantMap.get(selectedEvent.tenantId) ?? selectedEvent.tenantId : "Platform"} />
                  <InspectorTile label="Status code" value={selectedEvent.statusCode ? String(selectedEvent.statusCode) : "n/a"} />
                </div>

                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  <InspectorTile label="Method" value={selectedEvent.method ?? "GET"} />
                  <InspectorTile label="Path" value={selectedEvent.path ?? "system"} />
                  <InspectorTile label="Duration" value={typeof selectedEvent.durationMs === "number" ? `${selectedEvent.durationMs} ms` : "n/a"} />
                  <InspectorTile label="Created" value={format(new Date(selectedEvent.createdAt), "dd MMM yyyy, HH:mm")} />
                </div>

                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  <InspectorTile label="External delivery" value={deliveryLabel(selectedDelivery?.posture ?? "unknown")} />
                  <InspectorTile label="Provider" value={selectedDelivery?.provider ?? "n/a"} />
                  <InspectorTile
                    label="Last attempt"
                    value={selectedDelivery?.attemptedAt ? format(new Date(selectedDelivery.attemptedAt), "dd MMM yyyy, HH:mm") : "n/a"}
                  />
                  <InspectorTile label="Delivery status code" value={selectedDelivery?.statusCode ? String(selectedDelivery.statusCode) : "n/a"} />
                </div>

                <div className="rounded-2xl border border-border/50 bg-card p-4">
                  <p className="text-[11px] uppercase tracking-[0.22em] text-muted-foreground">Message</p>
                  <p className="mt-2 text-sm text-foreground">{selectedEvent.message}</p>
                </div>

                <div className="rounded-2xl border border-border/50 bg-card p-4">
                  <p className="text-[11px] uppercase tracking-[0.22em] text-muted-foreground">External delivery details</p>
                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    <InspectorTile label="Destination" value={selectedDelivery?.destination ?? "n/a"} />
                    <InspectorTile
                      label="Delivered at"
                      value={selectedDelivery?.deliveredAt ? format(new Date(selectedDelivery.deliveredAt), "dd MMM yyyy, HH:mm") : "n/a"}
                    />
                    <InspectorTile
                      label="Failed at"
                      value={selectedDelivery?.failedAt ? format(new Date(selectedDelivery.failedAt), "dd MMM yyyy, HH:mm") : "n/a"}
                    />
                    <InspectorTile label="Attempts" value={typeof selectedDelivery?.attempts === "number" ? String(selectedDelivery.attempts) : "n/a"} />
                  </div>
                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    <InspectorTile label="Reason" value={selectedDelivery?.reason ?? "n/a"} />
                    <InspectorTile label="Error" value={selectedDelivery?.error ?? "n/a"} />
                  </div>
                </div>

                <div className="rounded-2xl border border-border/50 bg-card p-4">
                  <p className="text-[11px] uppercase tracking-[0.22em] text-muted-foreground">Fingerprint</p>
                  <code className="mt-2 block break-all text-xs text-cyan-100">{selectedEvent.fingerprint ?? "Not available"}</code>
                </div>

                <div className="rounded-2xl border border-border/50 bg-card p-4">
                  <p className="text-[11px] uppercase tracking-[0.22em] text-muted-foreground">Metadata</p>
                  <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap break-all text-xs text-slate-300">
                    {JSON.stringify(selectedEvent.metadata ?? {}, null, 2)}
                  </pre>
                </div>

                <div className="flex flex-wrap gap-3">
                  <Button
                    variant="outline"
                    className="border-border/50 bg-card text-foreground hover:bg-muted/50"
                    disabled={
                      !selectedEvent ||
                      selectedDelivery?.posture !== "failed" ||
                      retrySingleDeliveryMutation.isPending
                    }
                    onClick={() => selectedEvent && retrySingleDeliveryMutation.mutate(selectedEvent.id)}
                  >
                    <RefreshCcw className="mr-2 h-4 w-4" />
                    Retry delivery
                  </Button>
                  <Button
                    variant="outline"
                    className="border-border/50 bg-card"
                    disabled={!workflowSupported || Boolean(selectedEvent.acknowledgedAt) || acknowledgeMutation.isPending}
                    onClick={() => acknowledgeMutation.mutate(selectedEvent.id)}
                  >
                    Acknowledge
                  </Button>
                  <Button
                    disabled={!workflowSupported || Boolean(selectedEvent.resolvedAt) || resolveMutation.isPending}
                    onClick={() => resolveMutation.mutate(selectedEvent.id)}
                  >
                    Mark resolved
                  </Button>
                </div>
              </div>
            ) : null}
          </DialogContent>
        </Dialog>
      </div>
    </PlatformShell>
  );
}

function InspectorTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-border/50 bg-card p-4">
      <p className="text-[11px] uppercase tracking-[0.22em] text-muted-foreground">{label}</p>
      <p className="mt-2 break-all text-sm text-foreground">{value}</p>
    </div>
  );
}
