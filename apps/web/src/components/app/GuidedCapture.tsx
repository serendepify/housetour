"use client";

import {
  AlertTriangle,
  Building2,
  Camera,
  Check,
  ChevronLeft,
  LoaderCircle,
  RotateCcw,
  ScanLine,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  assessCaptureQuality,
  isCaptureReadyForReconstruction,
  reconstructionQualityMessage,
  summarizeCaptureQuality,
  type CaptureQuality,
} from "@/lib/capture-quality";

type CaptureFrame = {
  id: string;
  file: File;
  preview: string;
  quality: CaptureQuality;
  width: number;
  height: number;
  capturedAt: string;
  uploadState: "ready" | "uploading" | "done" | "failed";
};

type CapturePhase = "setup" | "camera" | "review" | "uploading" | "done";
type SessionStatus = "CAPTURING" | "UPLOADING" | "READY" | "FAILED" | "CANCELLED";

const MIN_CAPTURE_FRAMES = 8;
const TARGET_OPTIONS = [12, 18, 24] as const;

function roomSlug(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "room";
}

function qualityLabel(quality: CaptureQuality) {
  if (quality.rating === "good") return "Ready";
  if (quality.issues.includes("soft")) return "Hold steady";
  if (quality.issues.includes("dark")) return "Too dark";
  if (quality.issues.includes("bright")) return "Too bright";
  return "Review";
}

