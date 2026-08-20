# ─────────────────────────────────────────────────────────────────────────────
# OPC UA Light Server — Multi-stage Dockerfile
# Optimized for minimal image size and runtime memory usage.
#
# Final image: ~120-150 MB (Alpine + Node.js + compiled C binary + production deps)
# ─────────────────────────────────────────────────────────────────────────────

# ═══════════════════════════════════════════════════════════════════════════════
# Stage 1: Build the C runtime (open62541)
# ═══════════════════════════════════════════════════════════════════════════════
FROM alpine:3.20 AS runtime-builder

RUN apk add --no-cache \
    build-base \
    cmake \
    git \
    openssl-dev \
    linux-headers

WORKDIR /build/runtime

# Copy only runtime source (cache CMake deps independently)
COPY runtime/CMakeLists.txt ./
COPY runtime/include/ ./include/
COPY runtime/src/ ./src/

# Build with Release optimizations and strip symbols
RUN mkdir build && cd build && \
    cmake .. -DCMAKE_BUILD_TYPE=Release -DCMAKE_C_FLAGS="-Os" && \
    cmake --build . --parallel  && \
    strip /build/runtime/opcua-runtime

# ═══════════════════════════════════════════════════════════════════════════════
# Stage 2: Build the Node.js backend (TypeScript → dist/)
# ═══════════════════════════════════════════════════════════════════════════════
FROM node:22-alpine AS api-builder

WORKDIR /build

# Install only production + build deps (leverage layer caching)
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

# Copy source and compile
COPY tsconfig.json ./
COPY src/ ./src/

RUN npx tsc

# ═══════════════════════════════════════════════════════════════════════════════
# Stage 3: Build the React web UI (Vite → web/dist/)
# ═══════════════════════════════════════════════════════════════════════════════
FROM node:22-alpine AS web-builder

WORKDIR /build/web

# Install web dependencies
COPY web/package.json web/package-lock.json ./
RUN npm ci

# Copy web source and build
COPY web/tsconfig.json web/tsconfig.node.json ./
COPY web/vite.config.ts web/tailwind.config.js web/postcss.config.js ./
COPY web/index.html ./
COPY web/src/ ./src/

RUN npm run build

# ═══════════════════════════════════════════════════════════════════════════════
# Stage 4: Production dependencies only
# ═══════════════════════════════════════════════════════════════════════════════
FROM node:22-alpine AS deps

WORKDIR /app

COPY package.json package-lock.json ./

# Install ONLY production deps, rebuild native modules (better-sqlite3)
RUN npm ci --omit=dev && \
    npm cache clean --force

# ═══════════════════════════════════════════════════════════════════════════════
# Stage 5: Final production image
# ═══════════════════════════════════════════════════════════════════════════════
FROM node:22-alpine AS production

# Runtime deps for C binary (OpenSSL) and better-sqlite3
RUN apk add --no-cache \
    openssl \
    libstdc++ \
    && rm -rf /var/cache/apk/*

# Run as non-root for security
RUN addgroup -S opcua && adduser -S opcua -G opcua

WORKDIR /app

# Copy compiled C runtime binary
COPY --from=runtime-builder /build/runtime/opcua-runtime ./runtime/opcua-runtime

# Copy compiled Node.js backend
COPY --from=api-builder /build/dist/ ./dist/

# Copy compiled web UI
COPY --from=web-builder /build/web/dist/ ./web/dist/

# Copy production node_modules
COPY --from=deps /app/node_modules/ ./node_modules/

# Copy package.json (needed for "type": "module") and OpenAPI docs
COPY package.json ./
COPY docs/ ./docs/

# Create data directories (SQLite DB, certificates, PKI)
RUN mkdir -p data/certs data/pki/trusted data/pki/rejected runtime && \
    chown -R opcua:opcua /app

USER opcua

# Environment defaults
ENV NODE_ENV=production \
    PORT=3100 \
    OPCUA_PORT=4840 \
    DB_PATH=data/opcua-light.db \
    RUNTIME_PATH=runtime/opcua-runtime \
    CONFIG_PATH=runtime/config.json

# Expose API and OPC UA ports
EXPOSE 3100 4840

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget -qO- http://localhost:3100/api/server/status || exit 1

# Node.js memory optimization for containers
CMD ["node", "--max-old-space-size=128", "--env-file=/dev/null", "dist/api/server.js"]
