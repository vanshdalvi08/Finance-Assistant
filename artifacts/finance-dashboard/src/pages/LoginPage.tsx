import { useState } from "react";
import { useLocation } from "wouter";
import rigImage from "@/assets/images/rig.png";
import { requestPasswordReset } from "@/auth/auth-service";
import { useToast } from "@/hooks/use-toast";
import { useAuthStore } from "@/store/auth";

function resolveWorkspace(role: "admin" | "employee" | "client" | "platform_super_admin") {
  if (role === "platform_super_admin") return "/platform/dashboard";
  if (role === "client") return "/client/pre-approvals";
  return role === "admin" ? "/" : "/employee/timesheet";
}

export default function LoginPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const login = useAuthStore((state) => state.login);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isResetting, setIsResetting] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsLoading(true);

    try {
      const session = await login({ email, password });
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

  async function handleForgotPassword() {
    const trimmedEmail = email.trim();

    if (!trimmedEmail) {
      toast({
        title: "Enter your email first",
        description: "We need the account email to send a reset link.",
        variant: "destructive",
      });
      return;
    }

    setIsResetting(true);

    try {
      await requestPasswordReset({ email: trimmedEmail });
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

  function handleCreateAccount() {
    toast({
      title: "Account creation is admin-managed",
      description: "Ask your tenant administrator or platform team to create your account.",
    });
  }

  function handleComingSoonAuth(provider: string) {
    toast({
      title: `${provider} sign in is not configured`,
      description: "Use your work email and password for now. We can wire SSO later.",
    });
  }

  return (
    <div className="flex h-screen w-full overflow-hidden bg-white font-sans">
      <section className="relative h-screen w-[70%] overflow-hidden bg-[#34404d] text-white">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_16%_15%,rgba(255,255,255,0.05),transparent_20%),linear-gradient(180deg,rgba(255,255,255,0.015),rgba(255,255,255,0)_20%)]" />
        <div className="absolute inset-x-0 bottom-0 h-[27%] bg-[#0a2960]" />
        <div className="absolute inset-x-0 bottom-[27%] h-px bg-white/6" />

        <div className="relative z-10 h-full pb-[360px] pl-20 pt-20">
          <div className="leading-none">
            <div className="flex items-start gap-1">
              <span className="text-[100px] font-black tracking-[-0.085em]">REFORIX</span>
              <span className="pt-2 text-[28px] font-semibold tracking-[-0.02em]">TM</span>
            </div>
            <p className="mt-2 text-[66px] font-semibold tracking-[-0.055em]">Payroll</p>
          </div>

          <div className="mt-[168px] max-w-[480px]">
            <h1 className="text-[84px] font-black leading-[0.95] tracking-[-0.075em]">Welcome Back!</h1>
            <p className="mt-5 text-[34px] font-semibold leading-[1.05] tracking-[-0.055em]">
              Manage payroll and workforce with confidence.
            </p>
          </div>
        </div>

        <img
          src={rigImage}
          alt=""
          className="pointer-events-none absolute bottom-0 left-0 w-full object-contain object-left-bottom"
        />
      </section>

      <section className="flex h-screen w-[30%] items-center justify-center bg-white px-10">
        <div className="w-[380px]">
          <div className="mb-10 text-center">
            <h2 className="text-[58px] font-black leading-[0.95] tracking-[-0.06em] text-black">
              Enter Your Credentials
            </h2>
            <p className="mt-4 text-[16px] font-medium text-[#7b8591]">
              Don&apos;t have an account?{" "}
              <button
                type="button"
                onClick={handleCreateAccount}
                className="font-semibold text-black underline decoration-black/40 underline-offset-4"
              >
                Create now
              </button>
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <label htmlFor="email" className="mb-3 block text-[18px] font-semibold text-black">
                E-mail
              </label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="example@gmail.com"
                className="h-14 w-full rounded-[16px] border border-[#d7dde6] bg-white px-5 text-[16px] font-medium text-black outline-none placeholder:text-[#8e97a3]"
                required
              />
            </div>

            <div>
              <label htmlFor="password" className="mb-3 block text-[18px] font-semibold text-black">
                Password
              </label>
              <div className="relative">
                <input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="******"
                  className="h-14 w-full rounded-[16px] border border-[#d7dde6] bg-white px-5 pr-14 text-[16px] font-medium text-black outline-none placeholder:text-[#8e97a3]"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((current) => !current)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-[#8e97a3]"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? (
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <path d="M3 3L21 21" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                      <path d="M10.58 10.58A2 2 0 0 0 13.41 13.41" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                      <path d="M9.88 5.09A10.94 10.94 0 0 1 12 4.91C17 4.91 21 12 21 12A20.8 20.8 0 0 1 16.84 17.19" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                      <path d="M6.71 6.7A20.66 20.66 0 0 0 3 12S7 19.09 12 19.09A10.94 10.94 0 0 0 14.12 18.91" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  ) : (
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <path d="M1 12S5 4.91 12 4.91 23 12 23 12 19 19.09 12 19.09 1 12 1 12Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="2" />
                    </svg>
                  )}
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between text-[16px] text-[#7b8591]">
              <label className="flex items-center gap-3 font-medium">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(event) => setRememberMe(event.target.checked)}
                  className="h-[18px] w-[18px] rounded-[4px] border border-[#cfd6de]"
                />
                <span>Remember me</span>
              </label>

              <button
                type="button"
                onClick={handleForgotPassword}
                disabled={isResetting}
                className="font-medium text-black disabled:text-[#9aa3ae]"
              >
                {isResetting ? "Sending reset link..." : "Forgot Password?"}
              </button>
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="h-12 w-full rounded-[16px] bg-[#34404d] text-[18px] font-semibold text-white"
            >
              {isLoading ? "Signing in..." : "Sign in"}
            </button>

            <div className="flex items-center gap-4 text-[13px] font-medium uppercase tracking-[0.22em] text-[#98a1ac]">
              <span className="h-px flex-1 bg-[#d9dfe6]" />
              <span>OR</span>
              <span className="h-px flex-1 bg-[#d9dfe6]" />
            </div>

            <div className="space-y-4">
              <button
                type="button"
                onClick={() => handleComingSoonAuth("Google")}
                className="flex h-14 w-full items-center justify-center gap-3 rounded-full border border-[#d7dde6] bg-white text-[18px] font-medium text-[#697280]"
              >
                <span className="text-[22px] font-semibold text-[#ea4335]">G</span>
                <span>Continue with Google</span>
              </button>

              <button
                type="button"
                onClick={() => handleComingSoonAuth("Facebook")}
                className="flex h-14 w-full items-center justify-center gap-3 rounded-full border border-[#d7dde6] bg-white text-[18px] font-medium text-[#697280]"
              >
                <span className="text-[24px] font-semibold text-[#1877f2]">f</span>
                <span>Continue with Facebook</span>
              </button>
            </div>
          </form>
        </div>
      </section>
    </div>
  );
}