export function GuidedCapture({
  open,
  tourId,
  tourTitle,
  assetOffset,
  allowPhotogrammetry,
  onClose,
  onComplete,
}: {
  open: boolean;
  tourId: string;
  tourTitle: string;
  assetOffset: number;
  allowPhotogrammetry: boolean;
  onClose: () => void;
  onComplete: () => void;
}) {
  const [phase, setPhase] = useState<CapturePhase>("setup");
  const [roomName, setRoomName] = useState("");
  const [targetFrameCount, setTargetFrameCount] = useState<number>(18);
  const [frames, setFrames] = useState<CaptureFrame[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionStatus, setSessionStatus] = useState<SessionStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [cameraReady, setCameraReady] = useState(false);
  const [buildQueued, setBuildQueued] = useState(false);
  const [buildError, setBuildError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const wakeLockRef = useRef<{ release: () => Promise<void> } | null>(null);
  const previewsRef = useRef<string[]>([]);
  const frameSequenceRef = useRef(0);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    void wakeLockRef.current?.release().catch(() => undefined);
    wakeLockRef.current = null;
    setCameraReady(false);
  }, []);

  useEffect(() => {
    const previews = previewsRef.current;
    return () => {
      stopCamera();
      previews.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [stopCamera]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && phase !== "uploading") void closeCapture();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  async function patchSession(status: SessionStatus, qualitySummary?: Record<string, unknown>) {
    if (!sessionId) return;
    const response = await fetch(`/api/tours/${tourId}/capture-sessions/${sessionId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status, qualitySummary }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error ?? "Could not update capture session");
    setSessionStatus(status);
  }

  async function closeCapture() {
    stopCamera();
    if (sessionId && (sessionStatus === "CAPTURING" || sessionStatus === "UPLOADING")) {
      await patchSession("CANCELLED").catch(() => undefined);
    }
    onClose();
  }

  async function requestCamera() {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("Camera capture requires a modern browser on HTTPS or localhost.");
    }
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: 1920 },
        height: { ideal: 1080 },
      },
    });
    streamRef.current = stream;
    if (videoRef.current) {
      videoRef.current.srcObject = stream;
      await videoRef.current.play();
    }
    const wakeLock = (
      navigator as Navigator & {
        wakeLock?: { request: (type: "screen") => Promise<{ release: () => Promise<void> }> };
      }
    ).wakeLock;
    if (wakeLock) {
      wakeLockRef.current = await wakeLock.request("screen").catch(() => null);
    }
    setCameraReady(true);
  }

  async function startCapture() {
    if (roomName.trim().length < 2) {
      setError("Name this room before starting the scan.");
      return;
    }
    setStarting(true);
    setError(null);
    let createdSessionId: string | null = null;
    try {
      const response = await fetch(`/api/tours/${tourId}/capture-sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          roomName: roomName.trim(),
          mode: "PERSPECTIVE",
          targetFrameCount,
          deviceInfo: {
            userAgent: navigator.userAgent,
            viewport: { width: window.innerWidth, height: window.innerHeight },
          },
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not start capture");
      createdSessionId = data.captureSession.id;
      setSessionId(createdSessionId);
      setSessionStatus("CAPTURING");
      setPhase("camera");
      await new Promise((resolve) => requestAnimationFrame(resolve));
      await requestCamera();
    } catch (captureError) {
      const message =
        captureError instanceof DOMException && captureError.name === "NotAllowedError"
          ? "Camera access was blocked. Allow camera access in the browser and try again."
          : captureError instanceof Error
            ? captureError.message
            : "Could not start the camera";
      setError(message);
      setPhase("setup");
      if (createdSessionId) {
        await fetch(`/api/tours/${tourId}/capture-sessions/${createdSessionId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "FAILED", qualitySummary: { reason: message } }),
        }).catch(() => undefined);
        setSessionStatus("FAILED");
      }
      stopCamera();
    } finally {
      setStarting(false);
    }
  }

  async function captureFrame() {
    const video = videoRef.current;
    if (!video || !video.videoWidth || !cameraReady || frames.length >= targetFrameCount) return;

    const scale = Math.min(1, 1920 / Math.max(video.videoWidth, video.videoHeight));
    const width = Math.round(video.videoWidth * scale);
    const height = Math.round(video.videoHeight * scale);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) return;
    context.drawImage(video, 0, 0, width, height);

    const sample = document.createElement("canvas");
    sample.width = 160;
    sample.height = 90;
    const sampleContext = sample.getContext("2d", { willReadFrequently: true });
    if (!sampleContext) return;
    sampleContext.drawImage(video, 0, 0, sample.width, sample.height);
    const pixels = sampleContext.getImageData(0, 0, sample.width, sample.height).data;
    const quality = assessCaptureQuality(pixels, sample.width, sample.height);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.9),
    );
    if (!blob) {
      setError("The camera frame could not be encoded. Try again.");
      return;
    }

    const index = ++frameSequenceRef.current;
    const capturedAt = new Date().toISOString();
    const file = new File(
      [blob],
      `${roomSlug(roomName)}-${String(index).padStart(3, "0")}.jpg`,
      { type: "image/jpeg", lastModified: Date.now() },
    );
    const preview = URL.createObjectURL(file);
    previewsRef.current.push(preview);
    setFrames((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
        file,
        preview,
        quality,
        width,
        height,
        capturedAt,
        uploadState: "ready",
      },
    ]);
    setError(null);
  }

  function removeFrame(id: string) {
    setFrames((current) => {
      const removed = current.find((frame) => frame.id === id);
      if (removed) URL.revokeObjectURL(removed.preview);
      return current.filter((frame) => frame.id !== id);
    });
  }

  async function resumeCamera() {
    setError(null);
    setPhase("camera");
    try {
      await new Promise((resolve) => requestAnimationFrame(resolve));
      await requestCamera();
    } catch (resumeError) {
      setError(resumeError instanceof Error ? resumeError.message : "Could not restart camera");
      setPhase("review");
    }
  }

  function reviewFrames() {
    stopCamera();
    setPhase("review");
  }

  async function uploadFrame(frame: CaptureFrame, index: number) {
    setFrames((current) =>
      current.map((item) =>
        item.id === frame.id ? { ...item, uploadState: "uploading" } : item,
      ),
    );
    try {
      const presignResponse = await fetch(`/api/tours/${tourId}/assets/presign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: frame.file.name,
          contentType: "image/jpeg",
          kind: "MULTI_VIEW",
          sizeBytes: frame.file.size,
        }),
      });
      const presign = await presignResponse.json();
      if (!presignResponse.ok) throw new Error(presign.error ?? "Could not reserve upload");

      const uploadResponse = await fetch(presign.uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": "image/jpeg" },
        body: frame.file,
      });
      if (!uploadResponse.ok) throw new Error(`Upload failed for ${frame.file.name}`);

      const completeResponse = await fetch(`/api/tours/${tourId}/assets/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storageKey: presign.storageKey,
          filename: frame.file.name,
          contentType: "image/jpeg",
          kind: "MULTI_VIEW",
          sizeBytes: frame.file.size,
          sortOrder: assetOffset + index,
          captureSessionId: sessionId,
          capturedAt: frame.capturedAt,
          meta: {
            source: "web-camera",
            width: frame.width,
            height: frame.height,
            quality: frame.quality,
          },
        }),
      });
      const complete = await completeResponse.json();
      if (!completeResponse.ok) throw new Error(complete.error ?? "Could not confirm upload");
      setFrames((current) =>
        current.map((item) =>
          item.id === frame.id ? { ...item, uploadState: "done" } : item,
        ),
      );
    } catch (uploadError) {
      setFrames((current) =>
        current.map((item) =>
          item.id === frame.id ? { ...item, uploadState: "failed" } : item,
        ),
      );
      throw uploadError;
    }
  }

  async function uploadFrames() {
    if (!sessionId || frames.length < MIN_CAPTURE_FRAMES) return;
    setPhase("uploading");
    setError(null);
    setUploadProgress(frames.filter((frame) => frame.uploadState === "done").length);
    try {
      if (sessionStatus === "CAPTURING") await patchSession("UPLOADING");
      const queue = frames
        .map((frame, index) => ({ frame, index }))
        .filter(({ frame }) => frame.uploadState !== "done");
      let cursor = 0;
      const workers = Array.from({ length: Math.min(3, queue.length) }, async () => {
        while (cursor < queue.length) {
          const current = queue[cursor++];
          await uploadFrame(current.frame, current.index);
          setUploadProgress((value) => value + 1);
        }
      });
      await Promise.all(workers);
      const summary = summarizeCaptureQuality(frames.map((frame) => frame.quality));
      const reconstructionReady = isCaptureReadyForReconstruction(summary);
      await patchSession("READY", {
        ...summary,
        completedAt: new Date().toISOString(),
      });
      setPhase("done");
      if (allowPhotogrammetry) {
        if (reconstructionReady) {
          try {
            const buildResponse = await fetch(`/api/tours/${tourId}/process`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                mode: "photogrammetry",
                captureSessionId: sessionId,
              }),
            });
            const build = await buildResponse.json().catch(() => ({}));
            if (!buildResponse.ok) {
              throw new Error(build.error ?? "The room was saved, but its build could not start");
            }
            setBuildQueued(true);
          } catch (buildQueueError) {
            setBuildError(
              buildQueueError instanceof Error
                ? buildQueueError.message
                : "The room was saved, but its build could not start",
            );
          }
        } else {
          setBuildError(
            reconstructionQualityMessage(summary) ??
              "The room was saved, but its capture quality is not strong enough for photogrammetry yet.",
          );
        }
      }
      onComplete();
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Frame upload failed");
      setPhase("review");
    }
  }

  if (!open) return null;

  const readyCount = frames.filter((frame) => frame.uploadState === "done").length;
  const qualitySummary = summarizeCaptureQuality(frames.map((frame) => frame.quality));
  const reconstructionReady = isCaptureReadyForReconstruction(qualitySummary);
  const reconstructionNote = reconstructionQualityMessage(qualitySummary);
  const guidance =
    frames.length < 3
      ? "Start at the doorway and include the floor and ceiling."
      : frames.length < Math.ceil(targetFrameCount * 0.65)
        ? "Walk the perimeter. Keep most of the previous view in each frame."
        : "Finish corners, windows, and transitions into the next room.";

  return (
    <div
      className="fixed inset-0 z-50 flex min-h-[100dvh] flex-col overflow-y-auto bg-[#07100e] text-white"
      role="dialog"
      aria-modal="true"
      aria-label="Guided room capture"
    >
      <header className="relative z-20 flex h-16 shrink-0 items-center justify-between border-b border-white/10 px-4 md:px-6">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#f2c14e] text-[#07100e]">
            <ScanLine size={19} aria-hidden="true" />
          </span>
          <div>
            <p className="text-sm font-semibold">HouseTour Capture</p>
            <p className="max-w-[58vw] truncate text-xs text-white/55">
              {roomName ? `${roomName} - ${tourTitle}` : `Adding to ${tourTitle}`}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void closeCapture()}
          disabled={phase === "uploading"}
          className="flex h-10 w-10 items-center justify-center rounded-lg border border-white/15 text-white/80 transition hover:bg-white/10 disabled:opacity-40"
          aria-label="Close capture"
          title="Close capture"
        >
          <X size={19} aria-hidden="true" />
        </button>
      </header>

      {phase === "setup" ? (
        <main className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center px-5 py-10">
          <div className="mb-8 flex h-14 w-14 items-center justify-center rounded-lg bg-[#f2c14e] text-[#07100e]">
            <Camera size={26} aria-hidden="true" />
          </div>
          <p className="text-xs font-semibold uppercase text-[#f2c14e]">Perspective capture</p>
          <h2 className="mt-2 font-display text-4xl leading-tight">Scan one room at a time</h2>
          <p className="mt-3 max-w-lg text-sm leading-6 text-white/65">
            Capture overlapping views while walking the room perimeter. HouseTour checks light and
            sharpness before the frames enter reconstruction.
          </p>

          <div className="mt-5 flex items-start gap-3 rounded-lg border border-white/10 bg-white/5 px-3 py-3 text-sm text-white/70">
            <Building2 className="mt-0.5 shrink-0 text-[#f2c14e]" size={17} aria-hidden="true" />
            <p>
              This room will be added to <strong className="text-white">{tourTitle}</strong>.
            </p>
          </div>

          <label className="mt-8 block text-sm font-medium" htmlFor="capture-room-name">
            Room name
          </label>
          <input
            id="capture-room-name"
            value={roomName}
            onChange={(event) => setRoomName(event.target.value)}
            placeholder="Living room"
            autoFocus
            className="mt-2 h-12 w-full rounded-lg border border-white/15 bg-white/5 px-3 text-base text-white outline-none transition placeholder:text-white/30 focus:border-[#f2c14e] focus:ring-2 focus:ring-[#f2c14e]/20"
          />

          <fieldset className="mt-6">
            <legend className="text-sm font-medium">Capture density</legend>
            <div className="mt-2 grid grid-cols-3 gap-2" role="group">
              {TARGET_OPTIONS.map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setTargetFrameCount(option)}
                  className={`h-12 rounded-lg border text-sm font-semibold transition ${
                    targetFrameCount === option
                      ? "border-[#f2c14e] bg-[#f2c14e] text-[#07100e]"
                      : "border-white/15 bg-white/5 text-white/75 hover:bg-white/10"
                  }`}
                >
                  {option} frames
                </button>
              ))}
            </div>
          </fieldset>

          {error ? (
            <div className="mt-5 flex gap-3 rounded-lg border border-red-300/25 bg-red-400/10 px-3 py-3 text-sm text-red-100">
              <AlertTriangle className="mt-0.5 shrink-0" size={17} aria-hidden="true" />
              <p>{error}</p>
            </div>
          ) : null}

          <button
            type="button"
            onClick={() => void startCapture()}
            disabled={starting}
            className="mt-7 flex h-12 items-center justify-center gap-2 rounded-lg bg-[#f2c14e] px-5 text-sm font-bold text-[#07100e] transition hover:bg-[#ffd166] disabled:opacity-60"
          >
            {starting ? (
              <LoaderCircle className="animate-spin" size={18} aria-hidden="true" />
            ) : (
              <Camera size={18} aria-hidden="true" />
            )}
            {starting ? "Opening camera" : "Start room scan"}
          </button>
        </main>
      ) : null}

      {phase === "camera" ? (
        <main className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-black">
          <video
            ref={videoRef}
            muted
            playsInline
            autoPlay
            className="absolute inset-0 h-full w-full object-cover"
            onCanPlay={() => setCameraReady(true)}
          />
          <div className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-black/55" />
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-52 bg-black/70" />

          <div className="relative z-10 px-4 pt-4 md:px-6">
            <div className="mx-auto max-w-3xl rounded-lg border border-white/15 bg-black/45 px-4 py-3 backdrop-blur-md">
              <div className="flex items-center justify-between gap-4 text-sm">
                <p className="font-medium">{guidance}</p>
                <p className="shrink-0 font-mono text-xs text-white/70">
                  {frames.length}/{targetFrameCount}
                </p>
              </div>
              <div className="mt-3 flex gap-1" aria-label={`${frames.length} of ${targetFrameCount} frames`}>
                {Array.from({ length: targetFrameCount }, (_, index) => (
                  <span
                    key={index}
                    className={`h-1.5 min-w-0 flex-1 rounded-sm ${
                      index < frames.length ? "bg-[#f2c14e]" : "bg-white/20"
                    }`}
                  />
                ))}
              </div>
            </div>
          </div>

          <div className="relative z-10 mt-auto flex flex-col items-center px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
            {frames.at(-1) ? (
              <div
                className={`mb-4 rounded-lg px-3 py-1.5 text-xs font-semibold backdrop-blur ${
                  frames.at(-1)?.quality.rating === "good"
                    ? "bg-emerald-400/90 text-emerald-950"
                    : "bg-amber-300/90 text-amber-950"
                }`}
              >
                {qualityLabel(frames.at(-1)!.quality)}
              </div>
            ) : null}
            {error ? <p className="mb-3 text-sm text-red-200">{error}</p> : null}
            {!reconstructionReady ? (
              <div className="mb-4 rounded-lg border border-amber-300/25 bg-amber-300/10 px-4 py-3 text-sm text-amber-100">
                <p className="font-semibold">Not ready for reconstruction</p>
                <p className="mt-1 text-amber-50/85">
                  {reconstructionNote ??
                    "Retake a few soft or dark frames before uploading this room."}
                </p>
              </div>
            ) : null}
            <div className="grid w-full max-w-sm grid-cols-[1fr_88px_1fr] items-center gap-4">
              <button
                type="button"
                onClick={reviewFrames}
                disabled={frames.length === 0}
                className="justify-self-end rounded-lg border border-white/20 bg-black/40 px-3 py-2 text-xs font-semibold backdrop-blur disabled:opacity-30"
              >
                Review
              </button>
              <button
                type="button"
                onClick={() => void captureFrame()}
                disabled={!cameraReady || frames.length >= targetFrameCount}
                className="flex h-[88px] w-[88px] items-center justify-center rounded-full border-[5px] border-white bg-white/15 transition active:scale-95 disabled:opacity-40"
                aria-label="Capture frame"
                title="Capture frame"
              >
                <span className="h-[62px] w-[62px] rounded-full bg-[#f2c14e]" />
              </button>
              <button
                type="button"
                onClick={reviewFrames}
                disabled={frames.length < MIN_CAPTURE_FRAMES}
                className="justify-self-start rounded-lg bg-[#f2c14e] px-3 py-2 text-xs font-bold text-[#07100e] disabled:opacity-30"
              >
                Finish
              </button>
            </div>
          </div>
        </main>
      ) : null}

      {phase === "review" ? (
        <main className="flex-1 bg-[#f5f6f3] px-4 py-6 text-[#15201d] md:px-6 md:py-8">
          <div className="mx-auto max-w-5xl">
            <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
              <div>
                <p className="text-xs font-semibold uppercase text-emerald-700">Quality review</p>
                <h2 className="mt-1 font-display text-3xl">Keep the room crisp and connected</h2>
                <p className="mt-2 text-sm text-[#52605c]">
                  {qualitySummary.good} ready, {qualitySummary.check} to check, {qualitySummary.poor}{" "}
                  weak. Keep at least {MIN_CAPTURE_FRAMES} overlapping frames.
                </p>
              </div>
              <button
                type="button"
                onClick={() => void resumeCamera()}
                className="flex h-10 items-center justify-center gap-2 rounded-lg border border-[#15201d]/15 bg-white px-3 text-sm font-semibold hover:bg-[#e9ece7]"
              >
                <RotateCcw size={16} aria-hidden="true" />
                Capture more
              </button>
            </div>

            {error ? (
              <div className="mt-5 flex gap-3 rounded-lg border border-red-300 bg-red-50 px-3 py-3 text-sm text-red-800">
                <AlertTriangle className="mt-0.5 shrink-0" size={17} aria-hidden="true" />
                <p>{error}</p>
              </div>
            ) : null}

            <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {frames.map((frame, index) => (
                <article
                  key={frame.id}
                  className="group relative aspect-[4/3] overflow-hidden rounded-lg bg-[#dfe4df]"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={frame.preview}
                    alt={`Capture frame ${index + 1}`}
                    className="h-full w-full object-cover"
                  />
                  <div className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-black/65 px-2 py-1.5 text-[11px] text-white backdrop-blur-sm">
                    <span className="font-mono">{String(index + 1).padStart(2, "0")}</span>
                    <span
                      className={
                        frame.quality.rating === "good" ? "text-emerald-300" : "text-amber-200"
                      }
                    >
                      {qualityLabel(frame.quality)}
                    </span>
                  </div>
                  {frame.uploadState === "done" ? (
                    <span className="absolute left-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-emerald-400 text-emerald-950">
                      <Check size={15} aria-hidden="true" />
                    </span>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => removeFrame(frame.id)}
                    disabled={frame.uploadState === "done"}
                    className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-lg bg-black/65 text-white opacity-100 backdrop-blur transition hover:bg-red-600 disabled:hidden md:opacity-0 md:group-hover:opacity-100"
                    aria-label={`Remove frame ${index + 1}`}
                    title="Remove frame"
                  >
                    <Trash2 size={15} aria-hidden="true" />
                  </button>
                </article>
              ))}
            </div>

            <div className="sticky bottom-0 mt-8 flex flex-col-reverse gap-2 border-t border-[#15201d]/10 bg-[#f5f6f3]/95 py-4 backdrop-blur sm:flex-row sm:items-center sm:justify-between">
              <button
                type="button"
                onClick={() => void closeCapture()}
                className="flex h-11 items-center justify-center gap-2 rounded-lg px-3 text-sm font-semibold text-[#52605c] hover:bg-[#e9ece7]"
              >
                <ChevronLeft size={17} aria-hidden="true" />
                Leave capture
              </button>
              <button
                type="button"
                onClick={() => void uploadFrames()}
                disabled={frames.length < MIN_CAPTURE_FRAMES}
                className="flex h-11 items-center justify-center gap-2 rounded-lg bg-[#15201d] px-5 text-sm font-bold text-white hover:bg-black disabled:opacity-40"
              >
                <Upload size={17} aria-hidden="true" />
                Upload {frames.length - readyCount} frames
              </button>
            </div>
          </div>
        </main>
      ) : null}

      {phase === "uploading" ? (
        <main className="mx-auto flex w-full max-w-lg flex-1 flex-col items-center justify-center px-5 text-center">
          <LoaderCircle className="animate-spin text-[#f2c14e]" size={42} aria-hidden="true" />
          <h2 className="mt-6 font-display text-3xl">Securing room frames</h2>
          <p className="mt-2 text-sm text-white/60">
            Uploading directly to protected object storage. Keep this window open.
          </p>
          <div className="mt-7 h-2 w-full overflow-hidden rounded-sm bg-white/15">
            <div
              className="h-full bg-[#f2c14e] transition-[width] duration-300"
              style={{ width: `${Math.round((uploadProgress / frames.length) * 100)}%` }}
            />
          </div>
          <p className="mt-3 font-mono text-xs text-white/55">
            {uploadProgress} / {frames.length}
          </p>
        </main>
      ) : null}

      {phase === "done" ? (
        <main className="mx-auto flex w-full max-w-lg flex-1 flex-col items-center justify-center px-5 text-center">
          <span className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-400 text-emerald-950">
            <Check size={30} aria-hidden="true" />
          </span>
          <p className="mt-6 text-xs font-semibold uppercase text-emerald-300">Capture complete</p>
          <h2 className="mt-2 font-display text-4xl">{roomName} is ready</h2>
          <p className="mt-3 text-sm leading-6 text-white/60">
            {buildQueued
              ? `${frames.length} protected frames are uploaded. Your room build has started.`
              : allowPhotogrammetry
                ? `${frames.length} protected frames are uploaded and ready to build.`
                : `${frames.length} protected frames are saved. Upgrade to Pro to build the room.`}
          </p>
          {buildError ? (
            <div className="mt-5 flex max-w-md gap-3 rounded-lg border border-amber-300/25 bg-amber-300/10 px-3 py-3 text-left text-sm text-amber-100">
              <AlertTriangle className="mt-0.5 shrink-0" size={17} aria-hidden="true" />
              <p>{buildError}. You can retry from the room scan list.</p>
            </div>
          ) : null}
          <button
            type="button"
            onClick={onClose}
            className="mt-7 flex h-12 items-center justify-center gap-2 rounded-lg bg-[#f2c14e] px-5 text-sm font-bold text-[#07100e] hover:bg-[#ffd166]"
          >
            <Check size={17} aria-hidden="true" />
            {buildQueued ? "View build progress" : "Return to studio"}
          </button>
        </main>
      ) : null}
    </div>
  );
}
