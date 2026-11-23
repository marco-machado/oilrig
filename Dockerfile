# Oilrig: one container serves the built client and runs the world server.

FROM node:24-slim AS base
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
COPY apps/client/package.json apps/client/

# The client, built with Vite.
FROM base AS build
RUN pnpm install --frozen-lockfile
COPY tsconfig.base.json ./
COPY packages packages
COPY apps apps
RUN pnpm build

# What the server needs to run, without the build and test tools.
FROM base AS deps
RUN pnpm install --frozen-lockfile --prod --filter "@oilrig/server..."

FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8787 \
    DATA_DIR=/data \
    STATIC_DIR=/app/apps/client/dist/client
# Node runs the TypeScript sources as they are. It does not do that for files under
# node_modules, so the workspace packages stay where pnpm links to them.
COPY --from=deps /app/node_modules node_modules
COPY --from=deps /app/apps/server/node_modules apps/server/node_modules
COPY --from=deps /app/packages/shared/node_modules packages/shared/node_modules
COPY package.json pnpm-workspace.yaml ./
COPY packages/shared packages/shared
COPY apps/server/package.json apps/server/
COPY apps/server/src apps/server/src
COPY --from=build /app/apps/client/dist/client apps/client/dist/client
# The database lives in /data: mount a volume there, or it is lost with the container.
RUN mkdir /data && chown node:node /data
VOLUME /data
EXPOSE 8787
USER node
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + process.env.PORT + '/healthz').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "apps/server/src/main.ts"]
