import React, { useState } from "react";
import { motion } from "framer-motion";
import { useLocation } from "wouter";
import RigVector from "@/assets/images/login-rig.png";
import RigVectorTwo from "@/assets/images/2 image.png";
import RigVectorThree from "@/assets/images/3 image.png";
import { useAuthStore } from "@/store/auth";
import { verifyMfaChallenge } from "@/auth/auth-service";
import type { MfaChallenge } from "@/auth/types";

const heroVectors = [RigVector, RigVectorTwo, RigVectorThree];
const heroVectorClasses = [
  "left-[-3%] w-[130%] max-w-[950px]",
  "left-[-0%] w-[100%] max-w-[1050px]",
  "left-[-6%] w-[112%] max-w-[1050px]",
];

const heroCopy = [
  "Smarter workforce management starts here.",
  "Hope you're having a great day, let's get started.",
];

const VECTOR_STORAGE_KEY = "login.hero.vector.index";
const COPY_STORAGE_KEY = "login.hero.copy.index";

function getInitialVectorIndex() {
  if (typeof window === "undefined") {
    return 0;
  }

  try {
    const previous = window.localStorage.getItem(VECTOR_STORAGE_KEY);
    const previousIndex = previous ? Number(previous) : -1;
    const candidates = heroVectors.map((_, index) => index).filter((index) => index !== previousIndex);
    const nextIndex = candidates[Math.floor(Math.random() * candidates.length)] ?? 0;
    window.localStorage.setItem(VECTOR_STORAGE_KEY, String(nextIndex));
    return nextIndex;
  } catch {
    return Math.floor(Math.random() * heroVectors.length);
  }
}

function getInitialCopyIndex() {
  if (typeof window === "undefined") {
    return 0;
  }

  try {
    const previous = window.localStorage.getItem(COPY_STORAGE_KEY);
    const previousIndex = previous ? Number(previous) : -1;
    const candidates = heroCopy.map((_, index) => index).filter((index) => index !== previousIndex);
    const nextIndex = candidates[Math.floor(Math.random() * candidates.length)] ?? 0;
    window.localStorage.setItem(COPY_STORAGE_KEY, String(nextIndex));
    return nextIndex;
  } catch {
    return Math.floor(Math.random() * heroCopy.length);
  }
}

