import { authOptions } from "@/lib/auth";
import { env } from "@/lib/env";
import { getStripe } from "@/lib/stripe";
import { prisma } from "@housetour/db";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { z } from "zod";

const bodySchema = z.object({
  planCode: z.enum(["starter", "pro", "studio"]),
});

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.organizationId || !session.user.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { planCode } = bodySchema.parse(await req.json());
    const plan = await prisma.plan.findUnique({ where: { code: planCode } });
    if (!plan) return NextResponse.json({ error: "Unknown plan" }, { status: 404 });

    const stripe = getStripe();
    if (!stripe) {
      // Local fallback: switch plan without Stripe
      await prisma.subscription.upsert({
        where: { organizationId: session.user.organizationId },
        create: {
          organizationId: session.user.organizationId,
          planId: plan.id,
          status: "active",
        },
        update: {
          planId: plan.id,
          status: "active",
        },
      });
      return NextResponse.json({
        message: `Local mode: switched to ${plan.name}. Configure STRIPE_SECRET_KEY for real checkout.`,
      });
    }

    const priceId =
      plan.stripePriceId ||
      env.stripe.prices[planCode as keyof typeof env.stripe.prices];
    if (!priceId) {
      return NextResponse.json(
        {
          error:
            "Stripe price ID not configured for this plan. Set STRIPE_PRICE_* env vars or plan.stripePriceId.",
        },
        { status: 400 },
      );
    }

    const org = await prisma.organization.findUniqueOrThrow({
      where: { id: session.user.organizationId },
      include: { subscription: true },
    });

    let customerId = org.subscription?.stripeCustomerId;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: session.user.email,
        name: org.name,
        metadata: { organizationId: org.id },
      });
      customerId = customer.id;
      await prisma.subscription.upsert({
        where: { organizationId: org.id },
        create: {
          organizationId: org.id,
          planId: plan.id,
          stripeCustomerId: customerId,
          status: "incomplete",
        },
        update: { stripeCustomerId: customerId },
      });
    }

    const checkout = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${env.appUrl}/app/billing?success=1`,
      cancel_url: `${env.appUrl}/app/billing?canceled=1`,
      allow_promotion_codes: true,
      billing_address_collection: "auto",
      client_reference_id: org.id,
      subscription_data: {
        metadata: {
          organizationId: org.id,
          planCode: plan.code,
        },
      },
      metadata: {
        organizationId: org.id,
        planCode: plan.code,
      },
    });

    return NextResponse.json({ url: checkout.url });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Checkout failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
