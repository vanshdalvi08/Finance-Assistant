import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { DashboardCard } from "@/components/dashboard-card";
import { api, type AuditTrailEntry } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Search, ShieldCheck, Clock3, UserRound, Layers3 } from "lucide-react";

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
] as const;

const ROLE_OPTIONS = ["all", "admin", "employee", "system"] as const;

function monthValue(date: string) {
  return date.slice(0, 7);
}

function formatMonthLabel(value: string) {
  const [year, month] = value.split("-");
  if (!year || !month) {
    return "All months";
  }

  return format(new Date(Number(year), Number(month) - 1, 1), "MMMM yyyy");
}

function roleBadgeClass(role: AuditTrailEntry["actorRole"]) {
  if (role === "admin") return "border-sky-500/20 bg-sky-500/10 text-sky-300";
  if (role === "employee") return "border-emerald-500/20 bg-emerald-500/10 text-emerald-300";
  return "border-border/60 bg-secondary/50 text-muted-foreground";
}

function entityBadgeClass(entity: AuditTrailEntry["entityType"]) {
  if (entity.includes("purchase-order")) return "border-amber-500/20 bg-amber-500/10 text-amber-300";
  if (entity === "timesheet") return "border-emerald-500/20 bg-emerald-500/10 text-emerald-300";
  if (entity === "salary") return "border-violet-500/20 bg-violet-500/10 text-violet-300";
  if (entity === "expense") return "border-rose-500/20 bg-rose-500/10 text-rose-300";
  return "border-border/60 bg-secondary/50 text-muted-foreground";
}

