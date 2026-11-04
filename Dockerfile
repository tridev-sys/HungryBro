# syntax=docker/dockerfile:1
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build && npx tsc -p tsconfig.scripts.json

FROM node:22-alpine AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:22-alpine AS runner
ENV NODE_ENV=production
# Standalone server binds to HOSTNAME; Docker sets it to the container ID, so bind all interfaces.
ENV HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
# node server.js does not serve the project's public/ folder; copy it so /icons/* resolve.
COPY --from=build /app/public ./public
COPY --from=build /app/dist-scripts ./dist-scripts
COPY --from=build /app/db/migrations ./db/migrations
COPY --from=prod-deps /app/node_modules ./node_modules
# Non-root runtime user fixed at uid/gid 10001. Only Next.js's on-disk cache needs write access.
RUN addgroup -S -g 10001 app && adduser -S -u 10001 -G app app \
 && mkdir -p /app/.next/cache && chown -R 10001:10001 /app/.next/cache
USER 10001:10001
EXPOSE 3000
# Migrations run in the one-shot `migrate` service (docker-compose*.yml), never in this container.
CMD ["node", "server.js"]
