import { env } from "@/lib/env";
import { getStripe } from "@/lib/stripe";
import { prisma } from "@housetour/db";
import { NextResponse } from "next/server";
import type Stripe from "stripe";

async function applyPlanFromSubscription(
  stripeSub: Stripe.Subscription,
  organizationId?: string | null,
  planCode?: string | null,
) {
  const orgId =
    organizationId ||
    stripeSub.metadata?.organizationId ||
    (await prisma.subscription.findFirst({
      where: { stripeSubscriptionId: stripeSub.id },
      select: { organizationId: true },
    }))?.organizationId;

  if (!orgId) return;

  let plan =
    planCode || stripeSub.metadata?.planCode
      ? await prisma.plan.findUnique({
          where: { code: planCode || stripeSub.metadata.planCode },
        })
      : null;

  if (!plan) {
    const priceId = stripeSub.items.data[0]?.price?.id;
    if (priceId) {
      plan = await prisma.plan.findFirst({
        where: { stripePriceId: priceId },
      });
    }
  }

  const status =
    stripeSub.status === "active" || stripeSub.status === "trialing"
      ? "active"
      : stripeSub.status === "past_due"
        ? "past_due"
        : stripeSub.status === "canceled"
          ? "canceled"
          : stripeSub.status;

  // Stripe SDK shapes vary by API version; read period end defensively
  const rawPeriod = (stripeSub as unknown as { current_period_end?: number })
    .current_period_end;
  const periodEnd =
    typeof rawPeriod === "number" ? new Date(rawPeriod * 1000) : undefined;

  const customerId =
    typeof stripeSub.customer === "string"
      ? stripeSub.customer
      : stripeSub.customer?.id;

  if (plan) {
    await prisma.subscription.upsert({
      where: { organizationId: orgId },
      create: {
        organizationId: orgId,
        planId: plan.id,
        status,
        stripeCustomerId: customerId,
        stripeSubscriptionId: stripeSub.id,
        currentPeriodEnd: periodEnd,
      },
      update: {
        planId: plan.id,
        status,
        stripeCustomerId: customerId,
        stripeSubscriptionId: stripeSub.id,
        currentPeriodEnd: periodEnd,
      },
    });
  } else {
    await prisma.subscription.updateMany({
      where: { organizationId: orgId },
      data: {
        status,
        stripeCustomerId: customerId,
        stripeSubscriptionId: stripeSub.id,
        currentPeriodEnd: periodEnd,
      },
    });
  }
}

export async function POST(req: Request) {
  const stripe = getStripe();
  if (!stripe || !env.stripe.webhookSecret) {
    return NextResponse.json(
      { error: "Stripe webhook not configured" },
      { status: 400 },
    );
  }

  const sig = req.headers.get("stripe-signature");
  if (!sig) {
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  }

  const raw = await req.text();
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(raw, sig, env.stripe.webhookSecret);
  } catch {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const organizationId = session.metadata?.organizationId;
        const planCode = session.metadata?.planCode;
        if (organizationId && planCode) {
          const plan = await prisma.plan.findUnique({
            where: { code: planCode },
          });
          if (plan) {
            await prisma.subscription.upsert({
              where: { organizationId },
              create: {
                organizationId,
                planId: plan.id,
                status: "active",
                stripeCustomerId:
                  typeof session.customer === "string"
                    ? session.customer
                    : undefined,
                stripeSubscriptionId:
                  typeof session.subscription === "string"
                    ? session.subscription
                    : undefined,
              },
              update: {
                planId: plan.id,
                status: "active",
                stripeCustomerId:
                  typeof session.customer === "string"
                    ? session.customer
                    : undefined,
                stripeSubscriptionId:
                  typeof session.subscription === "string"
                    ? session.subscription
                    : undefined,
              },
            });
          }
        }
        // Prefer full subscription object when present
        if (
          typeof session.subscription === "string" &&
          organizationId
        ) {
          const sub = await stripe.subscriptions.retrieve(session.subscription);
          await applyPlanFromSubscription(sub, organizationId, planCode);
        }
        break;
      }

      case "customer.subscription.created":
      case "customer.subscription.updated": {
        const sub = event.data.object as Stripe.Subscription;
        await applyPlanFromSubscription(sub);
        break;
      }

      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;
        const existing = await prisma.subscription.findFirst({
          where: { stripeSubscriptionId: sub.id },
        });
        if (existing) {
          const starter = await prisma.plan.findUnique({
            where: { code: "starter" },
          });
          await prisma.subscription.update({
            where: { id: existing.id },
            data: {
              status: "canceled",
              planId: starter?.id ?? existing.planId,
              stripeSubscriptionId: null,
              currentPeriodEnd: null,
            },
          });
        }
        break;
      }

      case "invoice.paid":
      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        const inv = invoice as unknown as {
          subscription?: string | { id: string } | null;
        };
        const subId =
          typeof inv.subscription === "string"
            ? inv.subscription
            : inv.subscription?.id;
        if (subId) {
          const sub = await stripe.subscriptions.retrieve(subId);
          await applyPlanFromSubscription(sub);
          if (event.type === "invoice.payment_failed") {
            await prisma.subscription.updateMany({
              where: { stripeSubscriptionId: subId },
              data: { status: "past_due" },
            });
          }
        }
        break;
      }

      default:
        break;
    }
  } catch (e) {
    console.error("[stripe webhook]", event.type, e);
    return NextResponse.json(
      { error: "Webhook handler failed" },
      { status: 500 },
    );
  }

  return NextResponse.json({ received: true });
}
