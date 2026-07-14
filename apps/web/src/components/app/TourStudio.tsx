"use client";

import type { TourManifest } from "@housetour/api-contract";
import { TourViewerLazy } from "@/components/tour/TourViewerLazy";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

type StageState = {
  id: string;
  label: string;
  status: "pending" | "running" | "succeeded" | "failed" | "skipped";
  detail?: string;
};

type TourDTO = {
  id: string;
  title: string;
  description: string | null;
  slug: string;
  status: string;
  published: boolean;
  allowVr: boolean;
  allowEmbed: boolean;
  showFloorPlan: boolean;
  failureReason: string | null;
  startSceneId: string | null;
  viewCount: number;
  assets: Array<{
    id: string;
    kind: string;
    filename: string;
    publicUrl: string | null;
    sizeBytes: string;
    sortOrder: number;
  }>;
  scenes: Array<{
    id: string;
    name: string;
    sortOrder: number;
    mediaUrl: string | null;
    kind: string;
    hotspotCount: number;
  }>;
  jobs: Array<{
    id: string;
    type: string;
    status: string;
    progress: number;
    error: string | null;
    createdAt: string;
    stages?: StageState[] | null;
  }>;
};

export function TourStudio({
  tour,
  manifest,
  appUrl,
  allowPhotogrammetry,
}: {
  tour: TourDTO;
  manifest: TourManifest | null;
  appUrl: string;
  allowPhotogrammetry: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [published, setPublished] = useState(tour.published);
  const [processMode, setProcessMode] = useState<"pano" | "photogrammetry">(
    "pano",
  );

  const refresh = useCallback(() => router.refresh(), [router]);

  const activeJob = tour.jobs.find(
    (j) => j.status === "QUEUED" || j.status === "RUNNING",
  );

  useEffect(() => {
    if (!activeJob) return;
    const t1 = setTimeout(refresh, 1500);
    const t2 = setTimeout(refresh, 4000);
    const t3 = setTimeout(refresh, 8000);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
    };
  }, [activeJob?.id, activeJob?.progress, refresh]);

  async function uploadFiles(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    setMessage(null);
    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const lower = file.name.toLowerCase();
        const kind = lower.endsWith(".glb")
          ? "MESH_GLB"
          : file.type.includes("svg") || lower.includes("plan")
            ? "FLOOR_PLAN"
            : lower.includes("multi") || lower.includes("photo")
              ? "MULTI_VIEW"
              : "PANO";
        const contentType =
          file.type ||
          (kind === "MESH_GLB" ? "model/gltf-binary" : "image/jpeg");

        const presignRes = await fetch(`/api/tours/${tour.id}/assets/presign`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            filename: file.name,
            contentType:
              contentType === "image/jpg" ? "image/jpeg" : contentType,
            kind,
            sizeBytes: file.size,
          }),
        });
        const presign = await presignRes.json();
        if (!presignRes.ok) throw new Error(presign.error ?? "Presign failed");

        const put = await fetch(presign.uploadUrl, {
          method: "PUT",
          headers: { "Content-Type": contentType },
          body: file,
        });
        if (!put.ok) throw new Error("Upload to storage failed");

        const completeRes = await fetch(`/api/tours/${tour.id}/assets/complete`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            storageKey: presign.storageKey,
            filename: file.name,
            contentType,
            kind,
            sizeBytes: file.size,
            sortOrder:
              tour.assets.filter(
                (a) => a.kind === "PANO" || a.kind === "MULTI_VIEW",
              ).length + i,
          }),
        });
        const complete = await completeRes.json();
        if (!completeRes.ok) throw new Error(complete.error ?? "Complete failed");
      }
      setMessage(
        `Uploaded ${files.length} file(s). Choose a process mode and run the pipeline.`,
      );
      refresh();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  async function processTour(mode: "pano" | "photogrammetry") {
    setBusy(true);
    setMessage(null);
    const res = await fetch(`/api/tours/${tour.id}/process`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setMessage(data.error ?? "Process failed");
      return;
    }
    setMessage(
      mode === "photogrammetry"
        ? "Photogrammetry pipeline queued — stages will update live."
        : "Pano walk graph queued. Scenes and hotspots appear when ready.",
    );
    refresh();
  }

  async function togglePublish() {
    setBusy(true);
    const next = !published;
    const res = await fetch(`/api/tours/${tour.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ published: next }),
    });
    setBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setMessage(data.error ?? "Could not update publish state");
      return;
    }
    setPublished(next);
    setMessage(next ? "Tour is live." : "Tour unpublished.");
    refresh();
  }

  const embed = `<iframe src="${appUrl}/embed/${tour.slug}" width="100%" height="600" style="border:0;border-radius:16px" allow="xr-spatial-tracking; fullscreen; gyroscope; accelerometer" loading="lazy"></iframe>`;

  const latestStages =
    activeJob?.stages ??
    tour.jobs.find((j) => j.stages && j.stages.length > 0)?.stages ??
    null;

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-3 md:flex-row md:items-start">
        <div>
          <Link
            href="/app"
            className="text-xs font-medium uppercase tracking-wider text-ink-500"
          >
            ← All tours
          </Link>
          <h1 className="mt-1 font-display text-3xl text-ink-950">{tour.title}</h1>
          <p className="text-sm text-ink-500">
            Status <strong>{tour.status}</strong>
            {tour.failureReason ? ` · ${tour.failureReason}` : ""} · {tour.viewCount}{" "}
            views
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-full border border-ink-900/15 bg-white p-0.5 text-xs font-semibold">
            <button
              type="button"
              disabled={busy}
              onClick={() => setProcessMode("pano")}
              className={`rounded-full px-3 py-1.5 transition ${
                processMode === "pano"
                  ? "bg-ink-950 text-white"
                  : "text-ink-600 hover:bg-mist"
              }`}
            >
              Pano walk
            </button>
            <button
              type="button"
              disabled={busy || !allowPhotogrammetry}
              title={
                allowPhotogrammetry
                  ? "Software / COLMAP photogrammetry → mesh + nav"
                  : "Requires Pro or Studio plan"
              }
              onClick={() => setProcessMode("photogrammetry")}
              className={`rounded-full px-3 py-1.5 transition ${
                processMode === "photogrammetry"
                  ? "bg-gold-500 text-ink-950"
                  : "text-ink-600 hover:bg-mist"
              } disabled:opacity-40`}
            >
              Photogrammetry
            </button>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={() => processTour(processMode)}
            className="rounded-full bg-ink-950 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {processMode === "photogrammetry"
              ? "Run photogrammetry"
              : "Process tour"}
          </button>
          <button
            type="button"
            disabled={busy || tour.status !== "READY"}
            onClick={togglePublish}
            className="rounded-full bg-gold-500 px-4 py-2 text-sm font-semibold text-ink-950 disabled:opacity-50"
          >
            {published ? "Unpublish" : "Publish"}
          </button>
          {published && tour.status === "READY" ? (
            <Link
              href={`/t/${tour.slug}`}
              target="_blank"
              className="rounded-full border border-ink-900/15 px-4 py-2 text-sm font-semibold"
            >
              Open public
            </Link>
          ) : null}
        </div>
      </div>

      {message ? (
        <div className="rounded-xl border border-ink-900/10 bg-white px-4 py-3 text-sm text-ink-700 shadow-soft">
          {message}
        </div>
      ) : null}

      {!allowPhotogrammetry ? (
        <div className="rounded-xl border border-gold-500/30 bg-gold-500/10 px-4 py-3 text-sm text-ink-700">
          Photogrammetry (mesh reconstruction) is available on{" "}
          <Link href="/app/billing" className="font-semibold underline">
            Pro &amp; Studio
          </Link>
          . Pano walk processing is included on all plans.
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="space-y-4">
          <div className="rounded-2xl border border-ink-900/10 bg-white p-5 shadow-soft">
            <h2 className="font-display text-xl text-ink-950">Assets</h2>
            <p className="mt-1 text-sm text-ink-500">
              Drop equirectangular 360° JPEGs (and optional floor plan / GLB).
              Ordered panos become a continuous walk graph; photogrammetry also
              builds a reconstructed mesh + point cloud.
            </p>
            <label className="mt-4 flex cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-ink-900/20 bg-mist px-4 py-10 text-center">
              <span className="text-sm font-medium text-ink-800">
                {busy ? "Working…" : "Click or drop 360° / multi-view images"}
              </span>
              <input
                type="file"
                multiple
                accept="image/jpeg,image/png,image/webp,image/svg+xml,.glb"
                className="hidden"
                disabled={busy}
                onChange={(e) => uploadFiles(e.target.files)}
              />
            </label>
            <ul className="mt-4 divide-y divide-ink-900/5">
              {tour.assets.map((a) => (
                <li
                  key={a.id}
                  className="flex items-center justify-between py-2 text-sm"
                >
                  <span>
                    <span className="rounded bg-ink-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-ink-600">
                      {a.kind}
                    </span>{" "}
                    {a.filename}
                  </span>
                  <span className="text-xs text-ink-500">
                    {(Number(a.sizeBytes) / 1024).toFixed(0)} KB
                  </span>
                </li>
              ))}
              {tour.assets.length === 0 ? (
                <li className="py-3 text-sm text-ink-500">No assets yet.</li>
              ) : null}
            </ul>
          </div>

          <div className="rounded-2xl border border-ink-900/10 bg-white p-5 shadow-soft">
            <h2 className="font-display text-xl text-ink-950">Scene graph</h2>
            <ul className="mt-3 space-y-2 text-sm">
              {tour.scenes.map((s) => (
                <li
                  key={s.id}
                  className="flex items-center justify-between rounded-xl bg-mist px-3 py-2"
                >
                  <span className="font-medium">
                    {s.name}
                    <span className="ml-2 text-[10px] uppercase tracking-wider text-ink-400">
                      {s.kind}
                    </span>
                  </span>
                  <span className="text-xs text-ink-500">
                    {s.hotspotCount} hotspots
                  </span>
                </li>
              ))}
              {tour.scenes.length === 0 ? (
                <li className="text-ink-500">Process assets to generate scenes.</li>
              ) : null}
            </ul>
          </div>

          <div className="rounded-2xl border border-ink-900/10 bg-white p-5 shadow-soft">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-xl text-ink-950">Pipeline</h2>
              {activeJob ? (
                <span className="text-xs font-semibold uppercase tracking-wider text-gold-600">
                  {activeJob.progress}% · {activeJob.status}
                </span>
              ) : null}
            </div>

            {latestStages && latestStages.length > 0 ? (
              <ol className="mt-4 space-y-2">
                {latestStages.map((st) => (
                  <li
                    key={st.id}
                    className="flex items-start gap-3 rounded-xl bg-mist px-3 py-2 text-sm"
                  >
                    <span
                      className={`mt-0.5 h-2.5 w-2.5 shrink-0 rounded-full ${
                        st.status === "succeeded"
                          ? "bg-emerald-500"
                          : st.status === "running"
                            ? "animate-pulse bg-gold-500"
                            : st.status === "failed"
                              ? "bg-red-500"
                              : "bg-ink-300"
                      }`}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex justify-between gap-2">
                        <span className="font-medium text-ink-900">{st.label}</span>
                        <span className="text-[10px] uppercase tracking-wider text-ink-400">
                          {st.status}
                        </span>
                      </div>
                      {st.detail ? (
                        <p className="mt-0.5 truncate text-xs text-ink-500">
                          {st.detail}
                        </p>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="mt-3 text-sm text-ink-500">
                Stage progress appears when a process job is running.
              </p>
            )}

            <ul className="mt-4 space-y-2 border-t border-ink-900/5 pt-4 text-sm">
              {tour.jobs.map((j) => (
                <li
                  key={j.id}
                  className="flex justify-between rounded-xl bg-mist px-3 py-2"
                >
                  <span>
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-400">
                      {j.type.replace("tour.", "")}
                    </span>{" "}
                    {j.status} · {j.progress}%
                    {j.error ? ` · ${j.error}` : ""}
                  </span>
                  <span className="text-xs text-ink-500">
                    {new Date(j.createdAt).toLocaleString()}
                  </span>
                </li>
              ))}
              {tour.jobs.length === 0 ? (
                <li className="text-ink-500">No processing jobs yet.</li>
              ) : null}
            </ul>
          </div>

          <div className="rounded-2xl border border-ink-900/10 bg-white p-5 shadow-soft">
            <h2 className="font-display text-xl text-ink-950">Embed</h2>
            <p className="mt-1 text-sm text-ink-500">
              Paste into listing sites or agent pages.
            </p>
            <textarea
              readOnly
              value={embed}
              className="mt-3 h-28 w-full rounded-xl border border-ink-900/10 bg-mist p-3 font-mono text-xs"
              onFocus={(e) => e.currentTarget.select()}
            />
          </div>
        </section>

        <section className="min-h-[480px] overflow-hidden rounded-2xl border border-ink-900/10 bg-ink-950 shadow-panel lg:sticky lg:top-6 lg:h-[calc(100vh-8rem)]">
          {manifest && manifest.scenes.length > 0 ? (
            <TourViewerLazy
              manifest={manifest}
              mode="studio"
              className="h-full min-h-[480px]"
            />
          ) : (
            <div className="flex h-full min-h-[480px] items-center justify-center p-8 text-center text-white/60">
              Preview appears after processing produces scenes with media.
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
