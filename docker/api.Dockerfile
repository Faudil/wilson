FROM oven/bun:1.4.4-alpine
WORKDIR /app
COPY bun.lock package.json tsconfig.base.json ./
COPY packages ./packages
COPY apps/api ./apps/api
COPY apps/backoffice/package.json ./apps/backoffice/package.json
COPY prompts ./prompts
COPY samples ./samples
COPY knowledge ./knowledge
RUN --mount=type=secret,id=extra_ca,required=false NODE_EXTRA_CA_CERTS=/run/secrets/extra_ca bun install --frozen-lockfile --production --filter @wilson/api
WORKDIR /app/apps/api
ENV NODE_ENV=production
USER bun
# migrate + seed are idempotent; then start HTTP + workers
CMD ["sh", "-c", "bun src/db/migrate.ts && bun src/db/seed.ts && bun src/main.ts"]