const LoginPage = () => {
  const [showPassword, setShowPassword] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [mfaChallenge, setMfaChallenge] = useState<MfaChallenge | null>(null);
  const [mfaCode, setMfaCode] = useState("");
  const [rememberDevice, setRememberDevice] = useState(true);
  const [selectedVectorIndex] = useState(getInitialVectorIndex);
  const [selectedCopyIndex] = useState(getInitialCopyIndex);
  const login = useAuthStore((state) => state.login);
  const loginWithSession = useAuthStore((state) => state.loginWithSession);
  const [, setLocation] = useLocation();

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (isSubmitting) {
      return;
    }

    setSubmitError(null);
    setIsSubmitting(true);

    try {
      if (mfaChallenge) {
        const session = await verifyMfaChallenge({
          mfaToken: mfaChallenge.mfaToken,
          code: mfaCode,
          rememberDevice,
        });
        loginWithSession(session);
        switch (session.user.role) {
          case "employee":
            setLocation("/employee/timesheet");
            break;
          case "client":
            setLocation("/client/pre-approvals");
            break;
          case "platform_super_admin":
            setLocation("/platform/dashboard");
            break;
          default:
            setLocation("/");
            break;
        }
        return;
      }

      const session = await login({
        email: email.trim(),
        password,
      });

      if ("mfaRequired" in session) {
        setMfaChallenge(session);
        setMfaCode("");
        setRememberDevice(true);
        return;
      }

      switch (session.user.role) {
        case "employee":
          setLocation("/employee/timesheet");
          break;
        case "client":
          setLocation("/client/pre-approvals");
          break;
        case "platform_super_admin":
          setLocation("/platform/dashboard");
          break;
        default:
          setLocation("/");
          break;
      }
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "Sign in failed.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen w-full overflow-hidden bg-white font-sans">
      <section className="relative hidden w-[60%] flex-col justify-between overflow-hidden bg-[#2c353f] pt-12 pl-12 lg:flex">
        <div className="relative z-10">
          <h2 className="text-[28px] font-bold leading-none tracking-wide text-white">
            REFORIX<span className="ml-0.5 align-text-top text-[12px] font-normal">TM</span>
          </h2>
          <p className="mt-1 text-[22px] font-semibold text-white">Payroll</p>
        </div>

        <div className="relative z-10 mb-auto mt-20">
          <h1 className="mb-3 text-[42px] font-bold leading-tight text-white">Welcome Back!</h1>
          <p className="max-w-[400px] text-[28px] font-bold leading-snug text-white">
            {heroCopy[selectedCopyIndex]}
          </p>
        </div>

        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[72%] overflow-hidden">
          <motion.img
            key={selectedVectorIndex}
            src={heroVectors[selectedVectorIndex]}
            alt="Rig vector"
            aria-hidden="true"
            initial={{ y: 120, opacity: 0, scale: 0.98 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
            className={`absolute bottom-0 object-contain object-left-bottom ${heroVectorClasses[selectedVectorIndex]}`}
          />
        </div>
      </section>

      <section className="flex w-full flex-col items-center justify-center bg-[#f7f8fa] p-8 lg:w-[40%]">
        <div className="w-full max-w-[372px]">
          <div className="mb-8">
            <h2 className="mb-1 text-[28px] font-bold text-black">
              {mfaChallenge ? "Verify Your Login" : "Enter Your Credentials"}
            </h2>
            <div className="flex justify-end">
              <p className="text-[10px] text-gray-500">
                Don&apos;t have an account?{" "}
                <button
                  type="button"
                  className="ml-0.5 border-b border-black font-bold leading-none text-black hover:underline"
                >
                  Create now
                </button>
              </p>
            </div>
          </div>

          <form className="space-y-5" onSubmit={handleSubmit}>
            {submitError ? (
              <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-700">
                {submitError}
              </p>
            ) : null}

            {!mfaChallenge ? (
              <>
                <div>
                  <label className="mb-2 block text-[13px] font-bold text-black" htmlFor="email">
                    E-mail
                  </label>
                  <input
                    id="email"
                    type="email"
                    placeholder="example@gmail.com"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    autoComplete="username"
                    required
                    className="w-full rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm text-gray-900 caret-gray-900 placeholder:text-gray-400 transition-colors focus:border-[#2c353f] focus:outline-none"
                    style={{ WebkitTextFillColor: "rgb(17 24 39)" }}
                  />
                </div>

                <div>
                  <label className="mb-2 block text-[13px] font-bold text-black" htmlFor="password">
                    Password
                  </label>
                  <div className="relative">
                    <input
                      id="password"
                      type={showPassword ? "text" : "password"}
                      placeholder="********"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      autoComplete="current-password"
                      required
                      className="w-full rounded-lg border border-gray-300 bg-white px-4 py-2.5 pr-12 text-sm tracking-widest text-gray-900 caret-gray-900 placeholder:text-gray-400 transition-colors focus:border-[#2c353f] focus:outline-none"
                      style={{ WebkitTextFillColor: "rgb(17 24 39)" }}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400"
                      aria-label={showPassword ? "Hide password" : "Show password"}
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        fill="none"
                        viewBox="0 0 24 24"
                        strokeWidth={1.5}
                        stroke="currentColor"
                        className="h-4 w-4"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z"
                        />
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                        />
                      </svg>
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <>
                {mfaChallenge.mfaSetupRequired ? (
                  <div className="rounded-lg border border-gray-200 bg-white px-4 py-3 text-[12px] text-gray-600">
                    <p className="font-semibold text-gray-900">Set up your authenticator app</p>
                    <p className="mt-1">
                      Add a new account in your authenticator app using this key, then enter the 6-digit code below.
                    </p>
                    {mfaChallenge.mfaSecret ? (
                      <div className="mt-2 rounded-md border border-gray-200 bg-gray-50 px-3 py-2 font-mono text-[12px] text-gray-900">
                        {mfaChallenge.mfaSecret}
                      </div>
                    ) : null}
                  </div>
                ) : null}

                <div>
                  <label className="mb-2 block text-[13px] font-bold text-black" htmlFor="mfa-code">
                    Authenticator code
                  </label>
                  <input
                    id="mfa-code"
                    type="text"
                    inputMode="numeric"
                    placeholder="123456"
                    value={mfaCode}
                    onChange={(event) => setMfaCode(event.target.value)}
                    required
                    className="w-full rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm text-gray-900 caret-gray-900 placeholder:text-gray-400 transition-colors focus:border-[#2c353f] focus:outline-none"
                    style={{ WebkitTextFillColor: "rgb(17 24 39)" }}
                  />
                </div>

                <div className="flex items-center justify-between pb-2 pt-1">
                  <label className="flex cursor-pointer items-center text-[11px] text-gray-500">
                    <input
                      type="checkbox"
                      checked={rememberDevice}
                      onChange={(event) => setRememberDevice(event.target.checked)}
                      className="mr-2 h-3 w-3 rounded border-gray-300"
                    />
                    Remember this device for 7 days
                  </label>
                  <button
                    type="button"
                    className="text-[11px] font-medium text-black hover:underline"
                    onClick={() => {
                      setMfaChallenge(null);
                      setMfaCode("");
                    }}
                  >
                    Back to login
                  </button>
                </div>
              </>
            )}

            {!mfaChallenge ? (
              <div className="flex items-center justify-between pb-2 pt-1">
                <label className="flex cursor-pointer items-center text-[11px] text-gray-500">
                  <input type="checkbox" className="mr-2 h-3 w-3 rounded border-gray-300" />
                  Remember me
                </label>
                <button type="button" className="text-[11px] font-medium text-black hover:underline">
                  Forgot Password?
                </button>
              </div>
            ) : null}

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full rounded-lg bg-[#2c353f] py-3 text-[13px] font-bold text-white transition-colors hover:bg-[#1f262d] disabled:cursor-not-allowed disabled:opacity-70"
            >
              {isSubmitting ? "Checking..." : mfaChallenge ? "Verify" : "Sign in"}
            </button>

            {!mfaChallenge ? (
              <>
                <div className="relative flex items-center py-3">
                  <div className="flex-grow border-t border-gray-200" />
                  <span className="mx-4 text-[9px] font-medium text-gray-400">OR</span>
                  <div className="flex-grow border-t border-gray-200" />
                </div>

                <div className="space-y-3">
                  <button
                    type="button"
                    className="flex w-full items-center justify-center gap-2 rounded-full border border-gray-200 py-2.5 transition-colors hover:bg-gray-50"
                  >
                    <img
                      src="https://www.svgrepo.com/show/475656/google-color.svg"
                      className="h-4 w-4"
                      alt="Google"
                    />
                    <span className="text-[12px] font-bold text-gray-600">Continue with Google</span>
                  </button>

                  <button
                    type="button"
                    className="flex w-full items-center justify-center gap-2 rounded-full border border-gray-200 py-2.5 transition-colors hover:bg-gray-50"
                  >
                    <img
                      src="https://www.svgrepo.com/show/475647/facebook-color.svg"
                      className="h-4 w-4"
                      alt="Facebook"
                    />
                    <span className="text-[12px] font-bold text-gray-600">Continue with Facebook</span>
                  </button>
                </div>
              </>
            ) : null}
          </form>
        </div>
      </section>
    </div>
  );
};

export default LoginPage;