function actionLabel(action: string) {
  return action.replace(/_/g, " ");
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
      if (selectedMonth && monthValue(entry.createdAt) !== selectedMonth) {
        return false;
      }

      if (selectedRole !== "all" && entry.actorRole !== selectedRole) {
        return false;
      }

      if (selectedEntity !== "all" && entry.entityType !== selectedEntity) {
        return false;
      }

      if (search.trim()) {
        const needle = search.trim().toLowerCase();
        const haystack = [
          entry.actorName,
          entry.actorRole,
          entry.action,
          entry.entityType,
          entry.summary,
        ]
          .join(" ")
          .toLowerCase();

        if (!haystack.includes(needle)) {
          return false;
        }
      }

      return true;
    });
  }, [auditTrail, search, selectedEntity, selectedMonth, selectedRole]);

  const totals = useMemo(() => {
    const byRole = {
      admin: filtered.filter((entry) => entry.actorRole === "admin").length,
      employee: filtered.filter((entry) => entry.actorRole === "employee").length,
      system: filtered.filter((entry) => entry.actorRole === "system").length,
    };

    const entitiesTouched = new Set(filtered.map((entry) => entry.entityType));

    return {
      total: filtered.length,
      byRole,
      entitiesTouched: entitiesTouched.size,
    };
  }, [filtered]);

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-bold tracking-tight">Audit Trail</h1>
          <p className="text-sm text-muted-foreground">
            A simple monthly record of who changed what, when it happened, and what entity was affected.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
          <DashboardCard label="Events" value={String(totals.total)} icon={<ShieldCheck className="h-5 w-5" />} />
          <DashboardCard label="Admin Actions" value={String(totals.byRole.admin)} icon={<UserRound className="h-5 w-5" />} />
          <DashboardCard label="Employee Actions" value={String(totals.byRole.employee)} icon={<Clock3 className="h-5 w-5" />} />
          <DashboardCard label="Entities Touched" value={String(totals.entitiesTouched)} icon={<Layers3 className="h-5 w-5" />} />
        </div>

        <Card className="border-border/50">
          <CardContent className="pt-5">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-[1fr_1fr_1fr_1fr]">
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Month</Label>
                <Input type="month" value={selectedMonth} onChange={(event) => setSelectedMonth(event.target.value)} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Actor role</Label>
                <Select value={selectedRole} onValueChange={(value) => setSelectedRole(value as typeof selectedRole)}>
                  <SelectTrigger>
                    <SelectValue placeholder="All roles" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All roles</SelectItem>
                    <SelectItem value="admin">Admin</SelectItem>
                    <SelectItem value="employee">Employee</SelectItem>
                    <SelectItem value="system">System</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Entity type</Label>
                <Select value={selectedEntity} onValueChange={(value) => setSelectedEntity(value as typeof selectedEntity)}>
                  <SelectTrigger>
                    <SelectValue placeholder="All entities" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All entities</SelectItem>
                    {ENTITY_OPTIONS.filter((item) => item !== "all").map((item) => (
                      <SelectItem key={item} value={item}>
                        {item.replace(/-/g, " ")}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Search</Label>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    className="pl-9"
                    placeholder="Search change text..."
                  />
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
          <Card className="border-border/50">
            <CardHeader>
              <CardTitle className="text-base">Month Snapshot</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="rounded-xl border border-border/50 bg-secondary/10 px-4 py-3">
                <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Selected Month</p>
                <p className="mt-1 text-lg font-semibold">{formatMonthLabel(selectedMonth)}</p>
              </div>
              <div className="flex items-center justify-between rounded-xl border border-border/50 bg-secondary/10 px-4 py-3">
                <span className="text-sm text-muted-foreground">Events</span>
                <span className="font-medium">{totals.total}</span>
              </div>
              <div className="flex items-center justify-between rounded-xl border border-border/50 bg-secondary/10 px-4 py-3">
                <span className="text-sm text-muted-foreground">Admin actions</span>
                <span className="font-medium">{totals.byRole.admin}</span>
              </div>
              <div className="flex items-center justify-between rounded-xl border border-border/50 bg-secondary/10 px-4 py-3">
                <span className="text-sm text-muted-foreground">Employee actions</span>
                <span className="font-medium">{totals.byRole.employee}</span>
              </div>
              <div className="flex items-center justify-between rounded-xl border border-border/50 bg-secondary/10 px-4 py-3">
                <span className="text-sm text-muted-foreground">System actions</span>
                <span className="font-medium">{totals.byRole.system}</span>
              </div>
            </CardContent>
          </Card>

          <Card className="border-border/50">
            <CardHeader>
              <CardTitle className="text-base">Audit Events</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow className="border-border/50">
                    <TableHead>Who</TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead>Entity</TableHead>
                    <TableHead>When</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.length === 0 ? (
                    <TableRow className="border-border/50">
                      <TableCell colSpan={4} className="py-10 text-center text-muted-foreground">
                        No audit events match the current filters.
                      </TableCell>
                    </TableRow>
                  ) : (
                    filtered.map((entry) => (
                      <TableRow key={entry.id} className="border-border/50 align-top">
                        <TableCell className="min-w-0">
                          <div className="space-y-1">
                            <p className="font-medium">{entry.actorName}</p>
                            <Badge variant="outline" className={roleBadgeClass(entry.actorRole)}>
                              {entry.actorRole}
                            </Badge>
                          </div>
                        </TableCell>
                        <TableCell className="min-w-0">
                          <div className="space-y-1">
                            <p className="font-medium capitalize">{actionLabel(entry.action)}</p>
                            <p className="text-sm text-muted-foreground">{entry.summary}</p>
                          </div>
                        </TableCell>
                        <TableCell className="min-w-0">
                          <div className="space-y-1">
                            <Badge variant="outline" className={entityBadgeClass(entry.entityType)}>
                              {entry.entityType.replace(/-/g, " ")}
                            </Badge>
                            <p className="text-xs text-muted-foreground">ID: {entry.entityId}</p>
                          </div>
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                          {format(new Date(entry.createdAt), "dd MMM yyyy")}
                          <br />
                          {format(new Date(entry.createdAt), "HH:mm")}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      </div>
    </DashboardLayout>
  );
}
