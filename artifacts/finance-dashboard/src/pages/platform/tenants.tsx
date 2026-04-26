import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  Ban,
  Building2,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ClipboardCopy,
  Copy,
  Plus,
  Search,
  Shield,
  Sparkles,
  Users,
} from "lucide-react";
import { PlatformShell } from "@/layouts/platform-shell";
import { PageHeader } from "@/components/app/page-header";
import { MetricCard } from "@/components/app/metric-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

type TenantStatusFilter = "all" | "active" | "inactive";

const emptyForm = {
  name: "",
  slug: "",
  ownerName: "",
  ownerEmail: "",
  ownerPhone: "",
  ownerPosition: "Administrator",
  ownerDepartment: "Operations",
  ownerPassword: "",
};

function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

function summarizeDate(value: string) {
  return format(new Date(value), "dd MMM, HH:mm");
}

function getTenantCreateErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  if (message.includes("users_email_unique") || message.includes("email already exists")) {
    return "That owner email is already in use. Please use a different email address.";
  }
  if (message.includes("users_tenant_phone_unique") || message.includes("phone already exists")) {
    return "That owner phone is already in use in this workspace. Please use a different phone number.";
  }
  if (message.includes("tenants_slug_unique") || message.includes("slug already exists")) {
    return "That tenant slug is already in use. Please choose another slug.";
  }
  return "Please check the tenant name, slug, owner name, owner email, and owner phone, then try again.";
}

function TenantStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-border/50 bg-card px-3 py-2">
      <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">{label}</p>
      <p className="mt-1 text-sm font-medium text-foreground">{value}</p>
    </div>
  );
}

