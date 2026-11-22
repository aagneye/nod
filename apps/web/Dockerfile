# Standalone Nod server: the web app and every /api route on one port, for a machine with a
# fixed public IP that HSP has allowlisted (HSP only accepts allowlisted IPs).
#
# Build from the repo root (the build needs the workspace lockfile and packages/protocol):
#   docker build -f apps/web/Dockerfile -t nod .
#   docker run --rm -p 8787:8787 --env-file apps/web/.env.local nod
#
# Runtime configuration: see apps/web/.env.example. VITE_* values and NOD_PUBLIC_URL (for the
# social preview image) are baked in at build time: pass them with --build-arg.

FROM node:22-slim AS build
WORKDIR /repo
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/protocol/package.json packages/protocol/
COPY packages/agent/package.json packages/agent/
COPY apps/web/package.json apps/web/
COPY contracts/package.json contracts/
RUN npm ci --workspace @nod/web --no-audit --no-fund
COPY packages/protocol packages/protocol
COPY apps/web apps/web
ARG VITE_API_BASE=
ARG NOD_PUBLIC_URL=
ENV VITE_API_BASE=$VITE_API_BASE NOD_PUBLIC_URL=$NOD_PUBLIC_URL
# vite build → dist/, and server/standalone.ts → .server/standalone.mjs (self-contained bundle)
RUN npm run build:standalone -w @nod/web

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production PORT=8787 HOST=0.0.0.0
COPY --from=build /repo/apps/web/dist ./dist
COPY --from=build /repo/apps/web/.server/standalone.mjs ./.server/standalone.mjs
USER node
EXPOSE 8787
CMD ["node", ".server/standalone.mjs"]
