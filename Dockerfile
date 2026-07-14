# Multi-stage production image: HouseTour monorepo (Next.js standalone + Prisma 7)
# Also used as migrator image: `node packages/db/node_modules/prisma/build/index.js migrate deploy`
# (or `pnpm --filter @housetour/db exec prisma migrate deploy` when full tree is present)

FROM node:22-bookworm-slim AS base
WORKDIR /app
RUN corepack enable && apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

FROM base AS deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
COPY packages/db/package.json packages/db/
COPY packages/api-contract/package.json packages/api-contract/
COPY packages/tour-engine/package.json packages/tour-engine/
COPY packages/pipeline/package.json packages/pipeline/
RUN pnpm install --frozen-lockfile || pnpm install

FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps ./apps
COPY --from=deps /app/packages ./packages
COPY --from=deps /app/package.json /app/pnpm-workspace.yaml /app/pnpm-lock.yaml ./
COPY . .

ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

# NEXT_PUBLIC_* inlined at build time
ARG NEXT_PUBLIC_APP_URL=http://localhost:3000
ARG NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=
ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL
ENV NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=$NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY

RUN pnpm --filter @housetour/db generate \
  && pnpm --filter @housetour/api-contract build \
  && pnpm --filter @housetour/tour-engine build \
  && pnpm --filter @housetour/pipeline build \
  && pnpm --filter @housetour/db build \
  && pnpm --filter @housetour/web build

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

LABEL org.opencontainers.image.source="https://github.com/serendepify/housetour"
LABEL org.opencontainers.image.title="HouseTour"
LABEL org.opencontainers.image.description="B2B 3D real-estate tour platform"
LABEL org.opencontainers.image.licenses="UNLICENSED"

RUN groupadd --system --gid 1001 nodejs \
  && useradd --system --uid 1001 --gid nodejs nextjs

# Standalone Next server
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/public ./apps/web/public

# Prisma 7 + migrations for one-shot migrate containers
COPY --from=builder --chown=nextjs:nodejs /app/packages/db/prisma ./packages/db/prisma
COPY --from=builder --chown=nextjs:nodejs /app/packages/db/prisma.config.ts ./packages/db/prisma.config.ts
COPY --from=builder --chown=nextjs:nodejs /app/packages/db/package.json ./packages/db/package.json
COPY --from=builder --chown=nextjs:nodejs /app/packages/db/src ./packages/db/src
COPY --from=builder --chown=nextjs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nextjs:nodejs /app/packages/db/node_modules ./packages/db/node_modules
COPY --from=builder --chown=nextjs:nodejs /app/package.json ./package.json
COPY --from=builder --chown=nextjs:nodejs /app/pnpm-workspace.yaml ./pnpm-workspace.yaml

USER nextjs
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
