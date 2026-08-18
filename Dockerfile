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
# Continuous runner loop: runs immediately, then aligns to RUN_INTERVAL_SEC (default: 3600s / top-of-hour).
ENV TRACK_ARGS="--all"
ENV LOG_DIR="/app/logs"
ENV RUN_INTERVAL_SEC="3600"

CMD ["sh", "-c", "trap 'exit 0' INT TERM; while true; do ./track-bin $TRACK_ARGS; INTERVAL=${RUN_INTERVAL_SEC:-3600}; if [ \"$INTERVAL\" -ge 60 ]; then NOW=$(date +%s); SLEEP_SEC=$(( INTERVAL - (NOW % INTERVAL) )); [ \"$SLEEP_SEC\" -le 0 ] && SLEEP_SEC=$INTERVAL; else SLEEP_SEC=$INTERVAL; fi; sleep $SLEEP_SEC & wait $!; done"]


