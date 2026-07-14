import { TourViewerLazy } from "@/components/tour/TourViewerLazy";
import { buildTourManifest } from "@/lib/manifest";
import { prisma } from "@housetour/db";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const tour = await prisma.tour.findFirst({
    where: { slug, published: true },
    select: { title: true, description: true },
  });
  return {
    title: tour?.title ?? "Tour",
    description: tour?.description ?? undefined,
  };
}

export default async function PublicTourPage({ params }: Props) {
  const { slug } = await params;
  const manifest = await buildTourManifest(slug);
  if (!manifest) notFound();

  // fire-and-forget view count (best effort)
  void prisma.tour
    .updateMany({
      where: { slug, published: true },
      data: { viewCount: { increment: 1 } },
    })
    .catch(() => undefined);

  void prisma.analyticsEvent
    .create({
      data: {
        tourId: manifest.id,
        type: "VIEW",
      },
    })
    .catch(() => undefined);

  return (
    <div className="relative h-screen w-screen">
      <TourViewerLazy manifest={manifest} mode="public" className="h-full w-full" />
      <Link
        href="/"
        className="absolute left-4 top-[5.5rem] z-20 rounded-full border border-white/15 bg-black/40 px-3 py-1.5 text-[11px] uppercase tracking-wider text-white/80 backdrop-blur md:left-6"
      >
        HouseTour
      </Link>
    </div>
  );
}
