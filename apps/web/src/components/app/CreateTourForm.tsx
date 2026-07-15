"use client";

import { Building2, LoaderCircle, Plus, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

type ListingForm = {
  title: string;
  listingType: "SALE" | "RENT";
  addressLine1: string;
  city: string;
  region: string;
  country: string;
  currency: string;
  listPrice: string;
  bedrooms: string;
  bathrooms: string;
  sqft: string;
};

const initialForm: ListingForm = {
  title: "",
  listingType: "SALE",
  addressLine1: "",
  city: "",
  region: "",
  country: "",
  currency: "USD",
  listPrice: "",
  bedrooms: "",
  bathrooms: "",
  sqft: "",
};

function optionalNumber(value: string) {
  return value.trim() ? Number(value) : undefined;
}

export function CreateTourForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<ListingForm>(initialForm);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function update<K extends keyof ListingForm>(key: K, value: ListingForm[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/tours", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: `${form.title.trim()} - Virtual Tour`,
          propertyTitle: form.title.trim(),
          listingType: form.listingType,
          addressLine1: form.addressLine1.trim() || undefined,
          city: form.city.trim() || undefined,
          region: form.region.trim() || undefined,
          country: form.country.trim() || undefined,
          currency: form.currency.trim().toUpperCase(),
          listPrice: optionalNumber(form.listPrice),
          bedrooms: optionalNumber(form.bedrooms),
          bathrooms: optionalNumber(form.bathrooms),
          sqft: optionalNumber(form.sqft),
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error ?? "Could not create listing");
      setForm(initialForm);
      setOpen(false);
      router.push(`/app/tours/${data.tour.id}?capture=1`);
      router.refresh();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Could not create listing");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex h-10 items-center gap-2 rounded-lg bg-ink-950 px-4 text-sm font-bold text-white hover:bg-ink-800"
      >
        <Plus size={16} aria-hidden="true" />
        New listing
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/55 p-0 sm:items-center sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Create listing"
        >
          <form
            onSubmit={onSubmit}
            className="max-h-[94dvh] w-full max-w-2xl overflow-y-auto rounded-t-lg bg-white shadow-panel sm:rounded-lg"
          >
            <header className="flex items-start justify-between border-b border-ink-900/10 p-5 sm:p-6">
              <div className="flex items-start gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-100 text-emerald-800">
                  <Building2 size={19} aria-hidden="true" />
                </span>
                <div>
                  <p className="text-xs font-bold uppercase text-emerald-700">New property</p>
                  <h2 className="mt-0.5 text-xl font-semibold text-ink-950">Create a listing</h2>
                  <p className="mt-1 text-sm text-ink-500">You will capture the first room next.</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="flex h-9 w-9 items-center justify-center rounded-lg text-ink-500 hover:bg-ink-100"
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </header>

            <div className="space-y-5 p-5 sm:p-6">
              <div>
                <label htmlFor="listing-title" className="text-sm font-semibold text-ink-800">
                  Listing name
                </label>
                <input
                  id="listing-title"
                  required
                  minLength={2}
                  value={form.title}
                  onChange={(event) => update("title", event.target.value)}
                  placeholder="e.g. Ridgeview Apartment 4B"
                  autoFocus
                  className="mt-2 h-11 w-full rounded-lg border border-ink-900/15 bg-white px-3 text-sm outline-none ring-emerald-600/20 focus:border-emerald-600 focus:ring-2"
                />
              </div>

              <fieldset>
                <legend className="text-sm font-semibold text-ink-800">Listing type</legend>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  {(["SALE", "RENT"] as const).map((type) => (
                    <button
                      key={type}
                      type="button"
                      onClick={() => update("listingType", type)}
                      className={`h-10 rounded-lg border text-sm font-bold ${form.listingType === type ? "border-ink-950 bg-ink-950 text-white" : "border-ink-900/15 bg-white text-ink-700 hover:bg-ink-100"}`}
                    >
                      For {type === "SALE" ? "sale" : "rent"}
                    </button>
                  ))}
                </div>
              </fieldset>

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="text-sm font-semibold text-ink-800 sm:col-span-2">
                  Street address
                  <input value={form.addressLine1} onChange={(event) => update("addressLine1", event.target.value)} placeholder="42 Maple Avenue" className="mt-2 h-11 w-full rounded-lg border border-ink-900/15 px-3 text-sm font-normal outline-none ring-emerald-600/20 focus:border-emerald-600 focus:ring-2" />
                </label>
                <label className="text-sm font-semibold text-ink-800">
                  City
                  <input value={form.city} onChange={(event) => update("city", event.target.value)} className="mt-2 h-11 w-full rounded-lg border border-ink-900/15 px-3 text-sm font-normal outline-none ring-emerald-600/20 focus:border-emerald-600 focus:ring-2" />
                </label>
                <label className="text-sm font-semibold text-ink-800">
                  State or region
                  <input value={form.region} onChange={(event) => update("region", event.target.value)} className="mt-2 h-11 w-full rounded-lg border border-ink-900/15 px-3 text-sm font-normal outline-none ring-emerald-600/20 focus:border-emerald-600 focus:ring-2" />
                </label>
                <label className="text-sm font-semibold text-ink-800 sm:col-span-2">
                  Country
                  <input value={form.country} onChange={(event) => update("country", event.target.value)} className="mt-2 h-11 w-full rounded-lg border border-ink-900/15 px-3 text-sm font-normal outline-none ring-emerald-600/20 focus:border-emerald-600 focus:ring-2" />
                </label>
              </div>

              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <label className="text-sm font-semibold text-ink-800">
                  Currency
                  <input value={form.currency} maxLength={3} onChange={(event) => update("currency", event.target.value)} className="mt-2 h-11 w-full rounded-lg border border-ink-900/15 px-3 text-sm font-normal uppercase outline-none ring-emerald-600/20 focus:border-emerald-600 focus:ring-2" />
                </label>
                <label className="text-sm font-semibold text-ink-800 sm:col-span-3">
                  Price
                  <input type="number" min="0" step="0.01" value={form.listPrice} onChange={(event) => update("listPrice", event.target.value)} className="mt-2 h-11 w-full rounded-lg border border-ink-900/15 px-3 text-sm font-normal outline-none ring-emerald-600/20 focus:border-emerald-600 focus:ring-2" />
                </label>
                <label className="text-sm font-semibold text-ink-800">
                  Beds
                  <input type="number" min="0" step="1" value={form.bedrooms} onChange={(event) => update("bedrooms", event.target.value)} className="mt-2 h-11 w-full rounded-lg border border-ink-900/15 px-3 text-sm font-normal outline-none ring-emerald-600/20 focus:border-emerald-600 focus:ring-2" />
                </label>
                <label className="text-sm font-semibold text-ink-800">
                  Baths
                  <input type="number" min="0" step="0.5" value={form.bathrooms} onChange={(event) => update("bathrooms", event.target.value)} className="mt-2 h-11 w-full rounded-lg border border-ink-900/15 px-3 text-sm font-normal outline-none ring-emerald-600/20 focus:border-emerald-600 focus:ring-2" />
                </label>
                <label className="text-sm font-semibold text-ink-800 sm:col-span-2">
                  Area (sq ft)
                  <input type="number" min="0" step="1" value={form.sqft} onChange={(event) => update("sqft", event.target.value)} className="mt-2 h-11 w-full rounded-lg border border-ink-900/15 px-3 text-sm font-normal outline-none ring-emerald-600/20 focus:border-emerald-600 focus:ring-2" />
                </label>
              </div>

              {error ? <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}
            </div>

            <footer className="flex items-center justify-end gap-2 border-t border-ink-900/10 p-4 sm:px-6">
              <button type="button" onClick={() => setOpen(false)} className="h-10 rounded-lg px-4 text-sm font-semibold text-ink-600 hover:bg-ink-100">Cancel</button>
              <button type="submit" disabled={loading} className="inline-flex h-10 items-center gap-2 rounded-lg bg-ink-950 px-4 text-sm font-bold text-white hover:bg-ink-800 disabled:opacity-50">
                {loading ? <LoaderCircle className="animate-spin" size={16} /> : <Plus size={16} />}
                {loading ? "Creating" : "Create and scan"}
              </button>
            </footer>
          </form>
        </div>
      ) : null}
    </>
  );
}
