import { AdminSidebar } from "@/components/navigation/admin-sidebar";
import { AppHeader } from "@/components/navigation/app-header";

export function AdminShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background text-foreground lg:flex">
      <AdminSidebar />
      <div className="flex-1">
        <AppHeader />
        <main className="px-5 py-8 md:px-8 xl:px-10">{children}</main>
      </div>
    </div>
  );
}
