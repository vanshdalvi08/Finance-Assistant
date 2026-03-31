import { useState } from "react";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { api, ExpenseCategory } from "@/lib/api";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Plus, Pencil, Trash2, Building2, Home, Settings as SettingsIcon } from "lucide-react";
import { cn } from "@/lib/utils";

const PRESET_COLORS = [
  "#6366f1", "#f59e0b", "#10b981", "#3b82f6", "#ef4444",
  "#8b5cf6", "#f97316", "#22c55e", "#a855f7", "#ec4899",
  "#14b8a6", "#0ea5e9", "#d946ef", "#84cc16", "#e11d48",
];

interface CategoryFormState {
  name: string;
  color: string;
  group: "personal" | "office";
  editId?: string;
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
      <div
        className="w-8 h-8 rounded-lg flex-shrink-0 shadow-sm"
        style={{ backgroundColor: cat.color }}
      />
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
  const cats = categories.filter((c) => c.group === group);

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
              {cats.length}
            </span>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs gap-1"
            onClick={() => onAdd(group)}
          >
            <Plus className="w-3.5 h-3.5" /> Add
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {cats.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground text-sm">
            No categories yet. Add one to get started.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {cats.map((cat) => (
              <CategoryCard
                key={cat.id}
                cat={cat}
                onEdit={onEdit}
                onDelete={onDelete}
              />
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

  const { data: categories = [] } = useQuery({
    queryKey: ["categories"],
    queryFn: api.getCategories,
  });

  const saveMutation = useMutation({
    mutationFn: async (data: CategoryFormState) => data,
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["categories"] });
      toast({
        title: data.editId ? "Category updated" : "Category added",
        description: `"${data.name}" has been ${data.editId ? "updated" : "created"}.`,
      });
      setDialogOpen(false);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (cat: ExpenseCategory) => cat,
    onSuccess: (cat) => {
      queryClient.invalidateQueries({ queryKey: ["categories"] });
      toast({ title: "Category deleted", description: `"${cat.name}" removed.` });
    },
  });

  function openAdd(group: "personal" | "office") {
    setForm({ name: "", color: PRESET_COLORS[0], group });
    setDialogOpen(true);
  }

  function openEdit(cat: ExpenseCategory) {
    setForm({ name: cat.name, color: cat.color, group: cat.group, editId: cat.id });
    setDialogOpen(true);
  }

  function handleDelete(cat: ExpenseCategory) {
    deleteMutation.mutate(cat);
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
            <p className="text-muted-foreground text-sm mt-0.5">
              Manage expense categories and application preferences.
            </p>
          </div>
        </div>

        <div className="space-y-4">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
            Category Manager
          </h2>
          <CategorySection
            group="office"
            categories={categories}
            onAdd={openAdd}
            onEdit={openEdit}
            onDelete={handleDelete}
          />
          <CategorySection
            group="personal"
            categories={categories}
            onAdd={openAdd}
            onEdit={openEdit}
            onDelete={handleDelete}
          />
        </div>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {form.editId ? "Edit Category" : "Add Category"} —{" "}
              {form.group === "office" ? "Office" : "Personal"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-1">
            <div className="space-y-1.5">
              <Label>Category Name</Label>
              <Input
                placeholder="e.g. Marketing"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              />
            </div>

            <div className="space-y-2">
              <Label>Color Tag</Label>
              <div className="flex flex-wrap gap-2">
                {PRESET_COLORS.map((c) => (
                  <button
                    key={c}
                    onClick={() => setForm((f) => ({ ...f, color: c }))}
                    className={cn(
                      "w-7 h-7 rounded-lg transition-all border-2",
                      form.color === c
                        ? "border-foreground scale-110"
                        : "border-transparent hover:scale-105"
                    )}
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
              <div className="flex items-center gap-2 mt-1">
                <div
                  className="w-6 h-6 rounded-md border border-border"
                  style={{ backgroundColor: form.color }}
                />
                <Input
                  type="color"
                  value={form.color}
                  className="w-12 h-7 p-0.5 cursor-pointer border border-border"
                  onChange={(e) => setForm((f) => ({ ...f, color: e.target.value }))}
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
