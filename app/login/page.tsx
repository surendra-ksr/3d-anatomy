"use client";

/**
 * /login — Email & password sign-in / registration (NextAuth credentials
 * provider, JWT session). Multi-tenant: every account gets its own isolated
 * symptom + activity data.
 */
import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";

import { LowStimProvider, useLowStim } from "@/lib/low-stim";

function LoginBody() {
  const router = useRouter();
  const search = useSearchParams();
  const { lowStim, t } = useLowStim();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const border = { borderColor: lowStim ? "#fff" : "rgba(255,255,255,0.14)" } as const;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === "register") {
        const res = await fetch("/api/auth/register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password, name }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error ?? `registration failed (${res.status})`);
        }
      }
      const result = await signIn("credentials", {
        redirect: false,
        email,
        password,
      });
      if (!result?.ok) {
        throw new Error(
          mode === "login"
            ? "wrong email or password"
            : "account created but sign-in failed — try again",
        );
      }
      router.push(search.get("from") ?? "/");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main
      className="flex min-h-dvh items-center justify-center p-6"
      style={{ background: lowStim ? "#000" : "radial-gradient(ellipse at 50% 20%, #1c2434 0%, #0b0f17 70%)" }}
    >
      <div
        className="w-full max-w-sm rounded-2xl border p-6 shadow-2xl"
        style={{
          background: lowStim ? "#000" : "#0f172af5",
          borderColor: lowStim ? "#fff" : "rgba(255,255,255,0.14)",
          borderWidth: lowStim ? 2 : 1,
          color: lowStim ? "#fff" : "#e2e8f0",
        }}
      >
        <h1 className="text-lg font-semibold tracking-tight">
          {mode === "login" ? "Sign in" : "Create your account"}
        </h1>
        <p className="mt-1 text-[12px] opacity-70">
          Interactive Anatomy Engine — your symptom data is private to your
          account.
        </p>

        <form onSubmit={submit} className="mt-5 space-y-3">
          {mode === "register" && (
            <label className="block text-[12px]">
              <span className="block text-[10px] font-semibold uppercase tracking-wider opacity-70">
                {t("Display name")} <span className="normal-case opacity-50">(optional)</span>
              </span>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="name"
                className="mt-1 w-full rounded-md border bg-transparent px-3 py-2 text-sm focus:outline-none"
                style={border}
              />
            </label>
          )}
          <label className="block text-[12px]">
            <span className="block text-[10px] font-semibold uppercase tracking-wider opacity-70">
              Email
            </span>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              className="mt-1 w-full rounded-md border bg-transparent px-3 py-2 text-sm focus:outline-none"
              style={border}
            />
          </label>
          <label className="block text-[12px]">
            <span className="block text-[10px] font-semibold uppercase tracking-wider opacity-70">
              Password
              {mode === "register" && (
                <span className="normal-case opacity-50"> (min 8 characters)</span>
              )}
            </span>
            <input
              type="password"
              required
              minLength={mode === "register" ? 8 : undefined}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              className="mt-1 w-full rounded-md border bg-transparent px-3 py-2 text-sm focus:outline-none"
              style={border}
            />
          </label>

          {error && (
            <p className="rounded-md bg-red-950/80 px-3 py-2 text-[12px] text-red-300">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-md bg-sky-600 py-2.5 text-sm font-semibold text-white hover:bg-sky-500 disabled:opacity-50"
            style={lowStim ? { border: "2px solid #fff" } : undefined}
          >
            {busy
              ? "…"
              : mode === "login"
                ? t("Sign in")
                : t("Create account & sign in")}
          </button>
        </form>

        <p className="mt-4 text-center text-[12px] opacity-80">
          {mode === "login" ? "New here?" : "Already have an account?"}{" "}
          <button
            onClick={() => {
              setMode(mode === "login" ? "register" : "login");
              setError(null);
            }}
            className="font-semibold text-sky-400 hover:underline"
          >
            {mode === "login" ? t("Create an account") : t("Sign in")}
          </button>
        </p>

        <p className="mt-4 border-t pt-3 text-center text-[10px] leading-snug opacity-50" style={border}>
          Self-tracked ME/CFS &amp; fibromyalgia data ·{" "}
          <Link href="https://lifesciencedb.jp/bp3d/?lng=en" target="_blank" className="underline">
            BodyParts3D
          </Link>{" "}
          / FMA · not a medical device
        </p>
      </div>
    </main>
  );
}

export default function LoginPage() {
  return (
    <LowStimProvider>
      <Suspense fallback={null}>
        <LoginBody />
      </Suspense>
    </LowStimProvider>
  );
}
