"use client";

import type { TourManifest } from "@housetour/api-contract";
import dynamic from "next/dynamic";

const TourViewer = dynamic(
  () => import("./TourViewer").then((m) => m.TourViewer),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full w-full items-center justify-center bg-ink-950 text-white/70">
        <div className="text-center">
          <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-2 border-gold-500 border-t-transparent" />
          <p className="text-sm tracking-wide">Loading immersive tour…</p>
        </div>
      </div>
    ),
  },
);

export function TourViewerLazy(props: {
  manifest: TourManifest;
  mode?: "public" | "embed" | "studio";
  onSceneChange?: (sceneId: string) => void;
  className?: string;
}) {
  return <TourViewer {...props} />;
}
