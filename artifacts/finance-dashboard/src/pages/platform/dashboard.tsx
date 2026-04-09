import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { Activity, AlertTriangle, Building2, Shield, Users, Waves } from "lucide-react";
import { PlatformShell } from "@/layouts/platform-shell";
import { PageHeader } from "@/components/app/page-header";
import { MetricCard } from "@/components/app/metric-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api } from "@/lib/api";

export default function PlatformDashboardPage() {
  const { data: overview } = useQuery({
    queryKey: ["platform-overview"],
    queryFn: api.getPlatformOverview,
  });

  const tenants = overview?.tenants ?? [];
  const events = overview?.recentEvents ?? [];

  return (
    <PlatformShell>
      <div className="space-y-8">
        <PageHeader
          eyebrow="Platform command center"
          title="Super admin dashboard"
          description="Watch tenants, control access, and stay ahead of issues with a clean operator-first console."
        />

        <div className="grid gap-4 xl:grid-cols-5">
          <MetricCard label="Tenants" value={`${overview?.totalTenants ?? 0}`} icon={<Building2 className="h-5 w-5" />} />
          <MetricCard label="Active Tenants" value={`${overview?.activeTenants ?? 0}`} icon={<Shield className="h-5 w-5" />} />
          <MetricCard label="Platform Users" value={`${overview?.platformAdmins ?? 0}`} icon={<Users className="h-5 w-5" />} />
          <MetricCard label="Errors" value={`${overview?.errorCount ?? 0}`} icon={<AlertTriangle className="h-5 w-5" />} />
          <MetricCard label="Slow Requests" value={`${overview?.slowRequestCount ?? 0}`} icon={<Activity className="h-5 w-5" />} />
        </div>

        <div className="grid gap-6 xl:grid-cols-[1.55fr_1fr]">
          <Card className="border-white/8 bg-white/[0.03]">
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <div>
                <CardTitle className="font-serif text-2xl">Tenant registry</CardTitle>
                <p className="mt-1 text-sm text-muted-foreground">Recent tenants and ownership split.</p>
              </div>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow className="border-white/5">
                    <TableHead>Name</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Users</TableHead>
                    <TableHead className="text-right">Admins</TableHead>
                    <TableHead className="text-right">Last Activity</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tenants.slice(0, 8).map((tenant) => (
                    <TableRow key={tenant.id} className="border-white/5">
                      <TableCell>
                        <div className="space-y-1">
                          <p className="font-medium text-foreground">{tenant.name}</p>
                          <p className="text-xs text-muted-foreground">{tenant.slug}</p>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={
                            tenant.status === "active"
                              ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-200"
                              : "border-white/10 bg-white/5 text-muted-foreground"
                          }
                        >
                          {tenant.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">{tenant.userCount}</TableCell>
                      <TableCell className="text-right">{tenant.adminCount}</TableCell>
                      <TableCell className="text-right text-muted-foreground">
                        {tenant.lastActivityAt ? format(new Date(tenant.lastActivityAt), "dd MMM, HH:mm") : "No activity"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card className="border-white/8 bg-white/[0.03]">
            <CardHeader>
              <CardTitle className="font-serif text-2xl">System pulse</CardTitle>
              <p className="text-sm text-muted-foreground">Events recorded by the runtime monitor.</p>
            </CardHeader>
            <CardContent className="space-y-3">
              {events.slice(0, 6).map((event) => (
                <div key={event.id} className="rounded-2xl border border-white/8 bg-black/20 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
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
                      <p className="mt-2 font-medium text-foreground">{event.title}</p>
                      <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{event.message}</p>
                    </div>
                    <div className="text-right text-xs text-muted-foreground">
                      <p>{format(new Date(event.createdAt), "dd MMM")}</p>
                      <p className="mt-1">{format(new Date(event.createdAt), "HH:mm")}</p>
                    </div>
                  </div>
                  {event.path ? <p className="mt-3 text-xs text-muted-foreground">{event.method ?? "GET"} {event.path}</p> : null}
                </div>
              ))}
              {!events.length ? <p className="py-6 text-sm text-muted-foreground">No monitoring events yet.</p> : null}
            </CardContent>
          </Card>
        </div>
      </div>
    </PlatformShell>
  );
}
