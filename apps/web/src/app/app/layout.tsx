import { authOptions } from "@/lib/auth";
import { prisma } from "@housetour/db";
import { getServerSession } from "next-auth";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Building2, CreditCard } from "lucide-react";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) redirect("/login");

  const org = session.user.organizationId
    ? await prisma.organization.findUnique({
        where: { id: session.user.organizationId },
        include: { subscription: { include: { plan: true } } },
      })
    : null;

  return (
    <div className="min-h-screen bg-[#f4f6f4] text-ink-900">
      <header className="sticky top-0 z-40 border-b border-ink-900/10 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1440px] items-center justify-between px-4 py-3 md:px-6">
          <div className="flex min-w-0 items-center gap-4 md:gap-8">
            <Link href="/app" className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-ink-950 text-xs font-bold text-gold-300">
                H
              </span>
              <span className="hidden text-base font-bold text-ink-950 sm:inline">HouseTour</span>
            </Link>
            <nav className="flex items-center gap-1 text-sm text-ink-600">
              <Link href="/app" className="flex h-9 items-center gap-2 rounded-lg px-2.5 font-semibold hover:bg-ink-100 hover:text-ink-950">
                <Building2 size={16} aria-hidden="true" />
                <span className="hidden sm:inline">Listings</span>
              </Link>
              <Link href="/app/billing" className="flex h-9 items-center gap-2 rounded-lg px-2.5 font-semibold hover:bg-ink-100 hover:text-ink-950">
                <CreditCard size={16} aria-hidden="true" />
                <span className="hidden sm:inline">Billing</span>
              </Link>
            </nav>
          </div>
          <div className="flex min-w-0 items-center gap-2 text-right text-sm">
            <div className="hidden min-w-0 sm:block">
              <p className="truncate font-semibold text-ink-950">{org?.name ?? "Workspace"}</p>
              <p className="truncate text-[11px] text-ink-500">{org?.subscription?.plan.name ?? "No plan"} plan</p>
            </div>
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-100 text-xs font-bold text-emerald-800">
              {(session.user.name ?? session.user.email ?? "W").slice(0, 1).toUpperCase()}
            </span>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-[1440px] px-4 py-6 md:px-6">{children}</main>
    </div>
  );
}
