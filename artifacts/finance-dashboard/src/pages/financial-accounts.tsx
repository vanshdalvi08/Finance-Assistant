import { useMemo, useState } from "react";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { api, type FinancialAccount, type SaveFinancialAccountInput } from "@/lib/api";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Landmark, Pencil, Plus, WalletCards } from "lucide-react";

const ACCOUNT_TYPE_OPTIONS = [
  { value: "operational", label: "Operational" },
  { value: "personal", label: "Personal" },
  { value: "mixed_use", label: "Mixed Use" },
  { value: "reserve", label: "Reserve" },
  { value: "cash", label: "Cash" },
] as const;

const CATEGORY_OPTIONS = [
  { value: "bank", label: "Bank" },
  { value: "cash", label: "Cash" },
  { value: "wallet", label: "Wallet" },
  { value: "other", label: "Other" },
] as const;

function accountTypeLabel(value: FinancialAccount["accountType"]) {
  return ACCOUNT_TYPE_OPTIONS.find((option) => option.value === value)?.label ?? "Operational";
}

function categoryLabel(value: FinancialAccount["category"]) {
  return CATEGORY_OPTIONS.find((option) => option.value === value)?.label ?? "Bank";
}

function emptyForm(): SaveFinancialAccountInput {
  return {
    name: "",
    accountType: "operational",
    category: "bank",
    openingBalance: 0,
    description: "",
    includeInOperationalReporting: true,
    isActive: true,
  };
}

