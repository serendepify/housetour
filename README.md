# HouseTour

High-end **B2B 3D real estate tour platform**: professional 360° / multi-view capture intake → continuous walkable 3D + WebXR experiences → branded public links & embeds → subscription billing.

## What you get

- Marketing site with live embedded demo
- Agency auth, org workspace, tour inventory
- Tour studio: asset upload (MinIO/S3), **pano walk** or **photogrammetry** process, publish
- Walkable multi-room panorama player (hotspots, keyboard, floor plan, VR entry)
- Mesh walk mode for reconstructed GLB rooms
- BullMQ worker with staged pipeline progress (+ API fallback if Redis is down)
- Stripe Checkout + Customer Portal + live webhook entitlements (local plan switch without keys)
- Seeded Harbor Loft demo tour
- CI + ship-to-VPS deploy scaffolding (GHCR, compose, Caddy, rollback)

## Stack

| Layer | Tech |
|-------|------|
| Web | Next.js 15, React 19, Tailwind, R3F / Three.js |
| API | Next.js Route Handlers |
| DB | PostgreSQL 18 + Prisma 7 |
| Queue | Redis + BullMQ |
| Storage | MinIO (S3 API) |
| Pipeline | `@housetour/pipeline` (pano + photogrammetry stages) |
| Worker | Node / tsx |

## Quick start

```bash
cp .env.example .env
pnpm install
pnpm docker:up
# wait ~5s for postgres/redis/minio
pnpm db:generate
pnpm --filter @housetour/db exec prisma migrate deploy
pnpm db:seed
pnpm --filter @housetour/web generate-demo-assets
pnpm dev
```

Or one-shot: `pnpm setup` then `pnpm --filter @housetour/web generate-demo-assets && pnpm dev`.

Open:

- Marketing: http://localhost:3000  
- Demo tour: http://localhost:3000/t/demo-loft  
- Login: `agent@housetour.demo` / `housetour-demo`  
- Studio: http://localhost:3000/app  

## Capture pipeline

### Pano walk (all plans)

1. Create a tour in the dashboard  
2. Upload equirectangular 360° JPEGs (optional floor plan / GLB)  
3. **Process tour → Pano walk** → ordered panos become scenes with bidirectional hotspots  
4. **Publish** → share `/t/{slug}` or embed `/embed/{slug}`  

### Photogrammetry (Pro / Studio)

1. Upload 360s and/or multi-view images  
2. **Process tour → Photogrammetry**  
3. Pipeline stages: ingest → features → match → sparse → dense → mesh → nav → publish  
4. Software reconstruction builds a room hull GLB + point cloud; **COLMAP** is used when installed on the worker  
5. Viewer offers panorama walk **and** mesh orbit mode  

## Stripe (live billing)

Set in `.env`:

```bash
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_...
STRIPE_PRICE_STARTER=price_...
STRIPE_PRICE_PRO=price_...
STRIPE_PRICE_STUDIO=price_...
```

Webhook endpoint: `POST /api/webhooks/stripe`  
Events handled: `checkout.session.completed`, `customer.subscription.*`, `invoice.paid`, `invoice.payment_failed`.

Without Stripe keys, Billing still switches plans locally for demos.

Local Stripe CLI:

```bash
stripe listen --forward-to localhost:3000/api/webhooks/stripe
```

## Deploy (ship-to-VPS)

Artifacts:

| Path | Purpose |
|------|---------|
| `Dockerfile` | Production web (standalone Next + Prisma migrate) |
| `Dockerfile.worker` | BullMQ worker |
| `deploy/docker-compose.yml` | VPS compose (postgres, redis, minio, web, worker) |
| `deploy/Caddyfile.snippet` | TLS reverse proxy snippet |
| `.github/workflows/ci.yml` | Install, migrate, test, build |
| `.github/workflows/deploy.yml` | Build → GHCR → VPS roll |
| `bin/logs` / `bin/rollback` | Ops helpers |

VPS bootstrap (once):

1. Copy `deploy/docker-compose.yml` → `/opt/housetour/docker-compose.yml`  
2. Create `/opt/housetour/.env` from `.env.example` (production secrets)  
3. Point Caddy at host port (`HOST_PORT`, default 13000)  
4. Set GitHub secrets: `VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY`  
5. Optional vars: `NEXT_PUBLIC_APP_URL`, `SMOKE_URL`  
6. Push to `main` — deploy workflow builds images and rolls containers  

```bash
# From laptop after secrets are set
VPS_HOST=x.x.x.x bin/logs web
VPS_HOST=x.x.x.x bin/rollback bootstrap
```

## Scripts

| Command | Description |
|---------|-------------|
| `pnpm dev` | Web + worker |
| `pnpm db:seed` | Plans, demo org, Harbor Loft tour |
| `pnpm docker:up` | Postgres, Redis, MinIO |
| `pnpm test` | Tour-engine unit tests |
| `pnpm --filter @housetour/web generate-demo-assets` | Synthetic 360s for demo |

## Repo layout

```
apps/web              Next.js product
apps/worker           BullMQ processors
packages/db           Prisma schema + client
packages/api-contract Zod DTOs / TourManifest
packages/tour-engine  Scene graph helpers
packages/pipeline     Photogrammetry + pano process stages
deploy/               Production compose + Caddy snippet
.github/workflows/    CI + deploy
```

## License

Proprietary — Serendepify / HouseTour
