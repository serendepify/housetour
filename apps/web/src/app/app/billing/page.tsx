import { authOptions } from "@/lib/auth";
import { stripeConfigured } from "@/lib/stripe";
import { prisma } from "@housetour/db";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { BillingActions } from "@/components/app/BillingActions";

export const dynamic = "force-dynamic";

export default async function BillingPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.organizationId) redirect("/login");

  const [plans, org] = await Promise.all([
    prisma.plan.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } }),
    prisma.organization.findUnique({
      where: { id: session.user.organizationId },
      include: { subscription: { include: { plan: true } } },
    }),
  ]);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-3xl text-ink-950">Billing</h1>
        <p className="mt-1 text-ink-500">
          Current plan:{" "}
          <strong>{org?.subscription?.plan.name ?? "None"}</strong>
          {stripeConfigured()
            ? " · Stripe test mode ready"
            : " · Stripe keys not configured (local entitlements still apply via seed)"}
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {plans.map((plan) => (
          <div
            key={plan.id}
            className={`rounded-2xl border bg-white p-5 shadow-soft ${
              org?.subscription?.planId === plan.id
                ? "border-gold-500"
                : "border-ink-900/10"
            }`}
          >
            <p className="text-xs uppercase tracking-wider text-ink-500">{plan.name}</p>
            <p className="mt-2 font-display text-3xl text-ink-950">
              ${Number(plan.priceMonthly).toFixed(0)}
              <span className="text-sm text-ink-500">/mo</span>
            </p>
            <ul className="mt-4 space-y-1 text-sm text-ink-600">
              <li>{plan.maxActiveTours} active tours</li>
              <li>{Math.round(Number(plan.maxStorageBytes) / 1024 ** 3)} GB storage</li>
              <li>{plan.maxSeats} seats</li>
              <li>{plan.processingMinutesIncluded} process min / mo</li>
              <li>
                {plan.allowPhotogrammetry
                  ? "Photogrammetry included"
                  : "Pano walk only"}
              </li>
              {plan.allowBranding ? <li>Custom branding</li> : null}
              {plan.allowApi ? <li>API access</li> : null}
            </ul>
            <BillingActions
              planCode={plan.code}
              isCurrent={org?.subscription?.planId === plan.id}
              stripeReady={stripeConfigured()}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
