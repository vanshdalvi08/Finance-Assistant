import { Link } from "wouter";
import { routes } from "@/app/route-map";
import { Button } from "@/components/ui/button";

export default function NotFoundPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-xl rounded-[2rem] border border-white/8 bg-white/[0.03] p-10 text-center">
        <p className="text-xs uppercase tracking-[0.24em] text-[#c6ac73]">404</p>
        <h1 className="mt-4 font-serif text-4xl font-semibold text-foreground">Page not found</h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          The page you are trying to access does not exist in the current YOJAK workspace map.
        </p>
        <div className="mt-6">
          <Link href={routes.login}>
            <Button>Return to login</Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
