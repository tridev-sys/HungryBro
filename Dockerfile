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
COPY --from=build /app/dist-scripts ./dist-scripts
COPY --from=build /app/db/migrations ./db/migrations
COPY --from=prod-deps /app/node_modules ./node_modules
EXPOSE 3000
# Migrations run in the one-shot `migrate` service (docker-compose*.yml), never in this container.
CMD ["node", "server.js"]
