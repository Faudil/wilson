FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /app
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages ./packages
COPY apps/backoffice ./apps/backoffice
RUN pnpm install --frozen-lockfile --filter @wilson/backoffice...
RUN pnpm --filter @wilson/backoffice build

FROM nginx:1.27-alpine
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/backoffice/dist /usr/share/nginx/html
