"use client";

import { useState } from "react";

export function BillingActions({
  planCode,
  isCurrent,
  stripeReady,
}: {
  planCode: string;
  isCurrent: boolean;
  stripeReady: boolean;
}) {
  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function checkout() {
    setLoading(true);
    setMsg(null);
    const res = await fetch("/api/billing/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ planCode }),
    });
    const data = await res.json().catch(() => ({}));
    setLoading(false);
    if (!res.ok) {
      setMsg(data.error ?? "Checkout unavailable");
      return;
    }
    if (data.url) {
      window.location.href = data.url;
      return;
    }
    setMsg(data.message ?? "Plan updated locally");
  }

  async function portal() {
    setLoading(true);
    const res = await fetch("/api/billing/portal", { method: "POST" });
    const data = await res.json().catch(() => ({}));
    setLoading(false);
    if (data.url) window.location.href = data.url;
    else setMsg(data.error ?? "Portal unavailable");
  }

  return (
    <div className="mt-5 space-y-2">
      {isCurrent ? (
        <button
          type="button"
          disabled
          className="w-full rounded-full bg-ink-100 py-2 text-sm font-semibold text-ink-500"
        >
          Current plan
        </button>
      ) : (
        <button
          type="button"
          disabled={loading}
          onClick={checkout}
          className="w-full rounded-full bg-ink-950 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {stripeReady ? "Upgrade with Stripe" : "Select plan (local)"}
        </button>
      )}
      {isCurrent && stripeReady ? (
        <button
          type="button"
          disabled={loading}
          onClick={portal}
          className="w-full rounded-full border border-ink-900/15 py-2 text-sm font-semibold"
        >
          Customer portal
        </button>
      ) : null}
      {msg ? <p className="text-xs text-ink-500">{msg}</p> : null}
    </div>
  );
}
