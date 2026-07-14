import { authOptions } from "@/lib/auth";
import { env } from "@/lib/env";
import { getStripe } from "@/lib/stripe";
import { prisma } from "@housetour/db";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";

export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.organizationId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const stripe = getStripe();
  if (!stripe) {
    return NextResponse.json(
      { error: "Stripe not configured" },
      { status: 400 },
    );
  }

  const sub = await prisma.subscription.findUnique({
    where: { organizationId: session.user.organizationId },
  });
  if (!sub?.stripeCustomerId) {
    return NextResponse.json(
      { error: "No Stripe customer on file" },
      { status: 400 },
    );
  }

  const portal = await stripe.billingPortal.sessions.create({
    customer: sub.stripeCustomerId,
    return_url: `${env.appUrl}/app/billing`,
  });

  return NextResponse.json({ url: portal.url });
}
