import { TourViewerLazy } from "@/components/tour/TourViewerLazy";
import { authOptions } from "@/lib/auth";
import { buildTourManifestById } from "@/lib/manifest";
import { getServerSession } from "next-auth";
import { X } from "lucide-react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ scene?: string }>;
};

export default async function PrivateTourPreviewPage({ params, searchParams }: Props) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.organizationId) redirect("/login");
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const manifest = await buildTourManifestById(id, session.user.organizationId);
  if (!manifest || manifest.scenes.length === 0) notFound();

  const requestedScene = manifest.scenes.find((scene) => scene.id === query.scene);
  const previewManifest = requestedScene
    ? {
        ...manifest,
        startSceneId: requestedScene.id,
        floors: [],
        scenes: [{ ...requestedScene, hotspots: [] }],
        flags: { ...manifest.flags, showFloorPlan: false },
      }
    : manifest;

  return (
    <div className="relative h-[calc(100dvh-8rem)] min-h-[620px] overflow-hidden rounded-lg bg-ink-950 shadow-panel">
      <TourViewerLazy
        manifest={previewManifest}
        mode="studio"
        className="h-full min-h-0 w-full"
      />
      <Link
        href={`/app/tours/${id}`}
        aria-label="Close room preview"
        className="absolute right-4 top-4 z-30 inline-flex h-10 w-10 items-center justify-center gap-2 rounded-lg border border-white/15 bg-black/55 text-xs font-semibold text-white backdrop-blur hover:bg-black/75 sm:w-auto sm:px-3"
      >
        <X size={16} />
        <span className="hidden sm:inline">Close preview</span>
      </Link>
    </div>
  );
}
