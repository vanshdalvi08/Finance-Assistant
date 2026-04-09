import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  Activity,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Clock3,
  Radar,
  Search,
} from "lucide-react";
import { PlatformShell } from "@/layouts/platform-shell";
import { PageHeader } from "@/components/app/page-header";
import { MetricCard } from "@/components/app/metric-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

type SeverityFilter = "all" | "info" | "warning" | "error";

function severityClass(severity: "info" | "warning" | "error") {
  return severity === "error"
    ? "border-rose-400/20 bg-rose-400/10 text-rose-200"
    : severity === "warning"
      ? "border-amber-400/20 bg-amber-400/10 text-amber-200"
      : "border-cyan-400/20 bg-cyan-400/10 text-cyan-200";
}

function incidentTone(severity: "info" | "warning" | "error") {
  return severity === "error"
    ? "border-rose-400/15 bg-rose-400/5"
    : severity === "warning"
      ? "border-amber-400/15 bg-amber-400/5"
      : "border-cyan-400/15 bg-cyan-400/5";
}

export default function PlatformMonitoringPage() {
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>("all");
  const [search, setSearch] = useState("");
  const [openGroups, setOpenGroups] = useState<Record<"info" | "warning" | "error", boolean>>({
    info: true,
    warning: true,
    error: true,
  });

  const { data: monitoring } = useQuery({
    queryKey: ["platform-monitoring"],
    queryFn: () => api.getPlatformMonitoring(80),
  });

  const filteredEvents = useMemo(() => {
    const query = search.trim().toLowerCase();
    const rows = monitoring?.events ?? [];
    return rows.filter((event) => {
      const matchesSeverity = severityFilter === "all" ? true : event.severity === severityFilter;
      const matchesSearch =
        !query ||
        event.title.toLowerCase().includes(query) ||
        event.message.toLowerCase().includes(query) ||
        event.category.toLowerCase().includes(query) ||
        (event.path ?? "").toLowerCase().includes(query);
      return matchesSeverity && matchesSearch;
    });
  }, [monitoring?.events, search, severityFilter]);

  const groupedEvents = useMemo(
    () =>
      ({
        info: filteredEvents.filter((event) => event.severity === "info"),
        warning: filteredEvents.filter((event) => event.severity === "warning"),
        error: filteredEvents.filter((event) => event.severity === "error"),
      }) as const,
    [filteredEvents],
  );

  const visibleCount = filteredEvents.length;

  return (
    <PlatformShell>
      <div className="space-y-8">
        <PageHeader
          eyebrow="Monitoring"
          title="Operational telemetry"
          description="Runtime events, slow requests, and platform warnings in a calm incident workspace."
        />

        <div className="grid gap-4 xl:grid-cols-4">
          <MetricCard label="Info" value={`${monitoring?.summary.info ?? 0}`} icon={<Activity className="h-5 w-5" />} />
          <MetricCard label="Warnings" value={`${monitoring?.summary.warning ?? 0}`} icon={<Clock3 className="h-5 w-5" />} />
          <MetricCard label="Errors" value={`${monitoring?.summary.error ?? 0}`} icon={<AlertTriangle className="h-5 w-5" />} />
          <MetricCard label="Visible Events" value={`${visibleCount}`} icon={<Radar className="h-5 w-5" />} />
        </div>

        <Card className="border-white/8 bg-white/[0.03]">
          <CardHeader className="space-y-4">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <CardTitle className="font-serif text-2xl">Incident workspace</CardTitle>
                <p className="mt-1 text-sm text-muted-foreground">Grouped by severity so the important things stay visible without turning into a log dump.</p>
              </div>
              <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
                <div className="relative min-w-[260px]">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search incidents" className="pl-9" />
                </div>
                <div className="flex flex-wrap gap-2">
                  {(["all", "info", "warning", "error"] as SeverityFilter[]).map((value) => (
                    <Button
                      key={value}
                      size="sm"
                      variant={severityFilter === value ? "default" : "outline"}
                      className={severityFilter === value ? "" : "border-white/10 bg-white/[0.03]"}
                      onClick={() => setSeverityFilter(value)}
                    >
                      {value}
                    </Button>
                  ))}
                </div>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {(["error", "warning", "info"] as const).map((severity) => {
              const rows = groupedEvents[severity];
              const open = openGroups[severity];
              return (
                <div key={severity} className={cn("rounded-3xl border p-4", incidentTone(severity))}>
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
                          ? "Failures and exceptions that need attention first."
                          : severity === "warning"
                            ? "Slow requests and recoverable issues worth watching."
                            : "Healthy events and normal system activity."}
                      </p>
                    </div>
                    <div className="mt-1 text-muted-foreground">{open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</div>
                  </button>

                  {open ? (
                    <div className="mt-4 space-y-3">
                      {rows.length ? (
                        rows.slice(0, 6).map((event) => (
                          <div key={event.id} className="rounded-2xl border border-white/8 bg-black/20 p-4">
                            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                              <div className="min-w-0 space-y-1">
                                <div className="flex flex-wrap items-center gap-2">
                                  <p className="font-medium text-foreground">{event.title}</p>
                                  <span className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{event.category}</span>
                                </div>
                                <p className="line-clamp-2 text-sm text-muted-foreground">{event.message}</p>
                                <p className="text-xs text-muted-foreground">
                                  {event.method ?? "GET"} {event.path ?? "system"}
                                </p>
                              </div>
                              <div className="flex items-center gap-3 text-right">
                                <div className="rounded-2xl border border-white/8 bg-black/20 px-3 py-2">
                                  <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Time</p>
                                  <p className="mt-1 text-sm text-foreground">{format(new Date(event.createdAt), "dd MMM, HH:mm")}</p>
                                </div>
                                <div className="rounded-2xl border border-white/8 bg-black/20 px-3 py-2">
                                  <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Duration</p>
                                  <p className="mt-1 text-sm text-foreground">
                                    {typeof event.durationMs === "number" ? `${event.durationMs} ms` : "n/a"}
                                  </p>
                                </div>
                              </div>
                            </div>
                          </div>
                        ))
                      ) : (
                        <div className="rounded-2xl border border-dashed border-white/10 bg-black/15 px-4 py-6 text-sm text-muted-foreground">
                          No {severity} events match the current filters.
                        </div>
                      )}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </CardContent>
        </Card>

        <Card className="border-white/8 bg-white/[0.03]">
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <div>
              <CardTitle className="font-serif text-2xl">Recent incidents ledger</CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">A compact operational history for the latest platform activity.</p>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="border-white/5">
                  <TableHead>Severity</TableHead>
                  <TableHead>Title</TableHead>
                  <TableHead>Target</TableHead>
                  <TableHead className="text-right">Duration</TableHead>
                  <TableHead className="text-right">Time</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredEvents.slice(0, 12).map((event) => (
                  <TableRow key={event.id} className="border-white/5">
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
                          {event.method ?? "GET"} {event.path ?? "system"}
                        </p>
                      </div>
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {typeof event.durationMs === "number" ? `${event.durationMs} ms` : "-"}
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">{format(new Date(event.createdAt), "dd MMM, HH:mm")}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {!filteredEvents.length ? <p className="px-6 py-6 text-sm text-muted-foreground">No events match the current filters.</p> : null}
          </CardContent>
        </Card>
      </div>
    </PlatformShell>
  );
}
