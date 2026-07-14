"use client";

import Link from "next/link";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("agent@housetour.demo");
  const [password, setPassword] = useState("housetour-demo");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const res = await signIn("credentials", {
      email,
      password,
      redirect: false,
    });
    setLoading(false);
    if (res?.error) {
      setError("Invalid email or password");
      return;
    }
    router.push("/app");
    router.refresh();
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-md rounded-3xl border border-white/10 bg-ink-900/80 p-8 shadow-panel">
        <Link href="/" className="text-xs uppercase tracking-[0.2em] text-gold-300">
          HouseTour
        </Link>
        <h1 className="mt-3 font-display text-3xl text-white">Sign in</h1>
        <p className="mt-2 text-sm text-white/55">
          Demo: agent@housetour.demo / housetour-demo
        </p>
        <form onSubmit={onSubmit} className="mt-8 space-y-4">
          <label className="block text-sm">
            <span className="text-white/70">Email</span>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 w-full rounded-xl border border-white/10 bg-ink-950 px-3 py-2.5 text-white outline-none ring-gold-500/40 focus:ring-2"
            />
          </label>
          <label className="block text-sm">
            <span className="text-white/70">Password</span>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 w-full rounded-xl border border-white/10 bg-ink-950 px-3 py-2.5 text-white outline-none ring-gold-500/40 focus:ring-2"
            />
          </label>
          {error ? <p className="text-sm text-red-300">{error}</p> : null}
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-full bg-gold-500 py-2.5 text-sm font-semibold text-ink-950 hover:bg-gold-400 disabled:opacity-60"
          >
            {loading ? "Signing in…" : "Sign in"}
          </button>
        </form>
        <p className="mt-6 text-center text-sm text-white/50">
          New agency?{" "}
          <Link href="/register" className="text-gold-300 hover:underline">
            Create workspace
          </Link>
        </p>
      </div>
    </div>
  );
}
