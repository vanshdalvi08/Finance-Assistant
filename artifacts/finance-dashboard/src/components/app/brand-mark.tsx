import { cn } from "@/lib/utils";

type BrandMarkProps = {
  className?: string;
};

export function BrandMark({ className }: BrandMarkProps) {
  return (
    <svg
      viewBox="0 0 256 256"
      aria-hidden="true"
      className={cn("h-full w-full", className)}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path fill="#F7F6F2" d="M45 56H61L130 125L114 141L45 72V56Z" />
      <path fill="#F7F6F2" d="M69 56H125L169 100L128 141L112 125L136 101L109 74H85L69 56Z" />
      <path fill="#F7F6F2" d="M143 56H211L191 76H167L120 123L104 107L143 56Z" />
      <path fill="#F7F6F2" d="M45 199L114 130L130 146L61 215H45V199Z" />
      <path fill="#F7F6F2" d="M89 215L133 171L149 187L121 215H89Z" />
      <path fill="#F7F6F2" d="M126 151L142 135L211 204V220H195L126 151Z" />
      <path
        fill="#C9C5D8"
        d="M226 214L231 223L240 228L231 233L226 242L221 233L212 228L221 223L226 214Z"
      />
    </svg>
  );
}
