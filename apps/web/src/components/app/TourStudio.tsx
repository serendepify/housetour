"use client";

import { GuidedCapture } from "@/components/app/GuidedCapture";
import { TourViewerLazy } from "@/components/tour/TourViewerLazy";
import type { TourManifest } from "@housetour/api-contract";
import {
  AlertTriangle,
  ArrowLeft,
  BadgeCheck,
  Building2,
  Camera,
  Check,
  Circle,
  Clock3,
  Copy,
  ExternalLink,
  FileImage,
  Import,
  LoaderCircle,
  Play,
  Plus,
  Radio,
  ScanLine,
  Upload,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

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
  property: {
    title: string;
    status: string;
    listingType: string;
    currency: string;
    addressLine1: string | null;
    city: string | null;
    region: string | null;
    bedrooms: number | null;
    bathrooms: string | null;
    sqft: number | null;
    listPrice: string | null;
  } | null;
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
    captureSessionId: string | null;
    name: string;
    sortOrder: number;
    mediaUrl: string | null;
    kind: string;
    hotspotCount: number;
  }>;
  jobs: Array<{
    id: string;
    captureSessionId: string | null;
    type: string;
    status: string;
    progress: number;
    error: string | null;
    createdAt: string;
    stages?: StageState[] | null;
  }>;
  captureSessions: Array<{
    id: string;
    roomName: string;
    mode: string;
    status: string;
    frameCount: number;
    targetFrameCount: number;
    createdAt: string;
  }>;
};

type ImportCandidate = {
  id: string;
  roomName: string;
  frameCount: number;
  completedAt: string | null;
  sourceTour: { id: string; title: string };
};

type Notice = { tone: "info" | "success" | "error"; text: string };

function jobIsActive(job?: TourDTO["jobs"][number]) {
  return job?.status === "QUEUED" || job?.status === "RUNNING";
}

function formatMoney(property: TourDTO["property"]) {
  if (!property?.listPrice) return null;
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: property.currency || "USD",
      maximumFractionDigits: 0,
    }).format(Number(property.listPrice));
  } catch {
    return `${property.currency} ${Number(property.listPrice).toLocaleString()}`;
  }
}

