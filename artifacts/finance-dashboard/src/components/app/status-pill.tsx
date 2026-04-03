import { cn } from "@/lib/utils";

const tones = {
  draft: "border-slate-400/20 bg-slate-400/10 text-slate-200",
  submitted: "border-amber-400/20 bg-amber-400/10 text-amber-200",
  approved: "border-emerald-400/20 bg-emerald-400/10 text-emerald-200",
  rejected: "border-rose-400/20 bg-rose-400/10 text-rose-200",
  active: "border-emerald-400/20 bg-emerald-400/10 text-emerald-200",
  inactive: "border-white/10 bg-white/5 text-muted-foreground",
  paid: "border-sky-400/20 bg-sky-400/10 text-sky-200",
  processed: "border-indigo-400/20 bg-indigo-400/10 text-indigo-200",
  scheduled: "border-purple-400/20 bg-purple-400/10 text-purple-200",
} as const;

export function StatusPill({
  status,
  className,
}: {
  status: keyof typeof tones | string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.14em]",
        tones[status as keyof typeof tones] ?? "border-white/10 bg-white/5 text-muted-foreground",
        className,
      )}
    >
      {status}
    </span>
  );
}
