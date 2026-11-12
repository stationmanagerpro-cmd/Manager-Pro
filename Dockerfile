# Image de l'API + client web. Client PostgreSQL 18 inclus (doit être ≥ à la version du serveur Render) (pg_dump pour les sauvegardes).
FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends curl gnupg ca-certificates lsb-release \
 && curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc | gpg --dearmor -o /usr/share/keyrings/pgdg.gpg \
 && echo "deb [signed-by=/usr/share/keyrings/pgdg.gpg] http://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" > /etc/apt/sources.list.d/pgdg.list \
 && apt-get update && apt-get install -y --no-install-recommends postgresql-client-18 poppler-utils \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY --chown=node:node . .
RUN mkdir -p /data/backups /data/uploads && chown -R node:node /data /app
ENV NODE_ENV=production PORT=3000 BACKUP_DIR=/data/backups UPLOAD_DIR=/data/uploads
VOLUME /data
EXPOSE 3000
USER node
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD curl -fsS http://127.0.0.1:${PORT:-3000}/api/health || exit 1
CMD ["sh", "-c", "node src/migrate.js && node src/server.js"]
