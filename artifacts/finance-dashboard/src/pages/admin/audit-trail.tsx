import { useMemo, useState } from "react";
import { format, formatDistanceToNow } from "date-fns";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeftRight,
  ChevronDown,
  Clock3,
  FileJson,
  Fingerprint,
  Layers3,
  Search,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { api, type AuditTrailEntry } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";

const ENTITY_OPTIONS = [
  "all",
  "employee",
  "expense",
  "fund",
  "salary",
  "timesheet",
  "category",
  "project-budget",
  "purchase-order",
  "purchase-order-task",
  "pre-approval",
  "pre-approval-comment",
] as const;

const ROLE_OPTIONS = ["all", "admin", "employee", "client", "system"] as const;
const FINANCE_ENTITIES = new Set<AuditTrailEntry["entityType"]>(["fund", "expense", "salary", "purchase-order", "purchase-order-task", "pre-approval"]);

function monthValue(date: string) {
  return date.slice(0, 7);
}

function dayValue(date: string) {
  return date.slice(0, 10);
}

function formatMonthLabel(value: string) {
  const [year, month] = value.split("-");
  if (!year || !month) {
    return "All months";
  }
  return format(new Date(Number(year), Number(month) - 1, 1), "MMMM yyyy");
}

function actionLabel(action: string) {
  return action.replace(/_/g, " ");
}

function roleBadgeClass(role: AuditTrailEntry["actorRole"]) {
  if (role === "admin") return "border-sky-500/25 bg-sky-500/10 text-sky-200";
  if (role === "employee") return "border-emerald-500/25 bg-emerald-500/10 text-emerald-200";
  if (role === "client") return "border-amber-500/25 bg-amber-500/10 text-amber-200";
  return "border-border/60 bg-secondary/70 text-muted-foreground";
}

function entityBadgeClass(entity: AuditTrailEntry["entityType"]) {
  if (entity.includes("purchase-order")) return "border-amber-500/25 bg-amber-500/10 text-amber-200";
  if (entity === "salary") return "border-violet-500/25 bg-violet-500/10 text-violet-200";
  if (entity === "expense") return "border-rose-500/25 bg-rose-500/10 text-rose-200";
  if (entity === "fund") return "border-cyan-500/25 bg-cyan-500/10 text-cyan-200";
  if (entity.includes("pre-approval")) return "border-indigo-500/25 bg-indigo-500/10 text-indigo-200";
  return "border-border/60 bg-secondary/70 text-muted-foreground";
}

function labelize(value: string) {
  return value.replace(/-/g, " ");
}

function stringifyValue(value: unknown) {
  if (value === null || value === undefined || value === "") {
    return "Not set";
  }
  if (typeof value === "object") {
    return JSON.stringify(value);
  }
  return String(value);
}

function renderKeyValueBlock(value: Record<string, unknown> | null | undefined) {
  if (!value || Object.keys(value).length === 0) {
    return <p className="text-sm text-muted-foreground">No captured values.</p>;
  }

  return (
    <div className="grid gap-2">
      {Object.entries(value).map(([key, item]) => (
        <div key={key} className="rounded-xl border border-border/50 bg-background/70 px-3 py-2">
          <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">{key}</p>
          <p className="mt-1 break-all text-sm text-foreground/90">{stringifyValue(item)}</p>
        </div>
      ))}
    </div>
  );
}

