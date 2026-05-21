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
                  <div className="space-y-1">
                    <p className="text-sm font-medium">Include in operational reporting</p>
                    <p className="text-xs text-muted-foreground">
                      Operational balances and the main dashboard card will include this account.
                    </p>
                  </div>
                  <Switch
                    checked={form.includeInOperationalReporting ?? false}
                    onCheckedChange={(checked) => setForm((current) => ({ ...current, includeInOperationalReporting: checked }))}
                  />
                </div>

                <Button
                  className="w-full rounded-xl"
                  disabled={saveMutation.isPending || form.name.trim().length < 2}
                  onClick={handleSubmit}
                >
                  {saveMutation.isPending ? "Saving..." : form.id ? "Save Changes" : "Create Account"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        <Card className="border-border/50">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Accounts</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {orderedAccounts.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-border/60 bg-secondary/10 px-6 py-10 text-center text-sm text-muted-foreground">
                No financial accounts yet. Start with your main operational account.
              </div>
            ) : (
              orderedAccounts.map((account) => (
                <button
                  key={account.id}
                  type="button"
                  onClick={() => openEdit(account)}
                  className="flex w-full items-center justify-between gap-4 rounded-2xl border border-border/60 bg-card/70 px-5 py-4 text-left transition-colors hover:bg-card"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-3">
                      <div className="rounded-xl border border-border/60 bg-secondary/20 p-2 text-muted-foreground">
                        <Landmark className="h-4 w-4" />
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold">{account.name}</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {accountTypeLabel(account.accountType)} • {categoryLabel(account.category)}
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <p className="text-base font-semibold">
                        {(balancesById.get(account.id) ?? account.openingBalance).toLocaleString("en-IN", {
                          style: "currency",
                          currency: "INR",
                        })}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">Live balance</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="rounded-full border-border/60 bg-secondary/15 px-3 py-1 font-normal">
                        {account.isActive ? "Active" : "Inactive"}
                      </Badge>
                      <div className="rounded-full border border-border/60 bg-background/70 p-2 text-muted-foreground">
                        <Pencil className="h-3.5 w-3.5" />
                      </div>
                    </div>
                  </div>
                </button>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
