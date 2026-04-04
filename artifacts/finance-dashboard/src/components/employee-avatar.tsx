import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

function getInitials(value: string) {
  return value
    .split(" ")
    .map((part) => part[0] ?? "")
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

export function EmployeeAvatar({
  name,
  src,
  className,
  fallbackClassName,
}: {
  name: string;
  src?: string | null;
  className?: string;
  fallbackClassName?: string;
}) {
  return (
    <Avatar className={cn("h-10 w-10 border border-border/60", className)}>
      <AvatarImage src={src ?? undefined} alt={name} className="object-cover" />
      <AvatarFallback
        className={cn(
          "bg-primary/10 text-xs font-semibold text-primary",
          fallbackClassName,
        )}
      >
        {getInitials(name)}
      </AvatarFallback>
    </Avatar>
  );
}
