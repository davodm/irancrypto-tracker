# ---------------------------------------------------
# Stage 1: Build JS Standalone Binary using Bun
# ---------------------------------------------------
FROM oven/bun:1-alpine AS builder
WORKDIR /app

# Copy bundled JS worker
COPY dist/track.cjs ./dist/track.cjs

# Compile JS worker into a zero-dependency standalone binary
RUN bun build ./dist/track.cjs --compile --outfile /app/track-bin

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
