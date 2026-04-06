import { useEffect, useState, type ChangeEvent } from "react";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { api } from "@/lib/api";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
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
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Plus, Search, MoreHorizontal, Edit, Trash2, ImagePlus, X } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { createEmployeeAccount, listEmployeeAccounts } from "@/auth/auth-service";
import { EmployeeAvatar } from "@/components/employee-avatar";
import { uploadProfilePhoto } from "@/lib/uploads";

function formatCurrency(value: number) {
  return value.toLocaleString("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  });
}

type PayType = "monthly" | "hourly";
const MAX_PROFILE_PHOTO_SIZE = 4 * 1024 * 1024;

const employeeSchema = z
  .object({
    name: z.string().min(2, "Name is required"),
    email: z.string().email("Valid email is required"),
    phone: z.string().min(7, "Phone is required"),
    role: z.string().min(2, "Role is required"),
    department: z.string().min(2, "Department is required"),
    payType: z.enum(["monthly", "hourly"]),
    salary: z.coerce.number().min(0, "Salary must be greater than 0"),
    hourlyRate: z.coerce.number().min(0).optional(),
    status: z.enum(["Active", "Inactive"]),
  })
  .superRefine((data, ctx) => {
    if (data.payType === "monthly" && data.salary <= 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["salary"],
        message: "Salary must be greater than 0",
      });
    }

    if (data.payType === "hourly" && (!data.hourlyRate || data.hourlyRate <= 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["hourlyRate"],
        message: "Hourly rate must be greater than 0",
      });
    }
  });

type EmployeeRecord = z.infer<typeof employeeSchema> & {
  id: string;
  employeeId?: string;
  payType?: PayType;
  hourlyRate?: number;
  profilePhotoUrl?: string | null;
};
type EmployeeFormValues = z.infer<typeof employeeSchema>;
type EmployeeMutationInput = EmployeeFormValues & { profilePhotoUrl?: string | null };

const HOURS_PER_YEAR = 2080;

