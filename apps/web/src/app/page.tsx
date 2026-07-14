import { prisma } from "@housetour/db";
import Link from "next/link";

export const dynamic = "force-dynamic";

async function getPlans() {
  return prisma.plan.findMany({
    where: { active: true },
    orderBy: { sortOrder: "asc" },
  });
}

async function getDemoTour() {
  return prisma.tour.findFirst({
    where: { slug: "demo-loft", published: true },
    select: { slug: true, title: true, viewCount: true },
  });
}

export default async function HomePage() {
  const [plans, demo] = await Promise.all([getPlans(), getDemoTour()]);

  return (
    <div className="min-h-screen">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gold-500 text-sm font-bold text-ink-950">
            HT
          </div>
          <span className="font-display text-xl tracking-tight text-white">HouseTour</span>
        </div>
        <nav className="flex items-center gap-3 text-sm">
          <a href="#features" className="hidden text-white/70 hover:text-white md:inline">
            Product
          </a>
          <a href="#pricing" className="hidden text-white/70 hover:text-white md:inline">
            Pricing
          </a>
          <Link
            href="/login"
            className="rounded-full border border-white/15 px-4 py-2 text-white/90 hover:bg-white/5"
          >
            Sign in
          </Link>
          <Link
            href="/register"
            className="rounded-full bg-gold-500 px-4 py-2 font-semibold text-ink-950 hover:bg-gold-400"
          >
            Start free
          </Link>
        </nav>
      </header>

      <main>
        <section className="mx-auto grid max-w-6xl gap-10 px-6 pb-16 pt-8 lg:grid-cols-2 lg:items-center">
          <div>
            <p className="mb-4 text-xs font-semibold uppercase tracking-[0.25em] text-gold-300">
              B2B 3D real estate platform
            </p>
            <h1 className="font-display text-4xl leading-tight text-white text-balance md:text-6xl">
              Continuous walkable 3D & VR tours agencies can sell.
            </h1>
            <p className="mt-5 max-w-xl text-lg text-white/65">
              Upload professional 360° captures and mesh assets. Publish branded, embeddable
              walkthroughs buyers can explore on desktop, mobile, and headset — without proprietary
              cameras.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                href={demo ? `/t/${demo.slug}` : "/register"}
                className="rounded-full bg-white px-6 py-3 text-sm font-semibold text-ink-950 hover:bg-ink-100"
              >
                Open live demo tour
              </Link>
              <Link
                href="/register"
                className="rounded-full border border-white/20 px-6 py-3 text-sm font-semibold text-white hover:bg-white/5"
              >
                Create agency workspace
              </Link>
            </div>
            <dl className="mt-10 grid grid-cols-3 gap-4 border-t border-white/10 pt-6 text-sm">
              <div>
                <dt className="text-white/45">Experience</dt>
                <dd className="mt-1 font-medium text-white">Walkable scene graph + VR</dd>
              </div>
              <div>
                <dt className="text-white/45">Pipeline</dt>
                <dd className="mt-1 font-medium text-white">Pano · floor plan · GLB</dd>
              </div>
              <div>
                <dt className="text-white/45">Monetize</dt>
                <dd className="mt-1 font-medium text-white">Seats · spaces · embeds</dd>
              </div>
            </dl>
          </div>

          <div className="relative">
            <div className="absolute -inset-4 rounded-[2rem] bg-gradient-to-br from-gold-500/20 via-sea/20 to-transparent blur-2xl" />
            <div className="relative overflow-hidden rounded-[1.75rem] border border-white/10 bg-ink-900 shadow-panel">
              <div className="flex items-center justify-between border-b border-white/10 px-4 py-3 text-xs text-white/50">
                <span>Live player</span>
                <span>{demo?.viewCount ?? 0} views</span>
              </div>
              <div className="aspect-[4/3] bg-ink-950">
                {demo ? (
                  <iframe
                    title="Demo tour"
                    src={`/embed/${demo.slug}`}
                    className="h-full w-full border-0"
                    allow="xr-spatial-tracking; fullscreen; gyroscope; accelerometer"
                  />
                ) : (
                  <div className="flex h-full items-center justify-center p-8 text-center text-white/50">
                    Run seed to load the Harbor Loft demo tour.
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>

        <section id="features" className="border-y border-white/10 bg-ink-900/50 py-20">
          <div className="mx-auto max-w-6xl px-6">
            <h2 className="font-display text-3xl text-white md:text-4xl">Built for production listings</h2>
            <p className="mt-3 max-w-2xl text-white/60">
              Everything an agency needs to productize virtual tours: capture intake, processing,
              branded delivery, analytics, and subscription entitlements.
            </p>
            <div className="mt-10 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
              {[
                {
                  title: "Professional capture pipeline",
                  body: "Presigned upload for equirectangular 360s, floor plans, and optional GLB meshes. Process into a continuous walk graph.",
                },
                {
                  title: "Walkable multi-room VR",
                  body: "First-person panorama walker with hotspots, keyboard navigation, floor-plan minimap, and WebXR entry points.",
                },
                {
                  title: "Studio for agents & photographers",
                  body: "Asset library, scene ordering, hotspot graph, publish controls, and embed snippets for MLS / microsites.",
                },
                {
                  title: "Agency branding",
                  body: "Org colors, CTA, and logo on the public player — tour experiences that feel like your brand, not a third-party widget.",
                },
                {
                  title: "Usage & billing",
                  body: "Plan quotas for active tours, storage, and seats. Stripe Checkout + portal when keys are configured.",
                },
                {
                  title: "Reconstruction-ready architecture",
                  body: "Multi-stage photogrammetry pipeline today (software mesh + optional COLMAP). Future LiDAR / Gaussian splat stages plug into the same queue.",
                },
              ].map((f) => (
                <article
                  key={f.title}
                  className="rounded-2xl border border-white/10 bg-ink-950/60 p-6 shadow-soft"
                >
                  <h3 className="font-display text-xl text-white">{f.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-white/60">{f.body}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="pricing" className="py-20">
          <div className="mx-auto max-w-6xl px-6">
            <h2 className="font-display text-3xl text-white md:text-4xl">Pricing that scales with inventory</h2>
            <p className="mt-3 text-white/60">Simple seat + space subscriptions. Upgrade when the book of business grows.</p>
            <div className="mt-10 grid gap-5 lg:grid-cols-3">
              {plans.map((plan) => (
                <div
                  key={plan.id}
                  className={`rounded-2xl border p-6 ${
                    plan.code === "pro"
                      ? "border-gold-500/50 bg-gradient-to-b from-gold-500/10 to-ink-900"
                      : "border-white/10 bg-ink-900/70"
                  }`}
                >
                  <p className="text-xs uppercase tracking-[0.2em] text-gold-300">{plan.name}</p>
                  <p className="mt-3 font-display text-4xl text-white">
                    ${Number(plan.priceMonthly).toFixed(0)}
                    <span className="text-base text-white/50">/mo</span>
                  </p>
                  <p className="mt-2 text-sm text-white/60">{plan.description}</p>
                  <ul className="mt-6 space-y-2 text-sm text-white/75">
                    <li>{plan.maxActiveTours} active tours</li>
                    <li>{Math.round(Number(plan.maxStorageBytes) / 1024 ** 3)} GB storage</li>
                    <li>{plan.maxSeats} seats</li>
                    {plan.allowBranding ? <li>Custom branding</li> : <li>Standard player chrome</li>}
                    {plan.allowApi ? <li>API access</li> : null}
                  </ul>
                  <Link
                    href="/register"
                    className="mt-8 block rounded-full bg-white py-2.5 text-center text-sm font-semibold text-ink-950 hover:bg-ink-100"
                  >
                    Get started
                  </Link>
                </div>
              ))}
            </div>
            {plans.length === 0 ? (
              <p className="mt-6 text-sm text-white/50">Plans appear after database seed.</p>
            ) : null}
          </div>
        </section>
      </main>

      <footer className="border-t border-white/10 py-10 text-center text-sm text-white/40">
        HouseTour · Serendepify · Continuous 3D real estate experiences
      </footer>
    </div>
  );
}
