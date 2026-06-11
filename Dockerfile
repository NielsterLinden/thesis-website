# Thesis Companion — single-service image (Initial_plan.md §8).
# Node serves everything; Python exists ONLY for the Phase 2 report sidecar
# (sidecar/render_report.py), which /reports/save spawns per request. No git,
# no build tools in the runtime stage.

# --- build frontend ---
FROM node:22-slim AS web-build
WORKDIR /web
COPY web/package*.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

# --- build backend ---
FROM node:22-slim AS api-build
WORKDIR /backend
COPY backend/package*.json ./
RUN npm ci
COPY backend/ ./
RUN npm run build

# --- runtime ---
FROM node:22-slim
ENV NODE_ENV=production
WORKDIR /app

# python + sidecar deps (Phase 2 report authoring, Initial_plan.md §6/§8)
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 python3-pip \
  && rm -rf /var/lib/apt/lists/*
COPY sidecar/requirements.txt ./sidecar/requirements.txt
RUN pip3 install --no-cache-dir --break-system-packages -r sidecar/requirements.txt

# backend runtime deps only
COPY backend/package*.json ./backend/
RUN cd backend && npm ci --omit=dev

# app artifacts. Paths mirror the repo root so APP_ROOT resolves to /app
# (backend/dist/config.js -> ../.. = /app) without any env override.
COPY --from=api-build /backend/dist ./backend/dist
COPY --from=web-build /web/dist ./web/dist
COPY sidecar ./sidecar
COPY web/thesis.pdf ./web/thesis.pdf
COPY data ./data
# The pinned submodule must be checked out in the build context
# (git submodule update --init --recursive) before building.
COPY thesis-src ./thesis-src

EXPOSE 8080
USER node
# Render health-checks over HTTP itself; this covers local docker compose.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "backend/dist/main.js"]
