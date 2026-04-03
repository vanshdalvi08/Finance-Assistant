import { EmployeeSidebar } from "@/components/navigation/employee-sidebar";
import { AppHeader } from "@/components/navigation/app-header";

export function EmployeeShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background text-foreground lg:flex">
      <EmployeeSidebar />
      <div className="flex-1">
        <AppHeader />
        <main className="px-5 py-8 md:px-8 xl:px-10">{children}</main>
      </div>
    </div>
  );
}
