import { useEffect, useState } from "react";
import { Link } from "wouter";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { api, ExpenseCategory } from "@/lib/api";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Plus, Pencil, Trash2, Building2, Home, Settings as SettingsIcon, WalletCards, ArrowRight, Sheet } from "lucide-react";
import { cn } from "@/lib/utils";

const PRESET_COLORS = [
  "#6366f1",
  "#f59e0b",
  "#10b981",
  "#3b82f6",
  "#ef4444",
  "#8b5cf6",
  "#f97316",
  "#22c55e",
  "#a855f7",
  "#ec4899",
  "#14b8a6",
  "#0ea5e9",
  "#d946ef",
  "#84cc16",
  "#e11d48",
];

interface CategoryFormState {
  name: string;
  color: string;
  group: "personal" | "office";
  editId?: string;
}

interface CompanyFormState {
  companyName: string;
  address: string;
  phone: string;
  email: string;
  website: string;
}

function CategoryCard({
  cat,
  onEdit,
  onDelete,
}: {
  cat: ExpenseCategory;
  onEdit: (cat: ExpenseCategory) => void;
  onDelete: (cat: ExpenseCategory) => void;
}) {
  return (
    <div className="flex items-center gap-3 p-3 rounded-lg border border-border/50 bg-card/40 hover:bg-card/70 transition-colors group">
      <div className="w-8 h-8 rounded-lg flex-shrink-0 shadow-sm" style={{ backgroundColor: cat.color }} />
      <span className="flex-1 text-sm font-medium">{cat.name}</span>
      <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={() => onEdit(cat)}
          className="p-1.5 rounded-md hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
        >
          <Pencil className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => onDelete(cat)}
          className="p-1.5 rounded-md hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

function CategorySection({
  group,
  categories,
  onAdd,
  onEdit,
  onDelete,
}: {
  group: "personal" | "office";
  categories: ExpenseCategory[];
  onAdd: (group: "personal" | "office") => void;
  onEdit: (cat: ExpenseCategory) => void;
  onDelete: (cat: ExpenseCategory) => void;
}) {
  const Icon = group === "office" ? Building2 : Home;
  const label = group === "office" ? "Office" : "Personal";
  const groupCategories = categories.filter((category) => category.group === group);

  return (
    <Card className="border-border/50">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-secondary/50">
              <Icon className="w-4 h-4 text-muted-foreground" />
            </div>
            <CardTitle className="text-base">{label} Categories</CardTitle>
            <span className="text-xs text-muted-foreground bg-secondary/50 px-2 py-0.5 rounded-full">
              {groupCategories.length}
            </span>
          </div>
          <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => onAdd(group)}>
            <Plus className="w-3.5 h-3.5" /> Add
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {groupCategories.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground text-sm">No categories yet. Add one to get started.</div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {groupCategories.map((category) => (
              <CategoryCard key={category.id} cat={category} onEdit={onEdit} onDelete={onDelete} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function Settings() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<CategoryFormState>({
    name: "",
    color: PRESET_COLORS[0],
    group: "office",
  });
  const [companyForm, setCompanyForm] = useState<CompanyFormState>({
    companyName: "",
    address: "",
    phone: "",
    email: "",
    website: "",
  });

  const { data: categories = [] } = useQuery({
    queryKey: ["categories"],
    queryFn: api.getCategories,
  });

  const { data: companyInfo } = useQuery({
    queryKey: ["companySettings"],
    queryFn: api.getCompanySettings,
  });

  useEffect(() => {
    if (!companyInfo) {
      return;
    }

    setCompanyForm({
      companyName: companyInfo.companyName ?? "",
      address: companyInfo.address ?? "",
      phone: companyInfo.phone ?? "",
      email: companyInfo.email ?? "",
      website: companyInfo.website ?? "",
    });
  }, [companyInfo]);

  const [backfillSince, setBackfillSince] = useState("2026-05-01");
  const backfillMutation = useMutation({
    mutationFn: () => api.backfillTimesheetSheets(backfillSince),
    onSuccess: (result) => {
      toast({
        title: "Backfill running in background",
        description: result.message,
      });
    },
    onError: (error) => {
      toast({
        title: "Backfill failed",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    },
  });

  const companyMutation = useMutation({
    mutationFn: api.updateCompanySettings,
    onSuccess: (saved) => {
      queryClient.setQueryData(["companySettings"], saved);
      toast({ title: "Company information saved", description: "This will prefill future pre-approval exports." });
    },
    onError: (error) => {
      toast({
        title: "Could not save company information",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    },
  });

  const saveMutation = useMutation({
    mutationFn: api.saveCategory,
    onSuccess: (_savedCategory, data) => {
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: ["categories"] }),
        queryClient.invalidateQueries({ queryKey: ["expenses"] }),
        queryClient.invalidateQueries({ queryKey: ["transactions"] }),
        queryClient.invalidateQueries({ queryKey: ["expenseCategories"] }),
      ]);
      toast({
        title: data.editId ? "Category updated" : "Category added",
        description: `"${data.name}" has been ${data.editId ? "updated" : "created"}.`,
      });
      setDialogOpen(false);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (category: ExpenseCategory) => {
      await api.deleteCategory(category.id);
      return category;
    },
    onSuccess: (category) => {
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: ["categories"] }),
        queryClient.invalidateQueries({ queryKey: ["expenses"] }),
        queryClient.invalidateQueries({ queryKey: ["transactions"] }),
        queryClient.invalidateQueries({ queryKey: ["expenseCategories"] }),
      ]);
      toast({ title: "Category deleted", description: `"${category.name}" removed.` });
    },
  });

  function openAdd(group: "personal" | "office") {
    setForm({ name: "", color: PRESET_COLORS[0], group });
    setDialogOpen(true);
  }

  function openEdit(category: ExpenseCategory) {
    setForm({
      name: category.name,
      color: category.color,
      group: category.group,
      editId: category.id,
    });
    setDialogOpen(true);
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-secondary/50">
            <SettingsIcon className="w-5 h-5 text-muted-foreground" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
            <p className="text-muted-foreground text-sm mt-0.5">Manage expense categories and application preferences.</p>
          </div>
        </div>

        <div className="space-y-4">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Company Information</h2>
          <Card className="border-border/50">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Pre Approval Export Details</CardTitle>
              <p className="text-sm text-muted-foreground">
                These details prefill the company block in the exported quotation format.
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>Company Name</Label>
                  <Input value={companyForm.companyName} onChange={(event) => setCompanyForm((current) => ({ ...current, companyName: event.target.value }))} />
                </div>
                <div className="space-y-2">
                  <Label>Phone</Label>
                  <Input value={companyForm.phone} onChange={(event) => setCompanyForm((current) => ({ ...current, phone: event.target.value }))} />
                </div>
                <div className="space-y-2">
                  <Label>Email</Label>
                  <Input value={companyForm.email} onChange={(event) => setCompanyForm((current) => ({ ...current, email: event.target.value }))} />
                </div>
                <div className="space-y-2">
                  <Label>Website</Label>
                  <Input value={companyForm.website} onChange={(event) => setCompanyForm((current) => ({ ...current, website: event.target.value }))} />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label>Address</Label>
                  <Input value={companyForm.address} onChange={(event) => setCompanyForm((current) => ({ ...current, address: event.target.value }))} />
                </div>
              </div>
              <div className="flex justify-end">
                <Button onClick={() => companyMutation.mutate(companyForm)} disabled={companyMutation.isPending || !companyForm.companyName.trim()}>
                  {companyMutation.isPending ? "Saving..." : "Save Company Information"}
                </Button>
              </div>
            </CardContent>
          </Card>

          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Operations</h2>
          <Link href="/settings/financial-accounts">
            <button className="w-full rounded-2xl border border-border/50 bg-card/60 p-5 text-left transition-colors hover:bg-card">
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-start gap-3">
                  <div className="rounded-xl bg-secondary/40 p-2.5 text-muted-foreground">
                    <WalletCards className="h-4 w-4" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold">Financial Accounts</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Manage money sources used for expenses, salaries, reimbursements, and operational balances.
                    </p>
                  </div>
                </div>
                <div className="rounded-full border border-border/60 bg-background/70 p-2 text-muted-foreground">
                  <ArrowRight className="h-4 w-4" />
                </div>
              </div>
            </button>
          </Link>

          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Integrations</h2>
          <div className="rounded-2xl border border-border/50 bg-card/60 p-5 space-y-4">
            <div className="flex items-start gap-3">
              <div className="rounded-xl bg-secondary/40 p-2.5 text-muted-foreground">
                <Sheet className="h-4 w-4" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold">Backfill Google Sheets</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Push all verified timesheet days from a start date to Google Sheets. Safe to run multiple times — already-synced days are skipped automatically.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="space-y-1 flex-1">
                <Label htmlFor="backfill-since" className="text-xs text-muted-foreground">Start date (YYYY-MM-DD)</Label>
                <Input
                  id="backfill-since"
                  value={backfillSince}
                  onChange={(e) => setBackfillSince(e.target.value)}
                  placeholder="2026-05-01"
                  className="h-8 text-sm font-mono w-40"
                />
              </div>
              <Button
                variant="outline"
                size="sm"
                className="mt-5"
                disabled={backfillMutation.isPending || !/^\d{4}-\d{2}-\d{2}$/.test(backfillSince)}
                onClick={() => backfillMutation.mutate()}
              >
                {backfillMutation.isPending ? "Syncing…" : "Sync to Sheets"}
              </Button>
            </div>
          </div>

          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Category Manager</h2>
          <CategorySection group="office" categories={categories} onAdd={openAdd} onEdit={openEdit} onDelete={deleteMutation.mutate} />
          <CategorySection group="personal" categories={categories} onAdd={openAdd} onEdit={openEdit} onDelete={deleteMutation.mutate} />
        </div>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {form.editId ? "Edit Category" : "Add Category"} - {form.group === "office" ? "Office" : "Personal"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-1">
            <div className="space-y-1.5">
              <Label>Category Name</Label>
              <Input
                placeholder="e.g. Marketing"
                value={form.name}
                onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
              />
            </div>

            <div className="space-y-2">
              <Label>Color Tag</Label>
              <div className="flex flex-wrap gap-2">
                {PRESET_COLORS.map((color) => (
                  <button
                    key={color}
                    onClick={() => setForm((current) => ({ ...current, color }))}
                    className={cn(
                      "w-7 h-7 rounded-lg transition-all border-2",
                      form.color === color ? "border-foreground scale-110" : "border-transparent hover:scale-105",
                    )}
                    style={{ backgroundColor: color }}
                  />
                ))}
              </div>
              <div className="flex items-center gap-2 mt-1">
                <div className="w-6 h-6 rounded-md border border-border" style={{ backgroundColor: form.color }} />
                <Input
                  type="color"
                  value={form.color}
                  className="w-12 h-7 p-0.5 cursor-pointer border border-border"
                  onChange={(event) => setForm((current) => ({ ...current, color: event.target.value }))}
                />
                <span className="text-xs text-muted-foreground font-mono">{form.color}</span>
              </div>
            </div>

            <Button
              className="w-full"
              disabled={!form.name.trim() || saveMutation.isPending}
              onClick={() => saveMutation.mutate(form)}
            >
              {form.editId ? "Save Changes" : "Add Category"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