export default function FinancialAccountsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<SaveFinancialAccountInput>(emptyForm);

  const { data: accounts = [] } = useQuery({
    queryKey: ["financialAccounts"],
    queryFn: api.getFinancialAccounts,
  });
  const { data: overview } = useQuery({
    queryKey: ["adminOverview"],
    queryFn: api.getAdminOverview,
  });

  const balancesById = useMemo(
    () => new Map((overview?.financialAccounts ?? []).map((account) => [account.id, account.balance])),
    [overview?.financialAccounts],
  );

  const saveMutation = useMutation({
    mutationFn: api.saveFinancialAccount,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["financialAccounts"] }),
        queryClient.invalidateQueries({ queryKey: ["adminOverview"] }),
        queryClient.invalidateQueries({ queryKey: ["transactions"] }),
        queryClient.invalidateQueries({ queryKey: ["funds"] }),
      ]);
      toast({
        title: form.id ? "Financial account updated" : "Financial account created",
        description: "Account balances and selectors are now using the latest configuration.",
      });
      setDialogOpen(false);
      setForm(emptyForm());
    },
    onError: (error) => {
      toast({
        title: "Could not save financial account",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    },
  });

  function openCreate() {
    setForm(emptyForm());
    setDialogOpen(true);
  }

  function openEdit(account: FinancialAccount) {
    setForm({
      id: account.id,
      name: account.name,
      accountType: account.accountType,
      category: account.category,
      openingBalance: account.openingBalance,
      description: account.description ?? "",
      includeInOperationalReporting: account.includeInOperationalReporting,
      isActive: account.isActive,
    });
    setDialogOpen(true);
  }

  function handleSubmit() {
    saveMutation.mutate({
      ...form,
      name: form.name.trim(),
      description: form.description?.trim() || undefined,
      openingBalance: Number(form.openingBalance ?? 0),
    });
  }

  const orderedAccounts = [...accounts].sort((left, right) => {
    if (left.isActive !== right.isActive) {
      return left.isActive ? -1 : 1;
    }

    return left.name.localeCompare(right.name);
  });

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-secondary/20 px-3 py-1 text-xs font-medium text-muted-foreground">
              <WalletCards className="h-3.5 w-3.5" />
              Settings
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Financial Accounts</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Manage operational money sources used for salaries, expenses, reimbursements, and company spending.
              </p>
            </div>
          </div>

          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button onClick={openCreate} className="rounded-xl">
                <Plus className="mr-2 h-4 w-4" />
                Add Account
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-lg">
              <DialogHeader>
                <DialogTitle>{form.id ? "Edit Financial Account" : "Add Financial Account"}</DialogTitle>
              </DialogHeader>

              <div className="space-y-4 pt-2">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2 sm:col-span-2">
                    <Label>Account Name</Label>
                    <Input
                      value={form.name}
                      onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                      placeholder="Company Current"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>Account Type</Label>
                    <Select
                      value={form.accountType}
                      onValueChange={(value) =>
                        setForm((current) => ({
                          ...current,
                          accountType: value as SaveFinancialAccountInput["accountType"],
                          includeInOperationalReporting:
                            current.includeInOperationalReporting ?? value === "operational",
                        }))
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select type" />
                      </SelectTrigger>
                      <SelectContent>
                        {ACCOUNT_TYPE_OPTIONS.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label>Category</Label>
                    <Select
                      value={form.category}
                      onValueChange={(value) =>
                        setForm((current) => ({ ...current, category: value as SaveFinancialAccountInput["category"] }))
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select category" />
                      </SelectTrigger>
                      <SelectContent>
                        {CATEGORY_OPTIONS.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label>Opening Balance</Label>
                    <Input
                      type="number"
                      min={0}
                      value={form.openingBalance}
                      onChange={(event) =>
                        setForm((current) => ({ ...current, openingBalance: Number(event.target.value || 0) }))
                      }
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>Status</Label>
                    <Select
                      value={form.isActive === false ? "inactive" : "active"}
                      onValueChange={(value) => setForm((current) => ({ ...current, isActive: value === "active" }))}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="active">Active</SelectItem>
                        <SelectItem value="inactive">Inactive</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2 sm:col-span-2">
                    <Label>Description</Label>
                    <Textarea
                      rows={3}
                      className="resize-none"
                      placeholder="Optional context for admins using this account."
                      value={form.description ?? ""}
                      onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
                    />
                  </div>
                </div>

                <div className="flex items-center justify-between rounded-2xl border border-border/60 bg-secondary/15 px-4 py-3">
                  <div>
                    <p className="text-sm font-medium">Include in operational balance</p>
                    <p className="text-xs text-muted-foreground">
                      Show this account in the operational cash view used by dashboards and reporting.
                    </p>
                  </div>
                  <Switch
                    checked={form.includeInOperationalReporting}
                    onCheckedChange={(checked) =>
                      setForm((current) => ({ ...current, includeInOperationalReporting: checked }))
                    }
                  />
                </div>

                <Button className="w-full" onClick={handleSubmit} disabled={!form.name.trim() || saveMutation.isPending}>
                  {saveMutation.isPending ? "Saving..." : "Save Account"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Card className="border-border/50">
            <CardContent className="p-5">
              <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Active Accounts</p>
              <div className="mt-2 flex items-end justify-between gap-3">
                <div>
                  <p className="text-2xl font-bold">{orderedAccounts.filter((account) => account.isActive).length}</p>
                  <p className="mt-1 text-sm text-muted-foreground">Currently usable in transactions</p>
                </div>
                <Landmark className="h-5 w-5 text-muted-foreground" />
              </div>
            </CardContent>
          </Card>
          <Card className="border-border/50">
            <CardContent className="p-5">
              <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Total Balance</p>
              <div className="mt-2 flex items-end justify-between gap-3">
                <div>
                  <p className="text-2xl font-bold">
                    {(overview?.allAccountsBalance ?? 0).toLocaleString("en-IN", { style: "currency", currency: "INR" })}
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">Across all accounts</p>
                </div>
                <Landmark className="h-5 w-5 text-muted-foreground" />
              </div>
            </CardContent>
          </Card>
          <Card className="border-border/50">
            <CardContent className="p-5">
              <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Operational Balance</p>
              <div className="mt-2 flex items-end justify-between gap-3">
                <div>
                  <p className="text-2xl font-bold">
                    {(overview?.operationalBalance ?? 0).toLocaleString("en-IN", { style: "currency", currency: "INR" })}
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">Used for cash planning</p>
                </div>
                <Landmark className="h-5 w-5 text-muted-foreground" />
              </div>
            </CardContent>
          </Card>
          <Card className="border-border/50">
            <CardContent className="p-5">
              <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Inactive Accounts</p>
              <div className="mt-2 flex items-end justify-between gap-3">
                <div>
                  <p className="text-2xl font-bold">{orderedAccounts.filter((account) => !account.isActive).length}</p>
                  <p className="mt-1 text-sm text-muted-foreground">Kept for history only</p>
                </div>
                <Landmark className="h-5 w-5 text-muted-foreground" />
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          {orderedAccounts.map((account) => (
            <Card key={account.id} className="border-border/50">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <CardTitle className="text-base">{account.name}</CardTitle>
                      <Badge variant={account.isActive ? "secondary" : "outline"}>{account.isActive ? "Active" : "Inactive"}</Badge>
                      <Badge variant="outline">{accountTypeLabel(account.accountType)}</Badge>
                      <Badge variant="outline">{categoryLabel(account.category)}</Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">{account.description ?? "No description added."}</p>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => openEdit(account)}>
                    <Pencil className="mr-2 h-4 w-4" />
                    Edit
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-wrap items-end gap-4">
                  <div>
                    <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Opening Balance</p>
                    <p className="mt-1 text-lg font-semibold">
                      {account.openingBalance.toLocaleString("en-IN", { style: "currency", currency: "INR" })}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Current Balance</p>
                    <p className="mt-1 text-lg font-semibold">
                      {(balancesById.get(account.id) ?? 0).toLocaleString("en-IN", { style: "currency", currency: "INR" })}
                    </p>
                  </div>
                  <Badge variant={account.includeInOperationalReporting ? "default" : "secondary"}>
                    {account.includeInOperationalReporting ? "In operational view" : "Hidden from operational view"}
                  </Badge>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </DashboardLayout>
  );
}