function Step({ done, active, label }: { done: boolean; active: boolean; label: string }) {
  return (
    <li className="flex min-w-0 items-center gap-2">
      <span
        className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[10px] ${
          done
            ? "border-emerald-600 bg-emerald-600 text-white"
            : active
              ? "border-ink-950 bg-ink-950 text-white"
              : "border-ink-300 bg-white text-ink-400"
        }`}
      >
        {done ? <Check size={13} aria-hidden="true" /> : <Circle size={8} fill="currentColor" />}
      </span>
      <span className={`truncate text-xs font-semibold ${active ? "text-ink-950" : "text-ink-500"}`}>
        {label}
      </span>
    </li>
  );
}

export function TourStudio({
  tour,
  manifest,
  appUrl,
  allowPhotogrammetry,
  autoCapture = false,
}: {
  tour: TourDTO;
  manifest: TourManifest | null;
  appUrl: string;
  allowPhotogrammetry: boolean;
  autoCapture?: boolean;
}) {
  const router = useRouter();
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [published, setPublished] = useState(tour.published);
  const [captureOpen, setCaptureOpen] = useState(autoCapture);
  const [importOpen, setImportOpen] = useState(false);
  const [importCandidates, setImportCandidates] = useState<ImportCandidate[]>([]);
  const [selectedImport, setSelectedImport] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  const refresh = useCallback(() => router.refresh(), [router]);
  const activeJobs = tour.jobs.filter(jobIsActive);
  const activeJob = activeJobs[0];
  const panoCount = tour.assets.filter((asset) => asset.kind === "PANO").length;
  const panoSceneCount = tour.scenes.filter((scene) => scene.kind === "PANO").length;
  const sourceBytes = tour.assets
    .filter((asset) => ["PANO", "MULTI_VIEW", "FLOOR_PLAN"].includes(asset.kind))
    .reduce((total, asset) => total + Number(asset.sizeBytes), 0);
  const readyCaptures = tour.captureSessions.filter((capture) => capture.status === "READY");
  const hasScenes = tour.scenes.length > 0;
  const price = formatMoney(tour.property);

  const captureRows = useMemo(
    () =>
      tour.captureSessions.map((capture) => ({
        capture,
        scene: tour.scenes.find((scene) => scene.captureSessionId === capture.id),
        job: tour.jobs.find((job) => job.captureSessionId === capture.id),
      })),
    [tour.captureSessions, tour.jobs, tour.scenes],
  );

  useEffect(() => {
    if (activeJobs.length === 0) return;
    const timer = window.setInterval(refresh, 2500);
    return () => window.clearInterval(timer);
  }, [activeJobs.length, refresh]);

  useEffect(() => {
    if (!importOpen) return;
    let cancelled = false;
    setImportError(null);
    setBusyAction("load-imports");
    fetch(`/api/tours/${tour.id}/capture-sessions/import`)
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? "Could not load room scans");
        if (!cancelled) {
          setImportCandidates(data.captureSessions ?? []);
          setSelectedImport(data.captureSessions?.[0]?.id ?? null);
        }
      })
      .catch((error) => {
        if (!cancelled) setImportError(error instanceof Error ? error.message : "Could not load room scans");
      })
      .finally(() => {
        if (!cancelled) setBusyAction(null);
      });
    return () => {
      cancelled = true;
    };
  }, [importOpen, tour.id]);

  async function uploadFiles(files: FileList | null, kind: "PANO" | "FLOOR_PLAN" | "MESH_GLB") {
    if (!files?.length) return;
    setBusyAction(`upload-${kind}`);
    setNotice(null);
    try {
      for (let index = 0; index < files.length; index++) {
        const file = files[index];
        const contentType = file.type || (kind === "MESH_GLB" ? "model/gltf-binary" : "image/jpeg");
        const presignResponse = await fetch(`/api/tours/${tour.id}/assets/presign`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            filename: file.name,
            contentType: contentType === "image/jpg" ? "image/jpeg" : contentType,
            kind,
            sizeBytes: file.size,
          }),
        });
        const presign = await presignResponse.json();
        if (!presignResponse.ok) throw new Error(presign.error ?? "Could not prepare upload");

        const uploadResponse = await fetch(presign.uploadUrl, {
          method: "PUT",
          headers: { "Content-Type": contentType },
          body: file,
        });
        if (!uploadResponse.ok) throw new Error(`Upload failed for ${file.name}`);

        const completeResponse = await fetch(`/api/tours/${tour.id}/assets/complete`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            storageKey: presign.storageKey,
            filename: file.name,
            contentType,
            kind,
            sizeBytes: file.size,
            sortOrder: tour.assets.filter((asset) => asset.kind === kind).length + index,
          }),
        });
        const complete = await completeResponse.json();
        if (!completeResponse.ok) throw new Error(complete.error ?? "Could not confirm upload");
      }
      setNotice({
        tone: "success",
        text: kind === "PANO" ? "Panoramas uploaded. Build the panorama walkthrough when ready." : "Media uploaded.",
      });
      refresh();
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : "Upload failed" });
    } finally {
      setBusyAction(null);
    }
  }

  async function startBuild(mode: "pano" | "photogrammetry", captureSessionId?: string) {
    const action = captureSessionId ? `build-${captureSessionId}` : `build-${mode}`;
    setBusyAction(action);
    setNotice(null);
    try {
      const response = await fetch(`/api/tours/${tour.id}/process`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, captureSessionId }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error ?? "Build could not start");
      setNotice({
        tone: "info",
        text: data.duplicate ? "This room is already building." : "Room build started. You can leave this page while it runs.",
      });
      refresh();
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : "Build could not start" });
    } finally {
      setBusyAction(null);
    }
  }

  async function importRoom() {
    if (!selectedImport) return;
    setBusyAction("import-room");
    setImportError(null);
    try {
      const response = await fetch(`/api/tours/${tour.id}/capture-sessions/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceCaptureSessionId: selectedImport }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error ?? "Could not import room scan");

      if (allowPhotogrammetry) {
        const buildResponse = await fetch(`/api/tours/${tour.id}/process`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mode: "photogrammetry",
            captureSessionId: data.captureSession.id,
          }),
        });
        const build = await buildResponse.json().catch(() => ({}));
        if (!buildResponse.ok) throw new Error(build.error ?? "Room copied, but its build could not start");
      }

      setImportOpen(false);
      setNotice({
        tone: "success",
        text: allowPhotogrammetry ? "Room scan copied and queued for building." : "Room scan copied into this listing.",
      });
      refresh();
    } catch (error) {
      setImportError(error instanceof Error ? error.message : "Could not import room scan");
    } finally {
      setBusyAction(null);
    }
  }

  async function togglePublish() {
    setBusyAction("publish");
    setNotice(null);
    const next = !published;
    try {
      const response = await fetch(`/api/tours/${tour.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ published: next }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error ?? "Could not change publishing status");
      setPublished(next);
      setNotice({ tone: "success", text: next ? "Listing tour is now live." : "Listing tour is private." });
      refresh();
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : "Could not update tour" });
    } finally {
      setBusyAction(null);
    }
  }

  async function copyEmbed() {
    const embed = `<iframe src="${appUrl}/embed/${tour.slug}" width="100%" height="600" style="border:0" allow="xr-spatial-tracking; fullscreen; gyroscope; accelerometer" loading="lazy"></iframe>`;
    await navigator.clipboard.writeText(embed);
    setNotice({ tone: "success", text: "Embed code copied." });
  }

  const workflowDone = [true, readyCaptures.length > 0 || panoCount > 0, hasScenes, published];
  const activeStep = workflowDone.findIndex((done) => !done);
  const latestStages = activeJob?.stages ?? tour.jobs.find((job) => job.stages?.length)?.stages;
  const nextReadyRoom = captureRows.find(({ capture, scene, job }) =>
    capture.status === "READY" && !scene && !jobIsActive(job),
  );

  return (
    <div className="space-y-5 pb-12">
      <header className="flex flex-col gap-4 border-b border-ink-900/10 pb-5 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0">
          <Link href="/app" className="inline-flex items-center gap-1 text-xs font-semibold text-ink-500 hover:text-ink-950">
            <ArrowLeft size={14} aria-hidden="true" />
            Listings
          </Link>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <h1 className="truncate text-2xl font-semibold text-ink-950">{tour.property?.title ?? tour.title}</h1>
            <span className={`rounded-full px-2 py-1 text-[10px] font-bold uppercase ${published ? "bg-emerald-100 text-emerald-800" : "bg-ink-100 text-ink-600"}`}>
              {published ? "Live" : "Private"}
            </span>
          </div>
          <p className="mt-1 text-sm text-ink-500">
            {[tour.property?.addressLine1, tour.property?.city, tour.property?.region].filter(Boolean).join(", ") || "Address not added"}
            {price ? ` - ${price}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {hasScenes ? (
            <Link href={`/app/tours/${tour.id}/preview`} target="_blank" className="inline-flex h-10 items-center gap-2 rounded-lg border border-ink-900/15 bg-white px-3 text-sm font-semibold text-ink-800 hover:bg-ink-100">
              <Play size={16} aria-hidden="true" />
              Preview
            </Link>
          ) : null}
          {published && hasScenes ? (
            <Link href={`/t/${tour.slug}`} target="_blank" className="inline-flex h-10 items-center gap-2 rounded-lg border border-ink-900/15 bg-white px-3 text-sm font-semibold text-ink-800 hover:bg-ink-100">
              <ExternalLink size={16} aria-hidden="true" />
              Open live
            </Link>
          ) : null}
          <button type="button" disabled={busyAction === "publish" || !hasScenes} onClick={() => void togglePublish()} className="inline-flex h-10 items-center gap-2 rounded-lg bg-ink-950 px-4 text-sm font-semibold text-white hover:bg-ink-800 disabled:opacity-40">
            {busyAction === "publish" ? <LoaderCircle className="animate-spin" size={16} /> : published ? <Radio size={16} /> : <BadgeCheck size={16} />}
            {published ? "Make private" : "Publish tour"}
          </button>
        </div>
      </header>

      <ol className="grid grid-cols-2 gap-3 rounded-lg border border-ink-900/10 bg-white px-4 py-3 shadow-sm sm:grid-cols-4">
        {[
          ["Listing", 0],
          ["Capture", 1],
          ["Build", 2],
          ["Publish", 3],
        ].map(([label, index]) => (
          <Step key={String(label)} label={String(label)} done={workflowDone[Number(index)]} active={activeStep === Number(index)} />
        ))}
      </ol>

      {notice ? (
        <div className={`flex items-start gap-3 rounded-lg border px-4 py-3 text-sm ${notice.tone === "error" ? "border-red-200 bg-red-50 text-red-800" : notice.tone === "success" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-sky-200 bg-sky-50 text-sky-800"}`}>
          {notice.tone === "error" ? <AlertTriangle className="mt-0.5 shrink-0" size={17} /> : notice.tone === "success" ? <Check className="mt-0.5 shrink-0" size={17} /> : <Clock3 className="mt-0.5 shrink-0" size={17} />}
          <p>{notice.text}</p>
        </div>
      ) : null}

      {tour.failureReason && !activeJob ? (
        <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <AlertTriangle className="mt-0.5 shrink-0" size={17} aria-hidden="true" />
          <div>
            <p className="font-semibold">The last build did not finish</p>
            <p className="mt-0.5 text-amber-800">{tour.failureReason}. Your completed rooms and source frames are still available.</p>
          </div>
        </div>
      ) : null}

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,0.9fr)_minmax(420px,1.1fr)]">
        <div className="space-y-5">
          <section className="rounded-lg border border-ink-900/10 bg-[#eef4f1] p-5">
            {activeJob ? (
              <div>
                <p className="text-xs font-bold uppercase text-emerald-800">Build in progress</p>
                <div className="mt-2 flex items-center justify-between gap-4">
                  <h2 className="text-lg font-semibold text-ink-950">
                    {tour.captureSessions.find((capture) => capture.id === activeJob.captureSessionId)?.roomName ?? "Preparing walkthrough"}
                  </h2>
                  <span className="font-mono text-sm font-semibold text-emerald-800">{activeJob.progress}%</span>
                </div>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-white">
                  <div className="h-full bg-emerald-600 transition-[width]" style={{ width: `${activeJob.progress}%` }} />
                </div>
                <p className="mt-3 text-sm text-ink-600">
                  {latestStages?.find((stage) => stage.status === "running")?.label ?? "Queued for the reconstruction worker"}
                </p>
              </div>
            ) : nextReadyRoom && allowPhotogrammetry ? (
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-xs font-bold uppercase text-emerald-800">Ready to build</p>
                  <h2 className="mt-1 text-lg font-semibold text-ink-950">Turn {nextReadyRoom.capture.roomName} into a room preview</h2>
                  <p className="mt-1 text-sm text-ink-600">Only frames from this room will be processed.</p>
                </div>
                <button type="button" onClick={() => void startBuild("photogrammetry", nextReadyRoom.capture.id)} disabled={busyAction !== null} className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-lg bg-emerald-700 px-4 text-sm font-bold text-white hover:bg-emerald-800 disabled:opacity-50">
                  <Play size={16} /> Build room
                </button>
              </div>
            ) : !hasScenes ? (
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-xs font-bold uppercase text-emerald-800">Next step</p>
                  <h2 className="mt-1 text-lg font-semibold text-ink-950">Capture the first room</h2>
                  <p className="mt-1 text-sm text-ink-600">You are adding rooms to {tour.property?.title ?? tour.title}.</p>
                </div>
                <button type="button" onClick={() => setCaptureOpen(true)} className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-lg bg-emerald-700 px-4 text-sm font-bold text-white hover:bg-emerald-800">
                  <ScanLine size={16} /> Scan room
                </button>
              </div>
            ) : !published ? (
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-xs font-bold uppercase text-emerald-800">Ready for review</p>
                  <h2 className="mt-1 text-lg font-semibold text-ink-950">Walk through before publishing</h2>
                  <p className="mt-1 text-sm text-ink-600">Check room transitions, then make the tour live.</p>
                </div>
                <Link href={`/app/tours/${tour.id}/preview`} target="_blank" className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-lg bg-emerald-700 px-4 text-sm font-bold text-white hover:bg-emerald-800">
                  <Play size={16} /> Preview tour
                </Link>
              </div>
            ) : (
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-xs font-bold uppercase text-emerald-800">Tour is live</p>
                  <h2 className="mt-1 text-lg font-semibold text-ink-950">Add another room when ready</h2>
                  <p className="mt-1 text-sm text-ink-600">Existing visitors keep seeing the current tour while new rooms build.</p>
                </div>
                <button type="button" onClick={() => setCaptureOpen(true)} className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-lg bg-emerald-700 px-4 text-sm font-bold text-white hover:bg-emerald-800">
                  <Plus size={16} /> Add room
                </button>
              </div>
            )}
          </section>

          <section className="rounded-lg border border-ink-900/10 bg-white shadow-sm">
            <div className="flex flex-col gap-3 border-b border-ink-900/10 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-xs font-bold uppercase text-sea">Rooms</p>
                <h2 className="mt-0.5 text-lg font-semibold text-ink-950">Room scans</h2>
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => setImportOpen(true)} className="inline-flex h-9 items-center gap-2 rounded-lg border border-ink-900/15 bg-white px-3 text-xs font-bold text-ink-700 hover:bg-ink-100">
                  <Import size={15} /> Import room
                </button>
                <button type="button" onClick={() => setCaptureOpen(true)} className="inline-flex h-9 items-center gap-2 rounded-lg bg-ink-950 px-3 text-xs font-bold text-white hover:bg-ink-800">
                  <Camera size={15} /> Scan new room
                </button>
              </div>
            </div>

            {captureRows.length > 0 ? (
              <ul className="divide-y divide-ink-900/10">
                {captureRows.map(({ capture, scene, job }) => {
                  const active = jobIsActive(job);
                  const failed = job?.status === "FAILED";
                  return (
                    <li key={capture.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex min-w-0 items-center gap-3">
                        <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${scene ? "bg-emerald-100 text-emerald-800" : active ? "bg-sky-100 text-sky-800" : "bg-ink-100 text-ink-600"}`}>
                          {active ? <LoaderCircle className="animate-spin" size={18} /> : scene ? <BadgeCheck size={18} /> : <ScanLine size={18} />}
                        </span>
                        <div className="min-w-0">
                          <p className="truncate font-semibold text-ink-950">{capture.roomName}</p>
                          <p className="mt-0.5 text-xs text-ink-500">
                            {capture.frameCount} frames - {scene ? "built" : active ? `${job?.progress ?? 0}% building` : failed ? "build failed" : capture.status.toLowerCase()}
                          </p>
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-2 pl-[52px] sm:pl-0">
                        {scene ? (
                          <Link href={`/app/tours/${tour.id}/preview?scene=${scene.id}`} target="_blank" className="inline-flex h-9 items-center gap-2 rounded-lg border border-ink-900/15 px-3 text-xs font-bold text-ink-800 hover:bg-ink-100">
                            <Play size={14} /> Explore
                          </Link>
                        ) : capture.status === "READY" && allowPhotogrammetry ? (
                          <button type="button" disabled={active || busyAction !== null} onClick={() => void startBuild("photogrammetry", capture.id)} className="inline-flex h-9 items-center gap-2 rounded-lg bg-ink-950 px-3 text-xs font-bold text-white hover:bg-ink-800 disabled:opacity-40">
                            {busyAction === `build-${capture.id}` || active ? <LoaderCircle className="animate-spin" size={14} /> : <Play size={14} />}
                            {failed ? "Retry build" : active ? "Building" : "Build room"}
                          </button>
                        ) : capture.status === "READY" ? (
                          <Link href="/app/billing" className="text-xs font-bold text-sea underline">Upgrade to build</Link>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <div className="px-5 py-10 text-center">
                <Camera className="mx-auto text-ink-300" size={28} />
                <p className="mt-3 text-sm font-semibold text-ink-800">No rooms captured yet</p>
                <p className="mt-1 text-xs text-ink-500">Scan here or import a completed room from another listing.</p>
              </div>
            )}
          </section>

          <section className="rounded-lg border border-ink-900/10 bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-ink-900/10 p-4">
              <div>
                <p className="text-xs font-bold uppercase text-sea">Other media</p>
                <h2 className="mt-0.5 text-lg font-semibold text-ink-950">Panoramas and plans</h2>
              </div>
              <span className="text-xs text-ink-500">{(sourceBytes / 1024 / 1024).toFixed(1)} MB source</span>
            </div>
            <div className="grid gap-2 p-4 sm:grid-cols-2">
              <label className="flex min-h-20 cursor-pointer items-center gap-3 rounded-lg border border-dashed border-ink-900/20 bg-mist px-4 hover:border-ink-900/40">
                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-white text-sea shadow-sm"><Upload size={17} /></span>
                <span><span className="block text-sm font-semibold text-ink-900">Add 360 panoramas</span><span className="text-xs text-ink-500">JPG, PNG, or WebP</span></span>
                <input type="file" multiple accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(event) => void uploadFiles(event.target.files, "PANO")} />
              </label>
              <label className="flex min-h-20 cursor-pointer items-center gap-3 rounded-lg border border-dashed border-ink-900/20 bg-mist px-4 hover:border-ink-900/40">
                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-white text-sea shadow-sm"><FileImage size={17} /></span>
                <span><span className="block text-sm font-semibold text-ink-900">Add a floor plan</span><span className="text-xs text-ink-500">Image or SVG</span></span>
                <input type="file" accept="image/jpeg,image/png,image/webp,image/svg+xml" className="hidden" onChange={(event) => void uploadFiles(event.target.files, "FLOOR_PLAN")} />
              </label>
            </div>
            {panoCount > 0 ? (
              <div className="flex items-center justify-between border-t border-ink-900/10 px-4 py-3 text-sm">
                <span className="text-ink-600">{panoCount} panoramas - {panoSceneCount} viewer scenes</span>
                <button type="button" disabled={busyAction !== null || activeJobs.length > 0} onClick={() => void startBuild("pano")} className="inline-flex h-9 items-center gap-2 rounded-lg border border-ink-900/15 px-3 text-xs font-bold text-ink-800 hover:bg-ink-100 disabled:opacity-40">
                  <Play size={14} /> {panoSceneCount > 0 ? "Rebuild pano walk" : "Build pano walk"}
                </button>
              </div>
            ) : null}
          </section>

          <details className="rounded-lg border border-ink-900/10 bg-white shadow-sm">
            <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-ink-800">Build details and history</summary>
            <div className="border-t border-ink-900/10 p-4">
              {latestStages?.length ? (
                <ol className="space-y-2">
                  {latestStages.map((stage) => (
                    <li key={stage.id} className="flex items-start gap-3 text-sm">
                      <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${stage.status === "succeeded" ? "bg-emerald-500" : stage.status === "running" ? "animate-pulse bg-sky-500" : stage.status === "failed" ? "bg-red-500" : "bg-ink-300"}`} />
                      <div className="min-w-0 flex-1"><div className="flex justify-between gap-3"><span className="font-medium text-ink-800">{stage.label}</span><span className="text-[10px] font-bold uppercase text-ink-400">{stage.status}</span></div>{stage.detail ? <p className="mt-0.5 break-words text-xs text-ink-500">{stage.detail}</p> : null}</div>
                    </li>
                  ))}
                </ol>
              ) : <p className="text-sm text-ink-500">Build stages appear here after a room is queued.</p>}
              <ul className="mt-4 divide-y divide-ink-900/10 border-t border-ink-900/10 text-xs text-ink-600">
                {tour.jobs.slice(0, 6).map((job) => <li key={job.id} className="flex justify-between gap-4 py-2"><span>{job.type.replace("tour.", "")} - {job.status}{job.error ? ` - ${job.error}` : ""}</span><time className="shrink-0">{new Date(job.createdAt).toLocaleString()}</time></li>)}
              </ul>
            </div>
          </details>

          {published ? (
            <button type="button" onClick={() => void copyEmbed()} className="inline-flex items-center gap-2 text-sm font-semibold text-sea hover:underline">
              <Copy size={15} /> Copy listing embed code
            </button>
          ) : null}
        </div>

        <section className="overflow-hidden rounded-lg border border-ink-900/10 bg-ink-950 shadow-panel lg:sticky lg:top-5">
          <div className="flex h-12 items-center justify-between border-b border-white/10 px-4 text-white">
            <div className="flex min-w-0 items-center gap-2"><Building2 className="shrink-0 text-gold-300" size={16} /><span className="truncate text-sm font-semibold">Tour preview</span></div>
            {hasScenes ? <span className="text-xs text-white/50">{tour.scenes.length} rooms - {tour.viewCount} views</span> : null}
          </div>
          {manifest && manifest.scenes.length > 0 ? (
            <TourViewerLazy manifest={manifest} mode="studio" className="h-[min(70vh,720px)] min-h-[520px]" />
          ) : (
            <div className="flex min-h-[520px] flex-col items-center justify-center px-8 text-center text-white/60">
              <ScanLine size={34} className="text-white/25" />
              <p className="mt-4 text-sm font-semibold text-white/80">No built rooms yet</p>
              <p className="mt-1 max-w-xs text-xs leading-5">Scan or import a room, then build it to explore the private tour here.</p>
            </div>
          )}
        </section>
      </div>

      {captureOpen ? (
        <GuidedCapture
          open
          tourId={tour.id}
          tourTitle={tour.property?.title ?? tour.title}
          assetOffset={tour.assets.length}
          allowPhotogrammetry={allowPhotogrammetry}
          onClose={() => setCaptureOpen(false)}
          onComplete={refresh}
        />
      ) : null}

      {importOpen ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/55 p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label="Import room scan">
          <div className="max-h-[90dvh] w-full max-w-xl overflow-y-auto rounded-t-lg bg-white shadow-panel sm:rounded-lg">
            <header className="flex items-start justify-between border-b border-ink-900/10 p-5">
              <div><p className="text-xs font-bold uppercase text-sea">Reuse a completed capture</p><h2 className="mt-1 text-xl font-semibold text-ink-950">Import room scan</h2><p className="mt-1 text-sm text-ink-500">A protected copy will be added to {tour.property?.title ?? tour.title}.</p></div>
              <button type="button" onClick={() => setImportOpen(false)} className="flex h-9 w-9 items-center justify-center rounded-lg text-ink-500 hover:bg-ink-100" aria-label="Close import"><X size={18} /></button>
            </header>
            <div className="p-5">
              {busyAction === "load-imports" ? <div className="flex items-center justify-center gap-2 py-10 text-sm text-ink-500"><LoaderCircle className="animate-spin" size={18} /> Loading room scans</div> : importCandidates.length > 0 ? (
                <fieldset className="space-y-2">
                  <legend className="sr-only">Choose a room scan</legend>
                  {importCandidates.map((candidate) => (
                    <label key={candidate.id} className={`flex cursor-pointer items-center gap-3 rounded-lg border p-3 ${selectedImport === candidate.id ? "border-emerald-600 bg-emerald-50" : "border-ink-900/10 hover:bg-ink-100"}`}>
                      <input type="radio" name="room-import" value={candidate.id} checked={selectedImport === candidate.id} onChange={() => setSelectedImport(candidate.id)} className="h-4 w-4 accent-emerald-700" />
                      <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold text-ink-900">{candidate.roomName}</span><span className="block truncate text-xs text-ink-500">From {candidate.sourceTour.title} - {candidate.frameCount} frames</span></span>
                    </label>
                  ))}
                </fieldset>
              ) : <div className="py-10 text-center"><Import className="mx-auto text-ink-300" size={28} /><p className="mt-3 text-sm font-semibold text-ink-800">No room scans in other listings</p><p className="mt-1 text-xs text-ink-500">Completed captures from this workspace will appear here.</p></div>}
              {importError ? <div className="mt-4 flex gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800"><AlertTriangle className="mt-0.5 shrink-0" size={16} />{importError}</div> : null}
            </div>
            <footer className="flex justify-end gap-2 border-t border-ink-900/10 p-4"><button type="button" onClick={() => setImportOpen(false)} className="h-10 rounded-lg px-4 text-sm font-semibold text-ink-600 hover:bg-ink-100">Cancel</button><button type="button" disabled={!selectedImport || busyAction !== null} onClick={() => void importRoom()} className="inline-flex h-10 items-center gap-2 rounded-lg bg-ink-950 px-4 text-sm font-bold text-white disabled:opacity-40">{busyAction === "import-room" ? <LoaderCircle className="animate-spin" size={16} /> : <Import size={16} />} Import and build</button></footer>
          </div>
        </div>
      ) : null}
    </div>
  );
}
