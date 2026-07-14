import Stripe from "stripe";
import { env } from "./env";

export function getStripe(): Stripe | null {
  if (!env.stripe.secretKey) return null;
  return new Stripe(env.stripe.secretKey);
}

export function stripeConfigured(): boolean {
  return Boolean(env.stripe.secretKey);
}
