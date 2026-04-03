import { useEffect, useState } from "react";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { api } from "@/lib/api";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Plus, Search, MoreHorizontal, Edit, Trash2 } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { createEmployeeAccount, listEmployeeAccounts } from "@/auth/auth-service";

const AVATAR_PALETTE = [
  { bg: "#1e3a5f", fg: "#60a5fa" },
  { bg: "#1a3a2e", fg: "#34d399" },
  { bg: "#3b1f5e", fg: "#a78bfa" },
  { bg: "#3b2006", fg: "#fb923c" },
  { bg: "#1e2d5e", fg: "#818cf8" },
  { bg: "#3b1a2e", fg: "#f472b6" },
  { bg: "#1e3a3a", fg: "#2dd4bf" },
  { bg: "#2e2006", fg: "#facc15" },
];

function nameHash(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return h;
}

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

function formatCurrency(value: number) {
  return value.toLocaleString("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  });
}

function EmployeeAvatar({ name, size = 36 }: { name: string; size?: number }) {
  const palette = AVATAR_PALETTE[nameHash(name) % AVATAR_PALETTE.length];
  const initials = getInitials(name);
  const r = size / 2;

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style={{ flexShrink: 0 }}
    >
      <circle cx={r} cy={r} r={r} fill={palette.bg} />
      <ellipse
        cx={r}
        cy={size * 1.08}
        rx={r * 0.78}
        ry={r * 0.58}
        fill={palette.fg}
        opacity={0.18}
      />
      <circle
        cx={r}
        cy={size * 0.38}
        r={r * 0.32}
        fill={palette.fg}
        opacity={0.22}
      />
      <text
        x={r}
        y={size * 0.64}
        textAnchor="middle"
        dominantBaseline="middle"
        fill={palette.fg}
        fontSize={size * 0.3}
        fontWeight="600"
        fontFamily="Inter, system-ui, sans-serif"
        letterSpacing="0.5"
      >
        {initials}
      </text>
      <circle
        cx={r}
        cy={r}
        r={r - 0.5}
        stroke={palette.fg}
        strokeWidth="0.75"
        strokeOpacity="0.2"
        fill="none"
      />
    </svg>
  );
}

type PayType = "monthly" | "hourly";

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
};

const HOURS_PER_YEAR = 2080;

export default function Employees() {
  const [search, setSearch] = useState("");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingEmployeeId, setEditingEmployeeId] = useState<string | null>(null);
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

  const form = useForm<z.infer<typeof employeeSchema>>({
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
    mutationFn: async (payload: z.infer<typeof employeeSchema>) => {
      const authAccount = await createEmployeeAccount({
        name: payload.name,
        email: payload.email,
        phone: payload.phone,
        position: payload.role,
        salary: payload.salary,
        payType: payload.payType,
        hourlyRate: payload.hourlyRate,
        department: payload.department,
        status: payload.status === "Active" ? "active" : "inactive",
      });

      const employee = await api.addEmployee({
        id: authAccount.user.id,
        name: authAccount.user.name ?? payload.name,
        email: authAccount.user.email,
        phone: authAccount.user.phone ?? payload.phone,
        role: payload.role,
        department: payload.department,
        salary: payload.salary,
        payType: payload.payType,
        hourlyRate: payload.hourlyRate,
        status: authAccount.user.status === "inactive" ? "Inactive" : "Active",
        employeeId: authAccount.employeeId ?? authAccount.user.employeeId,
      });

      return { authAccount, employee };
    },
    onSuccess: ({ authAccount }) => {
      queryClient.invalidateQueries({ queryKey: ["employees"] });
      queryClient.invalidateQueries({ queryKey: ["adminOverview"] });
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
    mutationFn: (payload: { id: string } & z.infer<typeof employeeSchema>) => api.updateEmployee(payload as any),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["employees"] });
      queryClient.invalidateQueries({ queryKey: ["adminOverview"] });
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
      queryClient.invalidateQueries({ queryKey: ["employees"] });
      queryClient.invalidateQueries({ queryKey: ["adminOverview"] });
      toast({ title: "Employee deactivated successfully" });
    },
  });

  function closeDialog() {
    setIsDialogOpen(false);
    setEditingEmployeeId(null);
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

  function handleSubmit(data: z.infer<typeof employeeSchema>) {
    const isHourly = data.payType === "hourly";
    const payload = {
      ...data,
      hourlyRate: isHourly ? Number(data.hourlyRate || 0) : 0,
      salary: isHourly ? Math.round(Number(data.hourlyRate || 0) * HOURS_PER_YEAR) : Number(data.salary || 0),
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
            <DialogContent>
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
                    <Button type="submit" disabled={createMutation.isPending || updateMutation.isPending}>
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
                        <EmployeeAvatar name={employee.name} size={36} />
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
                            onSelect={() => deleteMutation.mutate(employee.id)}
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
      </div>
    </DashboardLayout>
  );
}
