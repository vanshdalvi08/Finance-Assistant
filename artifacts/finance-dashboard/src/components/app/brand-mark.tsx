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
      <rect x="8" y="8" width="240" height="240" rx="44" fill="#202020" />
      <path
        fill="#F8F7F4"
        d="M52 46H120C146 46 165 51 179 64C191 76 198 91 198 110C198 129 191 144 176 156C169 162 160 167 148 171L178 218H132L107 177H90V218H52V46ZM90 82V142H119C134 142 145 139 152 133C159 127 163 119 163 109C163 99 159 92 152 87C145 84 134 82 119 82H90Z"
      />
      <path
        fill="#202020"
        d="M128 109L146 139L130 150L146 177L114 195L96 164H90V136H113L128 109Z"
      />
      <path
        fill="#F8F7F4"
        d="M164 46H209L176 100L220 178L244 218H200L154 136L164 46Z"
      />
      <path
        fill="#F8F7F4"
        d="M201 46H244L142 218H98L201 46Z"
      />
      <path
        fill="#F8F7F4"
        d="M156 218L177 183L198 218H156Z"
      />
    </svg>
  );
}
