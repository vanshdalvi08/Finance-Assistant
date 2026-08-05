import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, MoreHorizontal, Plus, ShieldCheck } from "lucide-react";
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
import { api, type ClientAccount } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";

type ClientForm = {
  name: string;
  email: string;
  phone: string;
  company: string;
  address: string;
  website: string;
  gstin: string;
  billingEmail: string;
  status: "Active" | "Inactive";
};

const emptyForm: ClientForm = {
  name: "",
  email: "",
  phone: "",
  company: "",
  address: "",
  website: "",
  gstin: "",
  billingEmail: "",
  status: "Active",
};

export default function ClientsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingClient, setEditingClient] = useState<ClientAccount | null>(null);
  const [clientToDelete, setClientToDelete] = useState<ClientAccount | null>(null);
  const [form, setForm] = useState<ClientForm>(emptyForm);

  const { data: clients = [] } = useQuery({
    queryKey: ["clients"],
    queryFn: api.getClients,
  });

  const saveMutation = useMutation({
    mutationFn: () =>
      editingClient
        ? api.updateClient({ id: editingClient.id, ...form })
        : api.addClient(form),
    onSuccess: (client) => {
      queryClient.setQueryData<ClientAccount[]>(["clients"], (current = []) => {
        const next = current.some((item) => item.id === client.id)
          ? current.map((item) => (item.id === client.id ? client : item))
          : [client, ...current];
        return next.sort((left, right) => left.name.localeCompare(right.name));
      });
      toast({
        title: editingClient ? "Client updated" : "Client added",
        description: !editingClient && client.temporaryPassword
          ? `Temporary password: ${client.temporaryPassword}`
          : "This client can now access the client dashboard.",
      });
      closeDialog();
    },
    onError: (error) => {
      toast({
        title: "Could not save client",
        description: error instanceof Error ? error.message : "Please check the details again.",
        variant: "destructive",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: api.deleteClient,
    onSuccess: (_, id) => {
      queryClient.setQueryData<ClientAccount[]>(["clients"], (current = []) =>
        current.filter((client) => client.id !== id),
      );
      setClientToDelete(null);
      toast({ title: "Client removed", description: "Client dashboard access was removed." });
    },
    onError: (error) => {
      toast({
        title: "Could not remove client",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    },
  });

  function openCreateDialog() {
    setEditingClient(null);
    setForm(emptyForm);
    setDialogOpen(true);
  }

  function openEditDialog(client: ClientAccount) {
    setEditingClient(client);
    setForm({
      name: client.name,
      email: client.email,
      phone: client.phone ?? "",
      company: client.company ?? "",
      address: client.address ?? "",
      website: client.website ?? "",
      gstin: client.gstin ?? "",
      billingEmail: client.billingEmail ?? client.email,
      status: client.status,
    });
    setDialogOpen(true);
  }

  function closeDialog() {
    setDialogOpen(false);
    setEditingClient(null);
    setForm(emptyForm);
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Clients</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Manage client contacts who can review and approve pre-approval sheets.
            </p>
          </div>
          <Button onClick={openCreateDialog}>
            <Plus className="mr-2 h-4 w-4" />
            Add Client
          </Button>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <Card className="border-border/60 bg-card/80">
            <CardContent className="p-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Client Accounts</p>
                  <p className="mt-2 text-2xl font-semibold">{clients.length}</p>
                </div>
                <div className="rounded-xl bg-primary/10 p-3 text-primary">
                  <Building2 className="h-5 w-5" />
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="border-border/60 bg-card/80 md:col-span-2">
            <CardContent className="flex h-full items-center gap-3 p-5 text-sm text-muted-foreground">
              <ShieldCheck className="h-5 w-5 text-emerald-400" />
              Client users only see their own pre-approval sheets and cannot access admin or employee modules.
            </CardContent>
          </Card>
        </div>

        <Card className="border-border/60">
          <CardHeader>
            <CardTitle className="text-base">Client Directory</CardTitle>
          </CardHeader>
          <CardContent>
            {clients.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border/70 py-12 text-center text-sm text-muted-foreground">
                No clients added yet.
              </div>
            ) : (
              <div className="space-y-3">
                {clients.map((client) => (
                  <div
                    key={client.id}
                    className="flex flex-col gap-3 rounded-xl border border-border/60 bg-secondary/10 p-4 md:flex-row md:items-center md:justify-between"
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-sm font-semibold text-primary">
                        {client.name.slice(0, 2).toUpperCase()}
                      </div>
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-medium">{client.name}</p>
                          <Badge variant={client.status === "Active" ? "secondary" : "outline"}>{client.status}</Badge>
                        </div>
                        <p className="mt-1 text-sm text-muted-foreground">
                          {client.company || "No company added"} · {client.email}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button variant="outline" size="sm" onClick={() => openEditDialog(client)}>
                        Edit
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => setClientToDelete(client)}>
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
            <DialogTitle>{editingClient ? "Edit Client" : "Add Client"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="space-y-2">
              <Label>Client Name</Label>
              <Input value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} />
            </div>
            <div className="rounded-xl border border-border/60 bg-secondary/10 p-4">
              <h3 className="text-sm font-medium">Client Information for Pre Approval PDF</h3>
              <p className="mt-1 text-xs text-muted-foreground">These details prefill the client block in exported quotation sheets.</p>
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>Email</Label>
                  <Input value={form.email} onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))} />
                </div>
                <div className="space-y-2">
                  <Label>Billing Email</Label>
                  <Input value={form.billingEmail} onChange={(event) => setForm((current) => ({ ...current, billingEmail: event.target.value }))} />
                </div>
                <div className="space-y-2">
                  <Label>Phone</Label>
                  <Input value={form.phone} onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))} />
                </div>
                <div className="space-y-2">
                  <Label>Company</Label>
                  <Input value={form.company} onChange={(event) => setForm((current) => ({ ...current, company: event.target.value }))} />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label>Address</Label>
                  <Input value={form.address} onChange={(event) => setForm((current) => ({ ...current, address: event.target.value }))} />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label>Website</Label>
                  <Input value={form.website} onChange={(event) => setForm((current) => ({ ...current, website: event.target.value }))} />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label>GSTIN</Label>
                  <Input
                    value={form.gstin}
                    onChange={(event) => setForm((current) => ({ ...current, gstin: event.target.value.toUpperCase() }))}
                    placeholder="e.g. 27AABCU9603R1ZX"
                    maxLength={15}
                  />
                </div>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Status</Label>
              <select
                value={form.status}
                onChange={(event) => setForm((current) => ({ ...current, status: event.target.value as ClientForm["status"] }))}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option>Active</option>
                <option>Inactive</option>
              </select>
            </div>
            <Button
              disabled={!form.name.trim() || !form.email.trim() || !form.phone.trim() || saveMutation.isPending}
              onClick={() => saveMutation.mutate()}
            >
              {saveMutation.isPending ? "Saving..." : "Save Client"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={Boolean(clientToDelete)} onOpenChange={(open) => !open && setClientToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove client?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes dashboard access for {clientToDelete?.name}. Existing pre-approval records remain in the system.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                if (clientToDelete) {
                  deleteMutation.mutate(clientToDelete.id);
                }
              }}
            >
              Remove Client
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </DashboardLayout>
  );
}
