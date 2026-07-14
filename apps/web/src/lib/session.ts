import { getServerSession } from "next-auth";
import { authOptions } from "./auth";
import { prisma, type MemberRole } from "@housetour/db";

export async function requireSession() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id || !session.user.organizationId) {
    throw new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }
  return session;
}

export async function getMembership(userId: string, organizationId: string) {
  return prisma.membership.findUnique({
    where: {
      organizationId_userId: { organizationId, userId },
    },
  });
}

export async function requireOrgTour(tourId: string, organizationId: string) {
  const tour = await prisma.tour.findFirst({
    where: { id: tourId, organizationId, archivedAt: null },
  });
  if (!tour) {
    throw new Response(JSON.stringify({ error: "Tour not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }
  return tour;
}

export function canManageBilling(role?: string | null) {
  return role === "OWNER" || role === "ADMIN";
}

export type { MemberRole };
