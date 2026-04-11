export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,rgba(240,182,92,0.2),transparent_18%),radial-gradient(circle_at_right,rgba(15,90,150,0.22),transparent_28%),linear-gradient(180deg,#f7fbff_0%,#eef4f9_48%,#f5f7fb_100%)] text-foreground">
      {children}
    </div>
  );
}
