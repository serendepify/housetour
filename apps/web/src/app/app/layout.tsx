import { authOptions } from "@/lib/auth";
import { prisma } from "@housetour/db";
import { getServerSession } from "next-auth";
import Link from "next/link";
import { redirect } from "next/navigation";

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
    <div className="min-h-screen bg-mist text-ink-900">
      <header className="border-b border-ink-900/10 bg-white/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 md:px-6">
          <div className="flex items-center gap-6">
            <Link href="/app" className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-ink-950 text-xs font-bold text-gold-300">
                HT
              </span>
              <span className="font-display text-lg text-ink-950">HouseTour</span>
            </Link>
            <nav className="hidden items-center gap-4 text-sm text-ink-700 md:flex">
              <Link href="/app" className="hover:text-ink-950">
                Tours
              </Link>
              <Link href="/app/billing" className="hover:text-ink-950">
                Billing
              </Link>
              <Link href="/t/demo-loft" className="hover:text-ink-950" target="_blank">
                Demo player
              </Link>
            </nav>
          </div>
          <div className="text-right text-sm">
            <p className="font-medium text-ink-950">{org?.name ?? "Workspace"}</p>
            <p className="text-xs text-ink-500">
              {session.user.email} · {org?.subscription?.plan.name ?? "No plan"}
            </p>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8 md:px-6">{children}</main>
    </div>
  );
}
