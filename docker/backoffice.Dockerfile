FROM oven/bun:1.4.4-alpine
WORKDIR /app
COPY bun.lock package.json tsconfig.base.json ./
COPY packages ./packages
COPY apps/backoffice ./apps/backoffice
COPY apps/api/package.json ./apps/api/package.json
RUN --mount=type=secret,id=extra_ca,required=false NODE_EXTRA_CA_CERTS=/run/secrets/extra_ca bun install --frozen-lockfile --filter @wilson/backoffice
WORKDIR /app/apps/backoffice
RUN bun run build
ENV NODE_ENV=production WEB_PORT=8080 API_ORIGIN=http://api:3000
USER bun
EXPOSE 8080
# Serves dist/ with security headers and forwards /rpc and /webhooks to the API (replaces nginx).
CMD ["bun", "serve.ts", "--production"]