export default function AdminAuditTrailPage() {
  const [selectedMonth, setSelectedMonth] = useState(() => format(new Date(), "yyyy-MM"));
  const [selectedRole, setSelectedRole] = useState<(typeof ROLE_OPTIONS)[number]>("all");
  const [selectedEntity, setSelectedEntity] = useState<(typeof ENTITY_OPTIONS)[number]>("all");
  const [search, setSearch] = useState("");

  const { data: auditTrail = [] } = useQuery({
    queryKey: ["auditTrail"],
    queryFn: api.getAuditTrail,
  });

  const filtered = useMemo(() => {
    return auditTrail.filter((entry) => {
      if (selectedMonth && monthValue(entry.createdAt) !== selectedMonth) return false;
      if (selectedRole !== "all" && entry.actorRole !== selectedRole) return false;
      if (selectedEntity !== "all" && entry.entityType !== selectedEntity) return false;

      if (search.trim()) {
        const needle = search.trim().toLowerCase();
        const haystack = [
          entry.actorName,
          entry.actorRole,
          entry.action,
          entry.entityType,
          entry.summary,
          entry.details?.entityLabel,
          ...(entry.details?.changedFields ?? []),
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(needle)) return false;
      }

      return true;
    });
  }, [auditTrail, search, selectedEntity, selectedMonth, selectedRole]);

  const groupedByDay = useMemo(() => {
    const groups = new Map<string, AuditTrailEntry[]>();
    for (const entry of filtered) {
      const key = dayValue(entry.createdAt);
      groups.set(key, [...(groups.get(key) ?? []), entry]);
    }
    return [...groups.entries()].sort((left, right) => right[0].localeCompare(left[0]));
  }, [filtered]);

  const totals = useMemo(() => {
    const finance = filtered.filter((entry) => FINANCE_ENTITIES.has(entry.entityType)).length;
    const withDiff = filtered.filter((entry) => Boolean(entry.details?.before || entry.details?.after)).length;
    const withRequest = filtered.filter((entry) => Boolean(entry.requestId || entry.details?.requestId)).length;
    const actors = new Set(filtered.map((entry) => `${entry.actorRole}:${entry.actorName}`)).size;

    return {
      total: filtered.length,
      finance,
      withDiff,
      withRequest,
      actors,
    };
  }, [filtered]);

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <section className="overflow-hidden rounded-[28px] border border-border/50 bg-[radial-gradient(circle_at_top_left,rgba(56,189,248,0.14),transparent_38%),linear-gradient(135deg,rgba(15,23,42,0.96),rgba(15,23,42,0.84))]">
          <div className="grid gap-6 px-6 py-6 lg:grid-cols-[1.3fr_0.9fr] lg:px-8">
            <div className="space-y-4">
              <div className="inline-flex items-center gap-2 rounded-full border border-sky-400/20 bg-sky-400/10 px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-sky-100/80">
                <ShieldCheck className="h-3.5 w-3.5" />
                Audit Intelligence Desk
              </div>
              <div className="space-y-3">
                <h1 className="text-3xl font-semibold tracking-tight text-white">Audit Trail</h1>
                <p className="max-w-2xl text-sm leading-6 text-slate-300">
                  A cleaner operator view of every sensitive workflow touchpoint, grouped by day with real before-and-after context instead of a flat activity dump.
                </p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-4 backdrop-blur-sm">
                  <p className="text-[11px] uppercase tracking-[0.16em] text-slate-400">Events</p>
                  <p className="mt-2 text-2xl font-semibold text-white">{totals.total}</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-4 backdrop-blur-sm">
                  <p className="text-[11px] uppercase tracking-[0.16em] text-slate-400">Finance-critical</p>
                  <p className="mt-2 text-2xl font-semibold text-white">{totals.finance}</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-4 backdrop-blur-sm">
                  <p className="text-[11px] uppercase tracking-[0.16em] text-slate-400">Diff captured</p>
                  <p className="mt-2 text-2xl font-semibold text-white">{totals.withDiff}</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-4 backdrop-blur-sm">
                  <p className="text-[11px] uppercase tracking-[0.16em] text-slate-400">Request-linked</p>
                  <p className="mt-2 text-2xl font-semibold text-white">{totals.withRequest}</p>
                </div>
              </div>
            </div>

            <div className="rounded-[24px] border border-white/10 bg-black/20 p-5 backdrop-blur-md">
              <div className="space-y-4">
                <div>
                  <p className="text-[11px] uppercase tracking-[0.18em] text-slate-400">Current window</p>
                  <p className="mt-2 text-xl font-semibold text-white">{formatMonthLabel(selectedMonth)}</p>
                </div>
                <Separator className="bg-white/10" />
                <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1">
                  <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                    <div className="flex items-center gap-2 text-slate-300">
                      <UserRound className="h-4 w-4" />
                      <span className="text-sm">Distinct actors</span>
                    </div>
                    <p className="mt-2 text-lg font-semibold text-white">{totals.actors}</p>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                    <div className="flex items-center gap-2 text-slate-300">
                      <ArrowLeftRight className="h-4 w-4" />
                      <span className="text-sm">Entity types touched</span>
                    </div>
                    <p className="mt-2 text-lg font-semibold text-white">{new Set(filtered.map((entry) => entry.entityType)).size}</p>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                    <div className="flex items-center gap-2 text-slate-300">
                      <Clock3 className="h-4 w-4" />
                      <span className="text-sm">Latest event</span>
                    </div>
                    <p className="mt-2 text-sm font-medium text-white">
                      {filtered[0] ? formatDistanceToNow(new Date(filtered[0].createdAt), { addSuffix: true }) : "No activity"}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <Card className="border-border/60 bg-card/80">
          <CardContent className="pt-6">
            <div className="grid gap-4 lg:grid-cols-[0.8fr_0.7fr_0.7fr_1fr]">
              <div className="space-y-2">
                <Label className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Month</Label>
                <Input type="month" value={selectedMonth} onChange={(event) => setSelectedMonth(event.target.value)} />
              </div>
              <div className="space-y-2">
                <Label className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Actor role</Label>
                <Select value={selectedRole} onValueChange={(value) => setSelectedRole(value as typeof selectedRole)}>
                  <SelectTrigger>
                    <SelectValue placeholder="All roles" />
                  </SelectTrigger>
                  <SelectContent>
                    {ROLE_OPTIONS.map((role) => (
                      <SelectItem key={role} value={role}>
                        {role === "all" ? "All roles" : labelize(role)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Entity type</Label>
                <Select value={selectedEntity} onValueChange={(value) => setSelectedEntity(value as typeof selectedEntity)}>
                  <SelectTrigger>
                    <SelectValue placeholder="All entities" />
                  </SelectTrigger>
                  <SelectContent>
                    {ENTITY_OPTIONS.map((entity) => (
                      <SelectItem key={entity} value={entity}>
                        {entity === "all" ? "All entities" : labelize(entity)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Search</Label>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    className="pl-9"
                    placeholder="Search actor, entity, field, request..."
                  />
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-6 xl:grid-cols-[0.86fr_1.14fr]">
          <Card className="border-border/60 bg-card/80">
            <CardHeader>
              <CardTitle className="text-base">Review Snapshot</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {[
                { label: "Selected month", value: formatMonthLabel(selectedMonth), icon: Layers3 },
                { label: "Grouped day wrappers", value: String(groupedByDay.length), icon: Clock3 },
                { label: "Finance activity", value: String(totals.finance), icon: ShieldCheck },
                { label: "Entries with details", value: String(totals.withDiff), icon: FileJson },
              ].map((item) => (
                <div key={item.label} className="rounded-2xl border border-border/50 bg-secondary/20 px-4 py-3">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">{item.label}</p>
                      <p className="mt-2 text-lg font-semibold">{item.value}</p>
                    </div>
                    <div className="rounded-xl border border-border/60 bg-background/80 p-2 text-muted-foreground">
                      <item.icon className="h-4 w-4" />
                    </div>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          <div className="space-y-4">
            {groupedByDay.length === 0 ? (
              <Card className="border-border/60 bg-card/80">
                <CardContent className="py-16 text-center text-muted-foreground">
                  No audit events match the current filters.
                </CardContent>
              </Card>
            ) : (
              groupedByDay.map(([day, entries], index) => (
                <Collapsible key={day} defaultOpen={index < 2}>
                  <Card className="overflow-hidden border-border/60 bg-card/80">
                    <CollapsibleTrigger asChild>
                      <button className="flex w-full items-center justify-between gap-4 border-b border-border/50 px-5 py-4 text-left transition-colors hover:bg-secondary/20">
                        <div>
                          <p className="text-sm font-semibold">{format(new Date(day), "EEEE, dd MMMM yyyy")}</p>
                          <p className="mt-1 text-xs text-muted-foreground">{entries.length} events in this wrapper</p>
                        </div>
                        <div className="flex items-center gap-3">
                          <Badge variant="outline" className="border-border/60 bg-background/70">{entries.filter((entry) => FINANCE_ENTITIES.has(entry.entityType)).length} finance</Badge>
                          <ChevronDown className="h-4 w-4 text-muted-foreground" />
                        </div>
                      </button>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <CardContent className="space-y-4 p-5">
                        {entries.map((entry) => (
                          <article key={entry.id} className="rounded-[22px] border border-border/50 bg-[linear-gradient(180deg,rgba(255,255,255,0.02),rgba(255,255,255,0))] p-4">
                            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                              <div className="min-w-0 space-y-3">
                                <div className="flex flex-wrap items-center gap-2">
                                  <Badge variant="outline" className={roleBadgeClass(entry.actorRole)}>{entry.actorRole}</Badge>
                                  <Badge variant="outline" className={entityBadgeClass(entry.entityType)}>{labelize(entry.entityType)}</Badge>
                                  <Badge variant="outline" className="border-border/60 bg-background/70 capitalize">{actionLabel(entry.action)}</Badge>
                                  {entry.details?.entityLabel ? (
                                    <Badge variant="outline" className="border-border/60 bg-background/70">{entry.details.entityLabel}</Badge>
                                  ) : null}
                                </div>
                                <div>
                                  <p className="font-medium">{entry.summary}</p>
                                  <p className="mt-1 text-sm text-muted-foreground">
                                    {entry.actorName} triggered this event {formatDistanceToNow(new Date(entry.createdAt), { addSuffix: true })}.
                                  </p>
                                </div>
                              </div>
                              <div className="grid min-w-[240px] gap-2 sm:grid-cols-2 lg:grid-cols-1">
                                <div className="rounded-xl border border-border/50 bg-background/70 px-3 py-2">
                                  <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Entity ID</p>
                                  <p className="mt-1 break-all text-sm">{entry.entityId}</p>
                                </div>
                                <div className="rounded-xl border border-border/50 bg-background/70 px-3 py-2">
                                  <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Request</p>
                                  <p className="mt-1 break-all text-sm">{entry.requestId ?? entry.details?.requestId ?? "Not linked"}</p>
                                </div>
                              </div>
                            </div>

                            <div className="mt-4 grid gap-4 xl:grid-cols-[0.7fr_1.3fr]">
                              <div className="space-y-3">
                                <div className="rounded-2xl border border-border/50 bg-secondary/20 px-4 py-3">
                                  <div className="flex items-center gap-2 text-sm font-medium">
                                    <Fingerprint className="h-4 w-4 text-muted-foreground" />
                                    Change signal
                                  </div>
                                  <div className="mt-3 flex flex-wrap gap-2">
                                    {(entry.details?.changedFields?.length ? entry.details.changedFields : ["summary"]).map((field) => (
                                      <Badge key={field} variant="secondary" className="bg-background/80 text-foreground/80">
                                        {field}
                                      </Badge>
                                    ))}
                                  </div>
                                </div>
                                {entry.details?.context ? (
                                  <div className="rounded-2xl border border-border/50 bg-secondary/20 px-4 py-3">
                                    <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Context</p>
                                    <div className="mt-3">
                                      {renderKeyValueBlock(entry.details.context)}
                                    </div>
                                  </div>
                                ) : null}
                              </div>

                              <div className="grid gap-4 md:grid-cols-2">
                                <div className="rounded-2xl border border-border/50 bg-secondary/20 p-4">
                                  <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Before</p>
                                  <div className="mt-3">
                                    {renderKeyValueBlock(entry.details?.before)}
                                  </div>
                                </div>
                                <div className="rounded-2xl border border-border/50 bg-secondary/20 p-4">
                                  <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">After</p>
                                  <div className="mt-3">
                                    {renderKeyValueBlock(entry.details?.after)}
                                  </div>
                                </div>
                              </div>
                            </div>
                          </article>
                        ))}
                      </CardContent>
                    </CollapsibleContent>
                  </Card>
                </Collapsible>
              ))
            )}
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
