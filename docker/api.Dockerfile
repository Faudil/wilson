FROM node:22-alpine
RUN corepack enable
WORKDIR /app
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages ./packages
COPY apps/api ./apps/api
COPY prompts ./prompts
COPY samples ./samples
RUN pnpm install --frozen-lockfile --filter @wilson/api...
WORKDIR /app/apps/api
ENV NODE_ENV=production
# migrate + seed are idempotent; then start HTTP + workers
CMD ["sh", "-c", "pnpm db:migrate && pnpm seed && pnpm start"]
