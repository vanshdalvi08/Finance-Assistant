import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MoreHorizontal, Plus, ShieldCheck, UserCog } from "lucide-react";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, type AdminAccount } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";

type AdminForm = {
  name: string;
  email: string;
  phone: string;
  position: string;
  department: string;
  status: "Active" | "Inactive";
};

const emptyForm: AdminForm = {
  name: "",
  email: "",
  phone: "",
  position: "Administrator",
  department: "Operations",
  status: "Active",
};

export default function AdminsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingAdmin, setEditingAdmin] = useState<AdminAccount | null>(null);
  const [adminToDelete, setAdminToDelete] = useState<AdminAccount | null>(null);
  const [form, setForm] = useState<AdminForm>(emptyForm);

  const { data: admins = [] } = useQuery({
    queryKey: ["admins"],
    queryFn: api.getAdmins,
  });

  const saveMutation = useMutation({
    mutationFn: () =>
      editingAdmin
        ? api.updateAdmin({ id: editingAdmin.id, ...form })
        : api.addAdmin(form),
    onSuccess: (admin) => {
      queryClient.setQueryData<AdminAccount[]>(["admins"], (current = []) => {
        const next = current.some((item) => item.id === admin.id)
          ? current.map((item) => (item.id === admin.id ? admin : item))
          : [admin, ...current];
        return next.sort((left, right) => left.name.localeCompare(right.name));
      });

      toast({
        title: editingAdmin ? "Admin updated" : "Admin added",
        description:
          !editingAdmin && admin.temporaryPassword
            ? `Temporary password: ${admin.temporaryPassword}`
            : !editingAdmin
              ? "Onboarding credentials were prepared for the new admin."
              : "Workspace access details were updated.",
      });

      closeDialog();
    },
    onError: (error) => {
      toast({
        title: "Could not save admin",
        description: error instanceof Error ? error.message : "Please check the details again.",
        variant: "destructive",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: api.deleteAdmin,
    onSuccess: (_, id) => {
      queryClient.setQueryData<AdminAccount[]>(["admins"], (current = []) =>
        current.filter((admin) => admin.id !== id),
      );
      setAdminToDelete(null);
      toast({
        title: "Admin removed",
        description: "This admin no longer has workspace access.",
      });
    },
    onError: (error) => {
      toast({
        title: "Could not remove admin",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    },
  });

  function openCreateDialog() {
    setEditingAdmin(null);
    setForm(emptyForm);
    setDialogOpen(true);
  }

  function openEditDialog(admin: AdminAccount) {
    setEditingAdmin(admin);
    setForm({
      name: admin.name,
      email: admin.email,
      phone: admin.phone ?? "",
      position: admin.position ?? "Administrator",
      department: admin.department ?? "Operations",
      status: admin.status,
    });
    setDialogOpen(true);
  }

  function closeDialog() {
    setDialogOpen(false);
    setEditingAdmin(null);
    setForm(emptyForm);
  }

  const activeAdmins = admins.filter((admin) => admin.status === "Active").length;

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Admins</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Add and manage workspace admins without changing the current company setup.
            </p>
          </div>
          <Button onClick={openCreateDialog}>
            <Plus className="mr-2 h-4 w-4" />
            Add Admin
          </Button>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <Card className="border-border/60 bg-card/80">
            <CardContent className="p-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Admin Accounts</p>
                  <p className="mt-2 text-2xl font-semibold">{admins.length}</p>
                </div>
                <div className="rounded-xl bg-primary/10 p-3 text-primary">
                  <UserCog className="h-5 w-5" />
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="border-border/60 bg-card/80">
            <CardContent className="p-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Active Admins</p>
                  <p className="mt-2 text-2xl font-semibold">{activeAdmins}</p>
                </div>
                <div className="rounded-xl bg-emerald-500/10 p-3 text-emerald-400">
                  <ShieldCheck className="h-5 w-5" />
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="border-border/60 bg-card/80">
            <CardContent className="flex h-full items-center gap-3 p-5 text-sm text-muted-foreground">
              <ShieldCheck className="h-5 w-5 text-emerald-400" />
              New admins are added to this tenant only and receive onboarding credentials through the same secure mail flow.
            </CardContent>
          </Card>
        </div>

        <Card className="border-border/60">
          <CardHeader>
            <CardTitle className="text-base">Workspace Admins</CardTitle>
          </CardHeader>
          <CardContent>
            {admins.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border/70 py-12 text-center text-sm text-muted-foreground">
                No admins added yet.
              </div>
            ) : (
              <div className="space-y-3">
                {admins.map((admin) => (
                  <div
                    key={admin.id}
                    className="flex flex-col gap-3 rounded-xl border border-border/60 bg-secondary/10 p-4 md:flex-row md:items-center md:justify-between"
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-sm font-semibold text-primary">
                        {admin.name.slice(0, 2).toUpperCase()}
                      </div>
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-medium">{admin.name}</p>
                          <Badge variant={admin.status === "Active" ? "secondary" : "outline"}>{admin.status}</Badge>
                        </div>
                        <p className="mt-1 text-sm text-muted-foreground">
                          {admin.position || "Administrator"} · {admin.email}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {admin.department || "Operations"}{admin.phone ? ` · ${admin.phone}` : ""}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button variant="outline" size="sm" onClick={() => openEditDialog(admin)}>
                        Edit
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => setAdminToDelete(admin)}>
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={dialogOpen} onOpenChange={(open) => (open ? setDialogOpen(true) : closeDialog())}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editingAdmin ? "Edit Admin" : "Add Admin"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>Admin Name</Label>
                <Input value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Email</Label>
                <Input value={form.email} onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Phone</Label>
                <Input value={form.phone} onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Position</Label>
                <Input value={form.position} onChange={(event) => setForm((current) => ({ ...current, position: event.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Department</Label>
                <Input value={form.department} onChange={(event) => setForm((current) => ({ ...current, department: event.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Status</Label>
                <select
                  value={form.status}
                  onChange={(event) => setForm((current) => ({ ...current, status: event.target.value as AdminForm["status"] }))}
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option>Active</option>
                  <option>Inactive</option>
                </select>
              </div>
            </div>
            <Button
              disabled={!form.name.trim() || !form.email.trim() || !form.phone.trim() || saveMutation.isPending}
              onClick={() => saveMutation.mutate()}
            >
              {saveMutation.isPending ? "Saving..." : "Save Admin"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={Boolean(adminToDelete)} onOpenChange={(open) => !open && setAdminToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove admin?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes workspace access for {adminToDelete?.name}. The workspace will still keep at least one active admin.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                if (adminToDelete) {
                  deleteMutation.mutate(adminToDelete.id);
                }
              }}
            >
              Remove Admin
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </DashboardLayout>
  );
}
