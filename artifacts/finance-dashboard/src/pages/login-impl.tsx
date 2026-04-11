import { useState } from "react";
import { useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { requestPasswordReset } from "@/auth/auth-service";
import { useAuthStore } from "@/store/auth";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

function resolveWorkspace(role: "admin" | "employee" | "client" | "platform_super_admin") {
  if (role === "platform_super_admin") return "/platform/dashboard";
  if (role === "client") return "/client/pre-approvals";
  return role === "admin" ? "/" : "/employee/timesheet";
}

function DividerLabel() {
  return (
    <div className="flex items-center gap-4 text-[11px] font-medium uppercase tracking-[0.28em] text-slate-400">
      <span className="h-px flex-1 bg-slate-200" />
      <span>OR</span>
      <span className="h-px flex-1 bg-slate-200" />
    </div>
  );
}

function SocialBadge({ tone, children }: { tone: string; children: React.ReactNode }) {
  return <span className={cn("grid h-7 w-7 shrink-0 place-items-center rounded-full text-sm font-bold", tone)}>{children}</span>;
}

export default function LoginPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const login = useAuthStore((state) => state.login);

  const form = useForm<z.infer<typeof loginSchema>>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });

  async function onSubmit(values: z.infer<typeof loginSchema>) {
    setIsLoading(true);
    try {
      const session = await login(values);
      toast({
        title: "Session established",
        description: `Welcome back, ${session.user.name ?? session.user.email}.`,
      });
      setLocation(resolveWorkspace(session.user.role));
    } catch (error) {
      toast({
        title: "Sign in failed",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  }

  async function handleResetRequest() {
    const email = form.getValues("email").trim();
    if (!email) {
      toast({
        title: "Enter your email first",
        description: "We need the account email to send a reset link.",
        variant: "destructive",
      });
      return;
    }

    setIsResetting(true);
    try {
      await requestPasswordReset({ email });
      toast({
        title: "Reset email sent",
        description: "Check your inbox for the password reset link.",
      });
    } catch (error) {
      toast({
        title: "Could not send reset email",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsResetting(false);
    }
  }

  function handleComingSoonAuth(provider: string) {
    toast({
      title: `${provider} sign in is not configured`,
      description: "Use your work email and password for now. We can wire SSO later.",
    });
  }

  function handleCreateAccount() {
    toast({
      title: "Account creation is admin-managed",
      description: "Ask your tenant administrator or platform team to create your account.",
    });
  }

  return (
    <div className="min-h-screen bg-white text-slate-950">
      <div className="grid min-h-screen lg:grid-cols-[69.5%_30.5%]">
        <section className="relative hidden overflow-hidden bg-[#34404d] text-white lg:block">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_16%_15%,rgba(255,255,255,0.05),transparent_20%),linear-gradient(180deg,rgba(255,255,255,0.015),rgba(255,255,255,0)_20%)]" />
          <div className="absolute inset-x-0 bottom-0 h-[27%] bg-[#0a2960]" />
          <div className="absolute inset-x-0 bottom-[27%] h-px bg-white/6" />
          <div className="relative z-10 flex min-h-screen flex-col px-10 pb-0 pt-10 xl:px-14 xl:pt-11">
            <div className="leading-none">
              <div className="flex items-start gap-1">
                <span className="text-[4rem] font-black tracking-[-0.085em] xl:text-[4.5rem]">YOJAK</span>
                <span className="pt-1.5 text-[1rem] font-semibold tracking-[-0.02em] text-white/92">TM</span>
              </div>
              <p className="mt-1 text-[2.1rem] font-semibold tracking-[-0.055em] text-white/96">Payroll</p>
            </div>
            <div className="relative z-10 mt-[6.8rem] max-w-[35rem] xl:mt-[8.2rem]">
              <h1 className="max-w-[10ch] text-[4.1rem] font-black leading-[0.95] tracking-[-0.075em] text-white xl:text-[4.6rem]">Welcome Back!</h1>
              <p className="mt-3 max-w-[11ch] text-[2.25rem] font-semibold leading-[1.02] tracking-[-0.06em] text-white/96 xl:text-[2.45rem]">
                Manage payroll and workforce with confidence.
              </p>
            </div>
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[44%] min-h-[325px] overflow-hidden xl:h-[47%]">
              <img
                src="/auth/login-reference.jpg"
                alt=""
                className="absolute bottom-[-1%] left-[10%] h-[112%] w-[104%] max-w-none object-cover object-left-bottom opacity-[0.98] mix-blend-screen xl:left-[8%] xl:w-[102%]"
              />
            </div>
          </div>
        </section>
        <section className="relative flex min-h-screen items-center justify-center bg-white px-6 py-10 sm:px-8 lg:px-10 xl:px-12">
          <div className="w-full max-w-[27rem]">
            <div className="mb-9 text-center">
              <h2 className="text-[2.1rem] font-black tracking-[-0.06em] text-slate-950 sm:text-[2.45rem]">Enter Your Credentials</h2>
              <p className="mt-3 text-[0.9rem] font-medium text-slate-500">
                Don&apos;t have an account?{" "}
                <button type="button" onClick={handleCreateAccount} className="font-semibold text-slate-900 underline decoration-slate-900/45 underline-offset-4 transition hover:decoration-slate-900">
                  Create now
                </button>
              </p>
            </div>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                <FormField control={form.control} name="email" render={({ field }) => (
                  <FormItem className="space-y-2.5">
                    <FormLabel className="text-[1rem] font-semibold tracking-[-0.02em] text-slate-900">E-mail</FormLabel>
                    <FormControl>
                      <Input type="email" placeholder="example@gmail.com" autoComplete="email" data-testid="input-email" className="h-14 rounded-[0.95rem] border-[#d7dde6] bg-white px-4 text-[1rem] text-slate-900 shadow-none placeholder:text-slate-400 focus-visible:ring-2 focus-visible:ring-[#34404d] focus-visible:ring-offset-0" {...field} />
                    </FormControl>
                    <FormMessage className="text-xs" />
                  </FormItem>
                )} />
                <FormField control={form.control} name="password" render={({ field }) => (
                  <FormItem className="space-y-2.5">
                    <FormLabel className="text-[1rem] font-semibold tracking-[-0.02em] text-slate-900">Password</FormLabel>
                    <FormControl>
                      <div className="relative">
                        <Input type={showPassword ? "text" : "password"} placeholder="******" autoComplete="current-password" data-testid="input-password" className="h-14 rounded-[0.95rem] border-[#d7dde6] bg-white px-4 pr-12 text-[1rem] text-slate-900 shadow-none placeholder:text-slate-400 focus-visible:ring-2 focus-visible:ring-[#34404d] focus-visible:ring-offset-0" {...field} />
                        <button type="button" onClick={() => setShowPassword((current) => !current)} className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 transition hover:text-slate-700" aria-label={showPassword ? "Hide password" : "Show password"}>
                          {showPassword ? <EyeOff className="h-4.5 w-4.5" /> : <Eye className="h-4.5 w-4.5" />}
                        </button>
                      </div>
                    </FormControl>
                    <FormMessage className="text-xs" />
                  </FormItem>
                )} />
                <div className="flex items-center justify-between gap-4 text-[0.95rem] text-slate-500">
                  <label className="flex items-center gap-2.5 font-medium text-slate-500">
                    <Checkbox checked={rememberMe} onCheckedChange={(checked) => setRememberMe(checked === true)} className="h-[18px] w-[18px] rounded-[5px] border-slate-300 data-[state=checked]:border-[#34404d] data-[state=checked]:bg-[#34404d]" />
                    <span>Remember me</span>
                  </label>
                  <button type="button" onClick={handleResetRequest} disabled={isResetting} className="font-medium text-slate-800 transition hover:text-slate-950 disabled:cursor-not-allowed disabled:text-slate-400">
                    {isResetting ? "Sending reset link..." : "Forgot Password?"}
                  </button>
                </div>
                <Button type="submit" disabled={isLoading} data-testid="button-signin" className="h-14 w-full rounded-[1rem] border-[#34404d] bg-[#34404d] text-[1.1rem] font-semibold tracking-[-0.03em] text-white shadow-none hover:bg-[#2a3440]">
                  {isLoading ? <span className="inline-flex items-center gap-2"><Loader2 className="h-4.5 w-4.5 animate-spin" />Signing in...</span> : "Sign in"}
                </Button>
                <div className="space-y-6 pt-1">
                  <DividerLabel />
                  <div className="space-y-4">
                    <button type="button" onClick={() => handleComingSoonAuth("Google")} className="flex h-14 w-full items-center justify-center gap-3 rounded-[999px] border border-[#d8dde5] bg-white px-5 text-[1rem] font-medium text-slate-600 shadow-none transition hover:border-slate-300 hover:text-slate-900">
                      <SocialBadge tone="bg-[conic-gradient(from_210deg_at_50%_50%,#4285f4_0deg,#34a853_120deg,#fbbc05_220deg,#ea4335_320deg,#4285f4_360deg)] text-white">G</SocialBadge>
                      <span>Continue with Google</span>
                    </button>
                    <button type="button" onClick={() => handleComingSoonAuth("Facebook")} className="flex h-14 w-full items-center justify-center gap-3 rounded-[999px] border border-[#d8dde5] bg-white px-5 text-[1rem] font-medium text-slate-600 shadow-none transition hover:border-slate-300 hover:text-slate-900">
                      <SocialBadge tone="bg-[#1877f2] text-white">f</SocialBadge>
                      <span>Continue with Facebook</span>
                    </button>
                  </div>
                </div>
              </form>
            </Form>
          </div>
        </section>
      </div>
    </div>
  );
}