export default function PlatformTenantsPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [form, setForm] = useState(emptyForm);
  const [handoff, setHandoff] = useState<{
    tenantName: string;
    ownerEmail: string;
    temporaryPassword: string | null;
    passwordWasGenerated: boolean;
  } | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<TenantStatusFilter>("all");
  const [activeOpen, setActiveOpen] = useState(true);
  const [inactiveOpen, setInactiveOpen] = useState(true);

  const { data: tenantsData } = useQuery({
    queryKey: ["platform-tenants"],
    queryFn: api.getPlatformTenants,
  });

  const { data: overview } = useQuery({
    queryKey: ["platform-overview"],
    queryFn: api.getPlatformOverview,
  });

  const tenants = tenantsData ?? [];
  const filteredTenants = useMemo(() => {
    const query = search.trim().toLowerCase();
    return tenants.filter((tenant) => {
      const matchesSearch =
        !query ||
        tenant.name.toLowerCase().includes(query) ||
        tenant.slug.toLowerCase().includes(query) ||
        (tenant.isPlatformTenant ? "platform" : "").includes(query);
      const matchesStatus = statusFilter === "all" ? true : tenant.status === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [search, statusFilter, tenants]);

  const activeTenants = useMemo(() => filteredTenants.filter((tenant) => tenant.status === "active"), [filteredTenants]);
  const inactiveTenants = useMemo(() => filteredTenants.filter((tenant) => tenant.status !== "active"), [filteredTenants]);
  const ownerAccounts = useMemo(() => filteredTenants.reduce((sum, tenant) => sum + tenant.adminCount, 0), [filteredTenants]);
  const slugPreview = useMemo(() => slugify(form.slug || form.name), [form.slug, form.name]);
  const canCreateTenant =
    Boolean(form.name.trim()) &&
    Boolean(slugPreview.trim()) &&
    Boolean(form.ownerName.trim()) &&
    Boolean(form.ownerEmail.trim()) &&
    Boolean(form.ownerPhone.trim());

  const createMutation = useMutation({
    mutationFn: api.createPlatformTenant,
    onSuccess: async (result) => {
      setHandoff({
        tenantName: result.tenant.name,
        ownerEmail: result.owner.email,
        temporaryPassword: result.temporaryPassword,
        passwordWasGenerated: result.passwordWasGenerated,
      });
      toast({ title: "Tenant created", description: `${result.tenant.name} is ready to onboard.` });
      setForm(emptyForm);
      await queryClient.invalidateQueries({ queryKey: ["platform-tenants"] });
      await queryClient.invalidateQueries({ queryKey: ["platform-overview"] });
    },
    onError: (error) => {
      toast({
        title: "Could not create tenant",
        description: getTenantCreateErrorMessage(error),
        variant: "destructive",
      });
    },
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: "active" | "inactive" }) => api.updatePlatformTenantStatus(id, status),
    onSuccess: async () => {
      toast({ title: "Tenant updated" });
      await queryClient.invalidateQueries({ queryKey: ["platform-tenants"] });
      await queryClient.invalidateQueries({ queryKey: ["platform-overview"] });
    },
    onError: (error) => {
      toast({
        title: "Could not update tenant",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    },
  });

  return (
    <PlatformShell>
      <div className="space-y-8">
        <PageHeader
          eyebrow="Tenant onboarding"
          title="Tenants"
          description="Create isolated client workspaces, hand them to owners, and keep the platform registry calm and searchable."
        />

        <div className="grid gap-4 xl:grid-cols-4">
          <MetricCard label="Total Tenants" value={`${overview?.totalTenants ?? tenants.length}`} icon={<Shield className="h-5 w-5" />} />
          <MetricCard label="Active" value={`${overview?.activeTenants ?? activeTenants.length}`} icon={<CheckCircle2 className="h-5 w-5" />} />
          <MetricCard label="Inactive" value={`${overview?.inactiveTenants ?? inactiveTenants.length}`} icon={<Ban className="h-5 w-5" />} />
          <MetricCard label="Owner Accounts" value={`${ownerAccounts}`} icon={<Users className="h-5 w-5" />} />
        </div>

        <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
          <Card className="border-border/50 bg-card">
            <CardHeader className="space-y-3">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <CardTitle className="text-2xl font-semibold tracking-tight">Create tenant</CardTitle>
                  <p className="mt-1 text-sm text-muted-foreground">Create the company, bootstrap the owner, and hand over a ready workspace.</p>
                </div>
                <div className="rounded-2xl border border-border/50 bg-muted/30 px-3 py-2 text-right">
                  <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Platform</p>
                  <p className="mt-1 text-sm font-medium text-foreground">Multi-tenant ready</p>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="tenant-name">Tenant name</Label>
                  <Input id="tenant-name" value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} placeholder="Acme Studio" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="tenant-slug">Slug</Label>
                  <Input id="tenant-slug" value={form.slug} onChange={(event) => setForm((current) => ({ ...current, slug: slugify(event.target.value) }))} placeholder="acme-studio" />
                  <p className="text-xs text-muted-foreground">Preview: {slugPreview || "tenant-slug"}</p>
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="owner-name">Owner name</Label>
                  <Input id="owner-name" value={form.ownerName} onChange={(event) => setForm((current) => ({ ...current, ownerName: event.target.value }))} placeholder="Owner name" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="owner-email">Owner email</Label>
                  <Input id="owner-email" type="email" value={form.ownerEmail} onChange={(event) => setForm((current) => ({ ...current, ownerEmail: event.target.value }))} placeholder="owner@company.com" />
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="owner-phone">Owner phone</Label>
                  <Input id="owner-phone" value={form.ownerPhone} onChange={(event) => setForm((current) => ({ ...current, ownerPhone: event.target.value }))} placeholder="9999999999" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="owner-password">Owner password</Label>
                  <Input
                    id="owner-password"
                    type="password"
                    value={form.ownerPassword}
                    onChange={(event) => setForm((current) => ({ ...current, ownerPassword: event.target.value }))}
                    placeholder="Optional, auto-generate if empty"
                  />
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="owner-position">Owner position</Label>
                  <Input id="owner-position" value={form.ownerPosition} onChange={(event) => setForm((current) => ({ ...current, ownerPosition: event.target.value }))} placeholder="Administrator" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="owner-department">Owner department</Label>
                  <Input id="owner-department" value={form.ownerDepartment} onChange={(event) => setForm((current) => ({ ...current, ownerDepartment: event.target.value }))} placeholder="Operations" />
                </div>
              </div>

              <div className="flex flex-col gap-3 sm:flex-row">
                <Button
                  className="min-w-40"
                  disabled={createMutation.isPending || !canCreateTenant}
                  onClick={() =>
                    createMutation.mutate({
                      name: form.name,
                      slug: slugPreview,
                      ownerName: form.ownerName,
                      ownerEmail: form.ownerEmail,
                      ownerPhone: form.ownerPhone,
                      ownerPosition: form.ownerPosition,
                      ownerDepartment: form.ownerDepartment,
                      ownerPassword: form.ownerPassword || undefined,
                    })
                  }
                >
                  <Plus className="mr-2 h-4 w-4" />
                  {createMutation.isPending ? "Creating..." : "Create tenant"}
                </Button>
                <div className="rounded-2xl border border-border/50 bg-muted/20 px-4 py-3 text-sm text-muted-foreground">
                  The owner account is created inside the new tenant and gets a temporary password if you leave the password field blank. Owner phone is required.
                </div>
              </div>

              {handoff ? (
                <div className="rounded-3xl border border-border/50 bg-muted/20 p-4 text-sm text-foreground">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Handoff summary</p>
                      <p className="mt-2 text-sm text-foreground">{handoff.tenantName} is ready for {handoff.ownerEmail}.</p>
                      {handoff.passwordWasGenerated && handoff.temporaryPassword ? (
                        <code className="mt-2 block rounded-xl border border-border/50 bg-background/60 px-3 py-2 font-mono text-sm text-foreground">
                          {handoff.temporaryPassword}
                        </code>
                      ) : (
                        <p className="mt-2 text-sm text-muted-foreground">
                          The owner password was supplied manually, so it is not echoed back by the platform.
                        </p>
                      )}
                    </div>
                    {handoff.temporaryPassword ? (
                      <button
                        className="inline-flex items-center gap-2 rounded-xl border border-border/50 bg-background/60 px-3 py-2 text-xs font-medium text-foreground transition hover:bg-muted/40"
                        onClick={async () => await navigator.clipboard.writeText(handoff.temporaryPassword ?? "")}
                      >
                        <ClipboardCopy className="h-3.5 w-3.5" />
                        Copy
                      </button>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </CardContent>
          </Card>

          <div className="space-y-6">
            <Card className="border-border/50 bg-card">
              <CardHeader>
                <CardTitle className="text-2xl font-semibold tracking-tight">Launch checklist</CardTitle>
                <p className="text-sm text-muted-foreground">A quiet reminder of the fields that matter before the tenant goes live.</p>
              </CardHeader>
              <CardContent className="grid gap-3">
                {[
                  "Confirm company name and slug.",
                  "Create the owner/admin account.",
                  "Hand over the temporary password.",
                  "Suspend or restore the tenant only from this console.",
                ].map((item, index) => (
                  <div key={item} className="flex items-start gap-3 rounded-2xl border border-border/50 bg-muted/20 p-4">
                    <div className="mt-0.5 flex h-6 w-6 items-center justify-center rounded-full border border-border/50 bg-background/60 text-xs font-semibold text-foreground">
                      {index + 1}
                    </div>
                    <p className="text-sm text-muted-foreground">{item}</p>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card className="border-border/50 bg-card">
              <CardHeader className="space-y-3">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <CardTitle className="text-2xl font-semibold tracking-tight">Registry filters</CardTitle>
                    <p className="mt-1 text-sm text-muted-foreground">Search by tenant name or slug, then switch between active and inactive workspaces.</p>
                  </div>
                  <div className="rounded-2xl border border-border/50 bg-muted/30 px-3 py-2 text-right">
                    <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Visible tenants</p>
                    <p className="mt-1 text-lg font-medium text-foreground">{filteredTenants.length}</p>
                  </div>
                </div>

                <div className="grid gap-3 md:grid-cols-[1fr_auto]">
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search tenants" className="pl-9" />
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {(["all", "active", "inactive"] as TenantStatusFilter[]).map((value) => (
                      <Button
                        key={value}
                        size="sm"
                        variant={statusFilter === value ? "default" : "outline"}
                        className={statusFilter === value ? "" : "border-border/50 bg-card"}
                        onClick={() => setStatusFilter(value)}
                      >
                        {value === "all" ? "All" : value === "active" ? "Active" : "Inactive"}
                      </Button>
                    ))}
                  </div>
                </div>
              </CardHeader>
            </Card>
          </div>
        </div>

        <div className="grid gap-6 xl:grid-cols-2">
          <TenantGroup
            title="Active tenants"
            description="Workspaces that are live and ready for daily operations."
            count={activeTenants.length}
            open={activeOpen}
            onToggle={() => setActiveOpen((current) => !current)}
            tenants={activeTenants}
            onToggleStatus={(id, status) => toggleMutation.mutate({ id, status })}
            processing={toggleMutation.isPending}
          />

          <TenantGroup
            title="Inactive tenants"
            description="Paused workspaces that can be restored from here without touching tenant data."
            count={inactiveTenants.length}
            open={inactiveOpen}
            onToggle={() => setInactiveOpen((current) => !current)}
            tenants={inactiveTenants}
            onToggleStatus={(id, status) => toggleMutation.mutate({ id, status })}
            processing={toggleMutation.isPending}
          />
        </div>
      </div>
    </PlatformShell>
  );
}

function TenantGroup({
  title,
  description,
  count,
  open,
  onToggle,
  tenants,
  onToggleStatus,
  processing,
}: {
  title: string;
  description: string;
  count: number;
  open: boolean;
  onToggle: () => void;
  tenants: Array<{
    id: string;
    name: string;
    slug: string;
    status: "active" | "inactive";
    createdAt: string;
    updatedAt: string;
    userCount: number;
    adminCount: number;
    employeeCount: number;
    clientCount: number;
    platformAdminCount: number;
    lastActivityAt: string;
    isPlatformTenant?: boolean;
  }>;
  onToggleStatus: (tenantId: string, status: "active" | "inactive") => void;
  processing: boolean;
}) {
  return (
    <Card className="border-border/50 bg-card">
      <CardHeader className="space-y-4">
        <button type="button" onClick={onToggle} className="flex w-full items-start justify-between gap-4 text-left">
          <div>
            <CardTitle className="text-2xl font-semibold tracking-tight">{title}</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">{description}</p>
          </div>
          <div className="flex items-center gap-3">
            <Badge variant="outline" className="border-border/50 bg-muted/20 text-muted-foreground">
              {count}
            </Badge>
            {open ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
          </div>
        </button>
      </CardHeader>

      {open ? (
        <CardContent className="space-y-4">
          {tenants.length ? (
            tenants.map((tenant) => (
              <div key={tenant.id} className="rounded-3xl border border-border/50 bg-muted/20 p-4">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-base font-semibold text-foreground">{tenant.name}</h3>
                      <Badge
                        variant="outline"
                        className={
                          tenant.status === "active"
                            ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-200"
                            : "border-border/50 bg-muted/20 text-muted-foreground"
                        }
                      >
                        {tenant.status}
                      </Badge>
                      {tenant.isPlatformTenant ? (
                        <Badge variant="outline" className="border-border/50 bg-muted/20 text-foreground">
                          protected
                        </Badge>
                      ) : null}
                    </div>

                    <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                      <span className="rounded-full border border-border/50 bg-background/60 px-3 py-1">{tenant.slug}</span>
                      <span className="rounded-full border border-border/50 bg-background/60 px-3 py-1">
                        Created {format(new Date(tenant.createdAt), "dd MMM yyyy")}
                      </span>
                      <span className="rounded-full border border-border/50 bg-background/60 px-3 py-1">
                        Updated {format(new Date(tenant.updatedAt), "dd MMM yyyy")}
                      </span>
                    </div>

                    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                      <TenantStat label="Users" value={`${tenant.userCount}`} />
                      <TenantStat label="Admins" value={`${tenant.adminCount}`} />
                      <TenantStat label="Employees" value={`${tenant.employeeCount}`} />
                      <TenantStat label="Clients" value={`${tenant.clientCount}`} />
                    </div>

                    <p className="text-sm text-muted-foreground">
                      Last activity {tenant.lastActivityAt ? summarizeDate(tenant.lastActivityAt) : "No activity recorded yet"}.
                    </p>
                  </div>

                  <div className="flex items-center gap-3 lg:flex-col lg:items-end">
                    <div className="rounded-2xl border border-border/50 bg-background/60 px-3 py-2 text-right">
                      <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Owner accounts</p>
                      <p className="mt-1 text-lg font-medium text-foreground">{tenant.adminCount}</p>
                    </div>
                    {tenant.isPlatformTenant ? (
                      <span className="rounded-xl border border-border/50 bg-muted/30 px-3 py-2 text-xs font-medium text-foreground">
                        Protected workspace
                      </span>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        className={cn(
                          "border-border/50 bg-card",
                          tenant.status === "active"
                            ? "text-rose-200 hover:border-rose-400/20 hover:bg-rose-400/10 hover:text-rose-100"
                            : "text-emerald-200 hover:border-emerald-400/20 hover:bg-emerald-400/10 hover:text-emerald-100",
                        )}
                        onClick={() => onToggleStatus(tenant.id, tenant.status === "active" ? "inactive" : "active")}
                        disabled={processing}
                      >
                        {tenant.status === "active" ? "Disable" : "Enable"}
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            ))
          ) : (
            <div className="rounded-3xl border border-dashed border-border/50 bg-muted/20 px-4 py-8 text-sm text-muted-foreground">
              No tenants match this section right now.
            </div>
          )}
        </CardContent>
      ) : null}
    </Card>
  );
}
