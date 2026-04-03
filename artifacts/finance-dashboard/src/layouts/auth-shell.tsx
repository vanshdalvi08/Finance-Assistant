export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,rgba(216,178,106,0.15),transparent_22%),radial-gradient(circle_at_right,rgba(90,105,180,0.12),transparent_24%),#0b0908] px-4 py-10 text-foreground">
      {children}
    </div>
  );
}
