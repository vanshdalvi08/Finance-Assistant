import { cn } from "@/lib/utils";

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  className,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-5 border-b border-white/6 pb-6 md:flex-row md:items-end md:justify-between", className)}>
      <div className="space-y-2">
        {eyebrow && <p className="text-xs uppercase tracking-[0.24em] text-[#c6ac73]">{eyebrow}</p>}
        <div className="space-y-1">
          <h1 className="font-serif text-3xl font-semibold tracking-tight text-foreground md:text-4xl">{title}</h1>
          {description && <p className="max-w-2xl text-sm text-muted-foreground md:text-base">{description}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-3">{actions}</div>}
    </div>
  );
}
