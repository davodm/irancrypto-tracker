# ---------------------------------------------------
# Stage 1: Build JS Standalone Binary using Bun
# ---------------------------------------------------
FROM oven/bun:1-alpine AS builder
WORKDIR /app

# Copy package metadata first for effective Docker caching
COPY package.json package-lock.json ./

# Install dependencies
RUN bun install --frozen-lockfile

# Copy source files needed for build
COPY scrapers ./scrapers
COPY runtime ./runtime
COPY scripts ./scripts

# Generate registries and bundle JS into standalone binary from source
RUN bun scripts/generate-registry.mjs && \
    bun scripts/build-js.mjs && \
    bun build ./dist/track.cjs --compile --outfile /app/track-bin

# ---------------------------------------------------
# Stage 2: Minimal Production Image (<40MB Image, ~15MB RAM)
# ---------------------------------------------------
FROM oven/bun:1-alpine
WORKDIR /app

# Copy compiled standalone binary
COPY --from=builder /app/track-bin ./track-bin

RUN chmod +x ./track-bin && mkdir -p ./logs && chown -R bun:bun /app

# Run non-root for security
USER bun

# Satellite scrapers only need outbound internet access (no open ports needed).
# Continuous runner loop scrapes every 1 hour (3600s) automatically.
ENV TRACK_ARGS="--all"
ENV LOG_DIR="/app/logs"
CMD ["sh", "-c", "while true; do ./track-bin $TRACK_ARGS; sleep 3600; done"]

