import { TourViewerLazy } from "@/components/tour/TourViewerLazy";
import { buildTourManifest } from "@/lib/manifest";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };

export default async function EmbedTourPage({ params }: Props) {
  const { slug } = await params;
  const manifest = await buildTourManifest(slug);
  if (!manifest || !manifest.flags.allowEmbed) notFound();

  return (
    <div className="h-screen w-screen bg-black">
      <TourViewerLazy manifest={manifest} mode="embed" className="h-full w-full" />
    </div>
  );
}
