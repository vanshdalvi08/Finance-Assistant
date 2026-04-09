import { PlatformSidebar } from "@/components/navigation/platform-sidebar";

export function PlatformShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background text-foreground lg:flex">
      <PlatformSidebar />
      <main className="flex-1">
        <div className="mx-auto max-w-7xl px-6 py-8 lg:px-8">{children}</div>
      </main>
    </div>
  );
}
