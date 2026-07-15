import { CreateTourForm } from "@/components/app/CreateTourForm";
import { authOptions } from "@/lib/auth";
import { prisma } from "@housetour/db";
import {
  ArrowRight,
  BadgeCheck,
  Building2,
  Camera,
  Clock3,
  Eye,
  HardDrive,
  MapPin,
  ScanLine,
} from "lucide-react";
import { getServerSession } from "next-auth";
import Link from "next/link";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

function formatMoney(value: { listPrice: { toString(): string } | null; currency: string } | null) {
  if (!value?.listPrice) return null;
  try {
    return new Intl.NumberFormat("en", {
      style: "currency",
      currency: value.currency,
      maximumFractionDigits: 0,
    }).format(Number(value.listPrice));
  } catch {
    return `${value.currency} ${Number(value.listPrice).toLocaleString()}`;
  }
}

export default async function AppHomePage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.organizationId) redirect("/login");

  const organizationId = session.user.organizationId;
  const [tours, organization] = await Promise.all([
    prisma.tour.findMany({
      where: { organizationId, archivedAt: null },
      orderBy: { updatedAt: "desc" },
      include: {
        property: true,
        captureSessions: {
          where: { status: "READY" },
          orderBy: { completedAt: "desc" },
          select: { id: true },
        },
        jobs: {
          where: { status: { in: ["QUEUED", "RUNNING"] } },
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { progress: true, status: true },
        },
        _count: { select: { scenes: true, assets: true, captureSessions: true } },
      },
    }),
    prisma.organization.findUnique({
      where: { id: organizationId },
      include: { subscription: { include: { plan: true } } },
    }),
  ]);

  const plan = organization?.subscription?.plan;
  const liveCount = tours.filter((tour) => tour.published && tour._count.scenes > 0).length;
  const roomCount = tours.reduce((total, tour) => total + tour._count.scenes, 0);
  const storageGb = Number(organization?.storageUsedBytes ?? 0) / 1024 ** 3;
  const storageLimitGb = plan ? Number(plan.maxStorageBytes) / 1024 ** 3 : 0;

  return (
    <div className="space-y-6 pb-12">
      <header className="flex flex-col gap-4 border-b border-ink-900/10 pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-bold uppercase text-sea">Portfolio</p>
          <h1 className="mt-1 text-2xl font-semibold text-ink-950">Listings</h1>
          <p className="mt-1 text-sm text-ink-500">Capture rooms, review the private walkthrough, then publish.</p>
        </div>
        <CreateTourForm />
      </header>

      <section className="grid grid-cols-2 overflow-hidden rounded-lg border border-ink-900/10 bg-white shadow-sm lg:grid-cols-4">
        <div className="border-b border-r border-ink-900/10 p-4 lg:border-b-0">
          <div className="flex items-center gap-2 text-xs font-semibold text-ink-500"><Building2 size={15} /> Listings</div>
          <p className="mt-2 text-xl font-semibold text-ink-950">{tours.length}<span className="ml-1 text-xs font-normal text-ink-400">of {plan?.maxActiveTours ?? "-"}</span></p>
        </div>
        <div className="border-b border-ink-900/10 p-4 lg:border-b-0 lg:border-r">
          <div className="flex items-center gap-2 text-xs font-semibold text-ink-500"><BadgeCheck size={15} /> Live</div>
          <p className="mt-2 text-xl font-semibold text-ink-950">{liveCount}</p>
        </div>
        <div className="border-r border-ink-900/10 p-4">
          <div className="flex items-center gap-2 text-xs font-semibold text-ink-500"><ScanLine size={15} /> Built rooms</div>
          <p className="mt-2 text-xl font-semibold text-ink-950">{roomCount}</p>
        </div>
        <div className="p-4">
          <div className="flex items-center gap-2 text-xs font-semibold text-ink-500"><HardDrive size={15} /> Storage</div>
          <p className="mt-2 text-xl font-semibold text-ink-950">{storageGb.toFixed(2)}<span className="ml-1 text-xs font-normal text-ink-400">of {storageLimitGb || "-"} GB</span></p>
        </div>
      </section>

      {tours.length > 0 ? (
        <section className="overflow-hidden rounded-lg border border-ink-900/10 bg-white shadow-sm">
          <div className="hidden grid-cols-[minmax(0,1.4fr)_0.8fr_0.7fr_auto] border-b border-ink-900/10 bg-ink-100/60 px-4 py-2.5 text-[10px] font-bold uppercase text-ink-500 md:grid">
            <span>Property</span><span>Progress</span><span>Performance</span><span className="text-right">Actions</span>
          </div>
          <ul className="divide-y divide-ink-900/10">
            {tours.map((tour) => {
              const activeJob = tour.jobs[0];
              const hasRooms = tour._count.scenes > 0;
              const hasCapture = tour.captureSessions.length > 0;
              const workflow = [true, tour._count.captureSessions > 0 || tour._count.assets > 0, hasRooms, tour.published];
              const progress = Math.round((workflow.filter(Boolean).length / workflow.length) * 100);
              const status = activeJob
                ? `Building ${activeJob.progress}%`
                : tour.published && hasRooms
                  ? "Live"
                  : hasRooms
                    ? "Ready to publish"
                    : hasCapture
                      ? "Ready to build"
                      : "Needs capture";
              const location = [tour.property?.addressLine1, tour.property?.city, tour.property?.region].filter(Boolean).join(", ");
              const price = formatMoney(tour.property);

              return (
                <li key={tour.id} className="grid gap-4 p-4 md:grid-cols-[minmax(0,1.4fr)_0.8fr_0.7fr_auto] md:items-center">
                  <div className="flex min-w-0 gap-3">
                    <div className="relative h-20 w-24 shrink-0 overflow-hidden rounded-lg bg-ink-100">
                      {tour.coverUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={tour.coverUrl} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <span className="flex h-full w-full items-center justify-center text-ink-300"><Building2 size={24} /></span>
                      )}
                    </div>
                    <div className="min-w-0 py-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="truncate text-sm font-semibold text-ink-950">{tour.property?.title ?? tour.title}</h2>
                        <span className={`rounded-full px-2 py-0.5 text-[9px] font-bold uppercase ${tour.published && hasRooms ? "bg-emerald-100 text-emerald-800" : activeJob ? "bg-sky-100 text-sky-800" : "bg-ink-100 text-ink-600"}`}>{status}</span>
                      </div>
                      <p className="mt-1 flex items-center gap-1 truncate text-xs text-ink-500"><MapPin className="shrink-0" size={12} />{location || "Address not added"}</p>
                      <p className="mt-1 text-xs font-semibold text-ink-700">{price ?? (tour.property?.listingType === "RENT" ? "Rental" : "For sale")}{tour.property?.bedrooms != null ? ` - ${tour.property.bedrooms} bd` : ""}{tour.property?.bathrooms != null ? ` - ${tour.property.bathrooms.toString()} ba` : ""}</p>
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center justify-between text-xs"><span className="font-semibold text-ink-700">{status}</span><span className="text-ink-400">{progress}%</span></div>
                    <div className="mt-2 flex gap-1" aria-label={`${progress}% complete`}>{workflow.map((done, index) => <span key={index} className={`h-1.5 flex-1 rounded-full ${done ? "bg-emerald-600" : "bg-ink-100"}`} />)}</div>
                    <p className="mt-2 text-[11px] text-ink-500">{tour._count.captureSessions} scans - {tour._count.scenes} viewer rooms</p>
                  </div>

                  <div className="flex items-center gap-5 text-xs text-ink-500 md:block">
                    <p className="flex items-center gap-1.5"><Eye size={13} /> <strong className="text-ink-800">{tour.viewCount}</strong> views</p>
                    <p className="mt-0 md:mt-2 flex items-center gap-1.5"><Clock3 size={13} /> Updated {tour.updatedAt.toLocaleDateString()}</p>
                  </div>

                  <div className="flex flex-wrap justify-start gap-2 md:justify-end">
                    {!hasCapture && !hasRooms ? (
                      <Link href={`/app/tours/${tour.id}?capture=1`} className="inline-flex h-9 items-center gap-2 rounded-lg bg-ink-950 px-3 text-xs font-bold text-white hover:bg-ink-800"><Camera size={14} /> Start scan</Link>
                    ) : (
                      <Link href={`/app/tours/${tour.id}`} className="inline-flex h-9 items-center gap-2 rounded-lg bg-ink-950 px-3 text-xs font-bold text-white hover:bg-ink-800">Open studio <ArrowRight size={14} /></Link>
                    )}
                    {hasRooms ? <Link href={`/app/tours/${tour.id}/preview`} target="_blank" className="inline-flex h-9 items-center gap-2 rounded-lg border border-ink-900/15 px-3 text-xs font-bold text-ink-700 hover:bg-ink-100"><Eye size={14} /> Preview</Link> : null}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ) : (
        <section className="flex min-h-80 flex-col items-center justify-center rounded-lg border border-dashed border-ink-900/20 bg-white px-6 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-lg bg-emerald-100 text-emerald-800"><Building2 size={22} /></span>
          <h2 className="mt-4 text-lg font-semibold text-ink-950">Create your first listing</h2>
          <p className="mt-1 max-w-sm text-sm text-ink-500">Add the property once, then capture each room inside the correct listing workspace.</p>
          <div className="mt-5"><CreateTourForm /></div>
        </section>
      )}
    </div>
  );
}