export default function Employees() {
  const [search, setSearch] = useState("");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingEmployeeId, setEditingEmployeeId] = useState<string | null>(null);
  const [employeeToDelete, setEmployeeToDelete] = useState<EmployeeRecord | null>(null);
  const [profilePhotoUrl, setProfilePhotoUrl] = useState<string | null>(null);
  const [profilePhotoName, setProfilePhotoName] = useState<string>("");
  const [isUploadingPhoto, setIsUploadingPhoto] = useState(false);
  const [photoInputKey, setPhotoInputKey] = useState(0);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: employeeData = [], isLoading } = useQuery({
    queryKey: ["employees"],
    queryFn: async () => {
      try {
        const result = await listEmployeeAccounts();
        return await api.syncEmployeeAccounts(result.employees);
      } catch {
        return api.getEmployees();
      }
    },
  });
  const employees = employeeData as EmployeeRecord[];

  const form = useForm<EmployeeFormValues>({
    resolver: zodResolver(employeeSchema),
    defaultValues: {
      name: "",
      email: "",
      phone: "",
      role: "",
      department: "",
      payType: "monthly",
      salary: 0,
      hourlyRate: 0,
      status: "Active",
    },
  });

  const watchedPayType = form.watch("payType");
  const watchedHourlyRate = form.watch("hourlyRate");

  useEffect(() => {
    if (watchedPayType !== "hourly") {
      return;
    }

    const rate = Number(watchedHourlyRate) || 0;
    form.setValue("salary", Math.round(rate * HOURS_PER_YEAR), {
      shouldDirty: true,
      shouldValidate: true,
    });
  }, [form, watchedHourlyRate, watchedPayType]);

  const createMutation = useMutation({
    mutationFn: async (payload: EmployeeMutationInput) => {
      const authAccount = await createEmployeeAccount({
        name: payload.name,
        email: payload.email,
        phone: payload.phone,
        position: payload.role,
        salary: payload.salary,
        payType: payload.payType,
        hourlyRate: payload.hourlyRate,
        profilePhotoUrl: payload.profilePhotoUrl ?? undefined,
        department: payload.department,
        status: payload.status === "Active" ? "active" : "inactive",
      });
      return { authAccount };
    },
    onSuccess: ({ authAccount }) => {
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: ["employees"] }),
        queryClient.invalidateQueries({ queryKey: ["adminOverview"] }),
      ]);
      toast({
        title: "Employee added successfully",
        description: authAccount.onboardingEmailSent
          ? `Onboarding email sent${authAccount.employeeId ? ` for ${authAccount.employeeId}` : ""}.`
          : authAccount.temporaryPassword
            ? `Temporary password: ${authAccount.temporaryPassword}`
            : "Employee account created, but onboarding email could not be sent.",
      });
      closeDialog();
    },
    onError: (error) => {
      toast({
        title: "Could not add employee",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: (payload: { id: string } & EmployeeMutationInput) => api.updateEmployee(payload),
    onSuccess: () => {
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: ["employees"] }),
        queryClient.invalidateQueries({ queryKey: ["adminOverview"] }),
      ]);
      toast({ title: "Employee updated successfully" });
      closeDialog();
    },
    onError: (error) => {
      toast({
        title: "Could not update employee",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: api.deleteEmployee,
    onSuccess: () => {
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: ["employees"] }),
        queryClient.invalidateQueries({ queryKey: ["adminOverview"] }),
      ]);
      setEmployeeToDelete(null);
      toast({ title: "Employee deleted successfully" });
    },
    onError: (error) => {
      toast({
        title: "Could not delete employee",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    },
  });

  function closeDialog() {
    setIsDialogOpen(false);
    setEditingEmployeeId(null);
    setProfilePhotoUrl(null);
    setProfilePhotoName("");
    setIsUploadingPhoto(false);
    setPhotoInputKey((value) => value + 1);
    form.reset({
      name: "",
      email: "",
      phone: "",
      role: "",
      department: "",
      payType: "monthly",
      salary: 0,
      hourlyRate: 0,
      status: "Active",
    });
  }

  function openCreateDialog() {
    setEditingEmployeeId(null);
    setProfilePhotoUrl(null);
    setProfilePhotoName("");
    setIsUploadingPhoto(false);
    setPhotoInputKey((value) => value + 1);
    form.reset({
      name: "",
      email: "",
      phone: "",
      role: "",
      department: "",
      payType: "monthly",
      salary: 0,
      hourlyRate: 0,
      status: "Active",
    });
    setIsDialogOpen(true);
  }

  function openEditDialog(employee: EmployeeRecord) {
    setEditingEmployeeId(employee.id);
    setProfilePhotoUrl(employee.profilePhotoUrl ?? null);
    setProfilePhotoName(employee.profilePhotoUrl ? "Uploaded profile photo" : "");
    setIsUploadingPhoto(false);
    setPhotoInputKey((value) => value + 1);
    form.reset({
      name: employee.name,
      email: employee.email,
      phone: employee.phone ?? "",
      role: employee.role,
      department: employee.department,
      payType: employee.payType ?? (employee.hourlyRate ? "hourly" : "monthly"),
      salary: employee.salary,
      hourlyRate: employee.hourlyRate ?? 0,
      status: employee.status,
    });
    setIsDialogOpen(true);
  }

  function handleSubmit(data: EmployeeFormValues) {
    const isHourly = data.payType === "hourly";
    const payload = {
      ...data,
      hourlyRate: isHourly ? Number(data.hourlyRate || 0) : 0,
      salary: isHourly ? Math.round(Number(data.hourlyRate || 0) * HOURS_PER_YEAR) : Number(data.salary || 0),
      profilePhotoUrl,
    };

    if (editingEmployeeId) {
      updateMutation.mutate({
        id: editingEmployeeId,
        ...payload,
      });
      return;
    }

    createMutation.mutate(payload);
  }

  async function handleProfilePhotoChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    if (!file.type.startsWith("image/")) {
      toast({
        title: "Invalid file",
        description: "Please upload a PNG, JPG, or WEBP image.",
        variant: "destructive",
      });
      return;
    }

    if (file.size > MAX_PROFILE_PHOTO_SIZE) {
      toast({
        title: "Image too large",
        description: "Please use a profile photo under 4 MB.",
        variant: "destructive",
      });
      return;
    }

    try {
      setIsUploadingPhoto(true);
      const uploaded = await uploadProfilePhoto(file);
      setProfilePhotoUrl(uploaded.url || uploaded.path || null);
      setProfilePhotoName(uploaded.fileName);
    } catch (error) {
      toast({
        title: "Could not upload image",
        description: error instanceof Error ? error.message : "Please try another image.",
        variant: "destructive",
      });
      setProfilePhotoUrl(null);
      setProfilePhotoName("");
    } finally {
      setIsUploadingPhoto(false);
    }
  }

  function clearProfilePhoto() {
    setProfilePhotoUrl(null);
    setProfilePhotoName("");
    setPhotoInputKey((value) => value + 1);
  }

  const filteredEmployees = employees.filter(
    (employee) =>
      employee.name.toLowerCase().includes(search.toLowerCase()) ||
      employee.role.toLowerCase().includes(search.toLowerCase())
  );

  function getPayLabel(employee: EmployeeRecord) {
    return employee.payType === "hourly" ? "Hourly" : "Monthly";
  }

  function getPaySummary(employee: EmployeeRecord) {
    if (employee.payType === "hourly") {
      return `${formatCurrency(employee.hourlyRate ?? 0)} / hr`;
    }

    return `${formatCurrency(employee.salary)} / yr`;
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Employees</h1>
            <p className="text-muted-foreground text-sm mt-1">
              Manage team members and compensation.
            </p>
          </div>

          <Dialog
            open={isDialogOpen}
            onOpenChange={(open) => {
              if (open) {
                setIsDialogOpen(true);
                return;
              }

              closeDialog();
            }}
          >
            <DialogTrigger asChild>
              <Button onClick={openCreateDialog}>
                <Plus className="w-4 h-4 mr-2" />
                Add Employee
              </Button>
            </DialogTrigger>
            <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
              <DialogHeader>
                <DialogTitle>{editingEmployeeId ? "Edit Employee" : "Add New Employee"}</DialogTitle>
                <DialogDescription>
                  {editingEmployeeId
                    ? "Update the employee details."
                    : "Enter the details of the new team member."}
                </DialogDescription>
              </DialogHeader>
              <Form {...form}>
                <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
                  <div className="rounded-xl border border-border/60 bg-secondary/10 p-4">
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                      <EmployeeAvatar
                        name={form.watch("name") || "Employee"}
                        src={profilePhotoUrl}
                        className="h-16 w-16"
                        fallbackClassName="text-sm"
                      />
                      <div className="space-y-3">
                        <div>
                          <p className="text-sm font-medium text-foreground">Profile Photo</p>
                          <p className="text-xs text-muted-foreground">
                            {isUploadingPhoto
                              ? "Uploading to secure storage..."
                              : profilePhotoName
                                ? `Stored securely in Supabase Storage as ${profilePhotoName}.`
                                : "Upload a clear square image for the employee sidebar and profile."}
                          </p>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <Input
                            key={photoInputKey}
                            type="file"
                            accept="image/png,image/jpeg,image/webp"
                            className="max-w-[260px] cursor-pointer"
                            onChange={(event) => void handleProfilePhotoChange(event)}
                            disabled={isUploadingPhoto}
                          />
                          {profilePhotoUrl ? (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="rounded-xl"
                              onClick={clearProfilePhoto}
                              disabled={isUploadingPhoto}
                            >
                              <X className="mr-2 h-4 w-4" />
                              Remove
                            </Button>
                          ) : (
                            <div className="inline-flex items-center gap-2 rounded-xl border border-border/60 px-3 py-2 text-xs text-muted-foreground">
                              <ImagePlus className="h-4 w-4" />
                              {isUploadingPhoto ? "Uploading..." : "Upload photo"}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                  <FormField
                    control={form.control}
                    name="name"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Full Name</FormLabel>
                        <FormControl>
                          <Input placeholder="Jane Doe" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="email"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Email</FormLabel>
                        <FormControl>
                          <Input type="email" placeholder="jane@yojak.in" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="phone"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Phone</FormLabel>
                        <FormControl>
                          <Input type="tel" placeholder="+91 9876543210" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <div className="grid grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="role"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Position</FormLabel>
                          <FormControl>
                            <Input placeholder="Software Engineer" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="department"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Department</FormLabel>
                          <Select onValueChange={field.onChange} value={field.value}>
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue placeholder="Select dept" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="Engineering">Engineering</SelectItem>
                              <SelectItem value="Design">Design</SelectItem>
                              <SelectItem value="Product">Product</SelectItem>
                              <SelectItem value="Marketing">Marketing</SelectItem>
                              <SelectItem value="HR">HR</SelectItem>
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="payType"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Pay Model</FormLabel>
                          <Select onValueChange={field.onChange} value={field.value}>
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue placeholder="Select model" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="monthly">Monthly Salary</SelectItem>
                              <SelectItem value="hourly">Hourly</SelectItem>
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="status"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Status</FormLabel>
                          <Select onValueChange={field.onChange} value={field.value}>
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue placeholder="Select status" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="Active">Active</SelectItem>
                              <SelectItem value="Inactive">Inactive</SelectItem>
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                  {watchedPayType === "hourly" ? (
                    <div className="grid grid-cols-2 gap-4">
                      <FormField
                        control={form.control}
                        name="hourlyRate"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Hourly Rate (₹/hr)</FormLabel>
                            <FormControl>
                              <Input type="number" step="1" placeholder="500" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="salary"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Annual Equivalent (₹)</FormLabel>
                            <FormControl>
                              <Input type="number" {...field} readOnly className="bg-muted/40" />
                            </FormControl>
                            <p className="text-xs text-muted-foreground">
                              Estimated from 2,080 working hours per year.
                            </p>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                  ) : (
                    <FormField
                      control={form.control}
                      name="salary"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Annual Salary (₹)</FormLabel>
                          <FormControl>
                            <Input type="number" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  )}
                  <DialogFooter className="mt-6">
                    <Button
                      type="submit"
                      disabled={createMutation.isPending || updateMutation.isPending || isUploadingPhoto}
                    >
                      {editingEmployeeId ? "Save Changes" : "Save Employee"}
                    </Button>
                  </DialogFooter>
                </form>
              </Form>
            </DialogContent>
          </Dialog>
        </div>

        <div className="flex items-center gap-4 bg-card p-4 rounded-lg border border-border/50">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search by name or role..."
              className="pl-9 bg-background"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <span className="text-xs text-muted-foreground">
            {filteredEmployees.length} member{filteredEmployees.length !== 1 ? "s" : ""}
          </span>
        </div>

        <div className="bg-card rounded-lg border border-border/50 overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="border-border/50 bg-secondary/20">
                <TableHead>Member</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Department</TableHead>
                <TableHead>Pay</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-[50px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                    Loading employees...
                  </TableCell>
                </TableRow>
              ) : filteredEmployees.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                    No employees found.
                  </TableCell>
                </TableRow>
              ) : (
                filteredEmployees.map((employee) => (
                  <TableRow
                    key={employee.id}
                    className="border-border/50 hover:bg-secondary/10 transition-colors"
                  >
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <EmployeeAvatar
                          name={employee.name}
                          src={employee.profilePhotoUrl}
                          className="h-9 w-9"
                        />
                        <div className="leading-tight">
                          <p className="font-medium text-sm text-foreground">{employee.name}</p>
                          <p className="text-xs text-muted-foreground mt-0.5">{employee.email}</p>
                          {employee.employeeId ? (
                            <p className="text-[11px] text-muted-foreground/80 mt-1">{employee.employeeId}</p>
                          ) : null}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {employee.role}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="font-normal text-xs">
                        {employee.department}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="space-y-1">
                        <Badge variant="outline" className="font-normal text-xs">
                          {getPayLabel(employee)}
                        </Badge>
                        <p className="text-sm font-medium tabular-nums">
                          {getPaySummary(employee)}
                        </p>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        <span
                          className={`w-1.5 h-1.5 rounded-full ${
                            employee.status === "Active" ? "bg-emerald-400" : "bg-muted-foreground/40"
                          }`}
                        />
                        <span
                          className={`text-xs font-medium ${
                            employee.status === "Active" ? "text-emerald-400" : "text-muted-foreground"
                          }`}
                        >
                          {employee.status}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8">
                            <MoreHorizontal className="w-4 h-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            className="cursor-pointer"
                            onSelect={() => openEditDialog(employee)}
                          >
                            <Edit className="w-4 h-4 mr-2" /> Edit
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            className="cursor-pointer text-destructive focus:text-destructive"
                            onSelect={() => setEmployeeToDelete(employee)}
                          >
                            <Trash2 className="w-4 h-4 mr-2" /> Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        <AlertDialog open={Boolean(employeeToDelete)} onOpenChange={(open) => !open && setEmployeeToDelete(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete employee?</AlertDialogTitle>
              <AlertDialogDescription>
                {employeeToDelete
                  ? `${employeeToDelete.name} will be removed from your employee records and their login will stop working immediately.`
                  : "This employee will be removed from your records and their login will stop working immediately."}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={deleteMutation.isPending}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                disabled={deleteMutation.isPending || !employeeToDelete}
                onClick={(event) => {
                  event.preventDefault();
                  if (!employeeToDelete) {
                    return;
                  }

                  deleteMutation.mutate(employeeToDelete.id);
                }}
              >
                {deleteMutation.isPending ? "Deleting..." : "Delete Employee"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </DashboardLayout>
  );
}
