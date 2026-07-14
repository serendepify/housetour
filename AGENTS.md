# HouseTour — Agent Notes

## Product

B2B SaaS for real-estate agencies: professional 360° / mesh upload → continuous walkable 3D + WebXR tours, branded embeds, subscription billing.

## Stack

- pnpm monorepo
- `apps/web` — Next.js App Router
- `apps/worker` — BullMQ processors
- `packages/db` — Prisma 7 + PostgreSQL
- `packages/tour-engine` — tour graph + viewer helpers
- `packages/api-contract` — Zod DTOs
- `packages/pipeline` — pano + photogrammetry stages (COLMAP optional)
- Docker Compose: Postgres 18, Redis, MinIO
- Deploy: `Dockerfile` / `Dockerfile.worker`, `deploy/`, `.github/workflows/`

## Commands

```bash
pnpm setup          # install + docker up + migrate + seed
pnpm dev            # web + worker
pnpm db:migrate
pnpm db:seed
```

## Demo login

- Email: `agent@housetour.demo`
- Password: `housetour-demo`
- Public demo tour: `/t/demo-loft`

## Conventions

- Never hardcode tour/business data in UI — load from API/Prisma/seed
- Tenant isolation via `organizationId`
- Money fields: `Decimal @db.Decimal(10, 2)`
- Prisma env loaded from workspace-root `.env` via `packages/db/src/load-env.ts`
