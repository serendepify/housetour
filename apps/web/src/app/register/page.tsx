"use client";

import Link from "next/link";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function RegisterPage() {
  const router = useRouter();
  const [form, setForm] = useState({
    name: "",
    email: "",
    password: "",
    organizationName: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const res = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setLoading(false);
      setError(data.error ?? "Registration failed");
      return;
    }
    const login = await signIn("credentials", {
      email: form.email,
      password: form.password,
      redirect: false,
    });
    setLoading(false);
    if (login?.error) {
      router.push("/login");
      return;
    }
    router.push("/app");
    router.refresh();
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-md rounded-3xl border border-white/10 bg-ink-900/80 p-8 shadow-panel">
        <Link href="/" className="text-xs uppercase tracking-[0.2em] text-gold-300">
          HouseTour
        </Link>
        <h1 className="mt-3 font-display text-3xl text-white">Create agency workspace</h1>
        <p className="mt-2 text-sm text-white/55">Start on the Starter plan. Upgrade anytime.</p>
        <form onSubmit={onSubmit} className="mt-8 space-y-4">
          {(
            [
              ["organizationName", "Agency name", "text"],
              ["name", "Your name", "text"],
              ["email", "Work email", "email"],
              ["password", "Password", "password"],
            ] as const
          ).map(([key, label, type]) => (
            <label key={key} className="block text-sm">
              <span className="text-white/70">{label}</span>
              <input
                type={type}
                required
                minLength={key === "password" ? 8 : undefined}
                value={form[key]}
                onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
                className="mt-1 w-full rounded-xl border border-white/10 bg-ink-950 px-3 py-2.5 text-white outline-none ring-gold-500/40 focus:ring-2"
              />
            </label>
          ))}
          {error ? <p className="text-sm text-red-300">{error}</p> : null}
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-full bg-gold-500 py-2.5 text-sm font-semibold text-ink-950 hover:bg-gold-400 disabled:opacity-60"
          >
            {loading ? "Creating…" : "Create workspace"}
          </button>
        </form>
        <p className="mt-6 text-center text-sm text-white/50">
          Already have an account?{" "}
          <Link href="/login" className="text-gold-300 hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
