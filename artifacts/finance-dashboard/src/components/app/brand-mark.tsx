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
      <rect x="8" y="8" width="240" height="240" rx="44" fill="#050505" />
      <path
        fill="#F7F6F2"
        d="M38 60H116C138 60 156 67 170 81C181 92 187 105 187 121C187 137 182 150 170 162C162 170 153 176 142 180L199 238H160L118 190H75V238H38V60ZM75 97V153H117C127 153 136 149 142 142C147 137 150 131 150 124C150 116 147 110 142 105C136 100 127 97 117 97H75Z"
      />
      <path fill="#050505" d="M124 116L145 151L124 167L145 194L114 212L89 171H75V138H102L124 116Z" />
      <path fill="#F7F6F2" d="M168 84L196 56H220L177 116L168 84Z" />
      <path fill="#F7F6F2" d="M63 223L108 176L124 192L80 238H52L63 223Z" />
      <path
        fill="#C9C5D8"
        d="M225 213L230 223L240 228L230 233L225 243L220 233L210 228L220 223L225 213Z"
      />
    </svg>
  );
}
