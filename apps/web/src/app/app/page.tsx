import { authOptions } from "@/lib/auth";
import { prisma } from "@housetour/db";
import { getServerSession } from "next-auth";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CreateTourForm } from "@/components/app/CreateTourForm";

export const dynamic = "force-dynamic";

const statusStyles: Record<string, string> = {
  READY: "bg-emerald-100 text-emerald-800",
  DRAFT: "bg-slate-100 text-slate-700",
  PROCESSING: "bg-amber-100 text-amber-800",
  UPLOADING: "bg-sky-100 text-sky-800",
  FAILED: "bg-red-100 text-red-800",
  ARCHIVED: "bg-slate-200 text-slate-600",
};

export default async function AppHomePage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.organizationId) redirect("/login");

  const orgId = session.user.organizationId;
  const [tours, org] = await Promise.all([
    prisma.tour.findMany({
      where: { organizationId: orgId, archivedAt: null },
      orderBy: { updatedAt: "desc" },
      include: { property: true, _count: { select: { scenes: true, assets: true } } },
    }),
    prisma.organization.findUnique({
      where: { id: orgId },
      include: { subscription: { include: { plan: true } } },
    }),
  ]);

  const plan = org?.subscription?.plan;
  const activeCount = tours.filter((t) => t.status !== "ARCHIVED").length;
  const storageGb = Number(org?.storageUsedBytes ?? 0) / 1024 ** 3;
  const storageLimitGb = plan ? Number(plan.maxStorageBytes) / 1024 ** 3 : 0;

  return (
    <div className="space-y-8">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div>
          <h1 className="font-display text-3xl text-ink-950">Tour inventory</h1>
          <p className="mt-1 text-ink-500">
            Create spaces, upload 360s, process, and publish walkable tours.
          </p>
        </div>
        <div className="flex gap-3 text-sm">
          <div className="rounded-2xl border border-ink-900/10 bg-white px-4 py-3 shadow-soft">
            <p className="text-xs uppercase tracking-wider text-ink-500">Active tours</p>
            <p className="font-display text-2xl text-ink-950">
              {activeCount}
              <span className="text-sm text-ink-500"> / {plan?.maxActiveTours ?? "—"}</span>
            </p>
          </div>
          <div className="rounded-2xl border border-ink-900/10 bg-white px-4 py-3 shadow-soft">
            <p className="text-xs uppercase tracking-wider text-ink-500">Storage</p>
            <p className="font-display text-2xl text-ink-950">
              {storageGb.toFixed(2)}
              <span className="text-sm text-ink-500"> / {storageLimitGb || "—"} GB</span>
            </p>
          </div>
        </div>
      </div>

      <CreateTourForm />

      <div className="overflow-hidden rounded-2xl border border-ink-900/10 bg-white shadow-soft">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-ink-900/10 bg-ink-100/60 text-xs uppercase tracking-wider text-ink-500">
            <tr>
              <th className="px-4 py-3 font-medium">Tour</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="hidden px-4 py-3 font-medium md:table-cell">Scenes</th>
              <th className="hidden px-4 py-3 font-medium md:table-cell">Views</th>
              <th className="px-4 py-3 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {tours.map((tour) => (
              <tr key={tour.id} className="border-b border-ink-900/5 last:border-0">
                <td className="px-4 py-3">
                  <p className="font-medium text-ink-950">{tour.title}</p>
                  <p className="text-xs text-ink-500">
                    {tour.property?.title ?? "No property"} · /t/{tour.slug}
                  </p>
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${
                      statusStyles[tour.status] ?? statusStyles.DRAFT
                    }`}
                  >
                    {tour.status}
                    {tour.published ? " · live" : ""}
                  </span>
                </td>
                <td className="hidden px-4 py-3 text-ink-600 md:table-cell">
                  {tour._count.scenes} scenes · {tour._count.assets} assets
                </td>
                <td className="hidden px-4 py-3 text-ink-600 md:table-cell">{tour.viewCount}</td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-2">
                    <Link
                      href={`/app/tours/${tour.id}`}
                      className="rounded-full bg-ink-950 px-3 py-1 text-xs font-semibold text-white"
                    >
                      Studio
                    </Link>
                    {tour.published && tour.status === "READY" ? (
                      <Link
                        href={`/t/${tour.slug}`}
                        target="_blank"
                        className="rounded-full border border-ink-900/15 px-3 py-1 text-xs font-semibold text-ink-800"
                      >
                        Open
                      </Link>
                    ) : null}
                  </div>
                </td>
              </tr>
            ))}
            {tours.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-ink-500">
                  No tours yet. Create your first space above.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
