# syntax=docker/dockerfile:1.7

# ---- builder ----
# Installs everything (incl. dev deps) and runs the Vite client build.
FROM oven/bun:1.3.12-alpine AS builder
WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY tsconfig.json tsconfig.app.json tsconfig.node.json ./
COPY vite.config.ts ./
COPY src ./src
COPY public ./public
COPY index.html ./

# Produces dist/ (built client) and type-checks the server source.
RUN bun run build

# ---- runtime ----
FROM oven/bun:1.3.12-alpine AS runtime
WORKDIR /app

# Install Node.js alongside Bun. The app runs on Bun (fast startup, TS
# native) but deploy-time migrations use node-pg-migrate, whose ESM bin
# script uses a `tryImport` pattern that depends on Node's specific
# MODULE_NOT_FOUND error shape — Bun's module resolver throws a different
# error type and the try/catch doesn't catch it. Running node-pg-migrate
# with node (instead of bun) sidesteps the issue entirely.
RUN apk add --no-cache nodejs

# Create the non-root user up front so every subsequent layer can own files
# directly — avoids a fat final chown -R layer that duplicates node_modules
# into the image.
RUN addgroup -S app && adduser -S app -G app && chown app:app /app
USER app

ENV NODE_ENV=production
ENV PORT=3001

COPY --chown=app:app package.json bun.lock ./

# `bun install --production` keeps some dev cruft (vitest, jsdom, @rolldown,
# @babel, terser, etc.) that come in as transitive deps — they're ~50 MB of
# tooling the runtime will never touch. We prune them explicitly so the
# image drops noticeably.
#
# Also drop client-only React + drag deps: the server never renders React,
# and the drag animation libs are built into the client bundle already.
# `node-pg-migrate` is kept so Fly's `release_command` can apply pending
# migrations in the same image before rolling a new version out.
RUN bun install --frozen-lockfile --production && \
    cd node_modules && \
    rm -rf \
      @babel @biomejs @playwright @react-spring @rolldown \
      @testing-library @types @use-gesture @vitejs @vitest \
      concurrently dotenv-cli jsdom \
      lightningcss-* react react-dom supertest \
      terser typescript vite vite-plugin-pwa vitest zustand && \
    # Residual transitive dev-only cruft from the above:
    rm -rf \
      @rollup @swc acorn acorn-* babel-* csstype estree-* \
      happy-dom playwright postcss-* rollup-* tinypool tinyspy \
      workbox-* && \
    # Client-only socket.io client + its engine (server only needs socket.io):
    rm -rf socket.io-client engine.io-client && \
    # JSDOM-adjacent DOM/CSS parsing (transitive from testing tools that
    # slipped through):
    rm -rf @asamuzakjp @bramus @csstools css-tree entities parse5 saxes

COPY --from=builder --chown=app:app /app/dist ./dist
COPY --from=builder --chown=app:app /app/src/server ./src/server
COPY --from=builder --chown=app:app /app/src/shared ./src/shared
COPY --from=builder --chown=app:app /app/public ./public
COPY --from=builder --chown=app:app /app/tsconfig.json /app/tsconfig.app.json /app/tsconfig.node.json ./

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://127.0.0.1:${PORT}/api/live || exit 1

CMD ["bun", "run", "src/server/index.ts"]
