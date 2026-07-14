"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function CreateTourForm() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const res = await fetch("/api/tours", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, propertyTitle: title }),
    });
    const data = await res.json().catch(() => ({}));
    setLoading(false);
    if (!res.ok) {
      setError(data.error ?? "Could not create tour");
      return;
    }
    setTitle("");
    router.push(`/app/tours/${data.tour.id}`);
    router.refresh();
  }

  return (
    <form
      onSubmit={onSubmit}
      className="flex flex-col gap-3 rounded-2xl border border-ink-900/10 bg-white p-4 shadow-soft md:flex-row md:items-end"
    >
      <label className="block flex-1 text-sm">
        <span className="text-ink-500">New tour title</span>
        <input
          required
          minLength={2}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. 42 Maple Ave — Full walkthrough"
          className="mt-1 w-full rounded-xl border border-ink-900/10 bg-mist px-3 py-2.5 outline-none ring-gold-500/30 focus:ring-2"
        />
      </label>
      <button
        type="submit"
        disabled={loading}
        className="rounded-full bg-gold-500 px-5 py-2.5 text-sm font-semibold text-ink-950 hover:bg-gold-400 disabled:opacity-60"
      >
        {loading ? "Creating…" : "Create tour"}
      </button>
      {error ? <p className="text-sm text-red-600 md:basis-full">{error}</p> : null}
    </form>
  );
}
