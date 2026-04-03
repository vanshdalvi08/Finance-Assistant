export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="rounded-3xl border border-dashed border-white/10 bg-white/[0.02] px-6 py-14 text-center">
      <div className="mx-auto max-w-lg space-y-3">
        <h3 className="font-serif text-2xl font-semibold text-foreground">{title}</h3>
        <p className="text-sm leading-6 text-muted-foreground">{description}</p>
        {action && <div className="pt-2">{action}</div>}
      </div>
    </div>
  );
}
