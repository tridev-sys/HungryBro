# Source this file; do not execute it. Loads the owner's .env.local (values are never printed)
# and sets test-only values for the perf stack. Nothing here points at the live stack:
# the database host is perf-db, the Redis host is perf-redis, and the app is perf-app on 127.0.0.1:3302.
set -a
. /home/ubuntu/docker/.env.local
set +a

export PERF_WT=/home/ubuntu/worktrees/test-perf
export PERF_NET=perf-net
export PERF_BASE=http://perf-app:3000   # in-network URL for load containers; host checks use http://127.0.0.1:3302

# Test-only signing keys (not used anywhere else).
export AUTH_JWT_SECRET='perf-test-only-jwt-secret-0123456789abcdef'
export OTP_HMAC_KEY='perf-test-only-otp-hmac-key-0123'

export APP_DATABASE_URL="postgres://food_app_login:${APP_DB_PASSWORD}@perf-db:5432/food_os"
export ADMIN_DATABASE_URL="postgres://food:${POSTGRES_PASSWORD}@perf-db:5432/food_os"
export REDIS_URL=redis://perf-redis:6379

# Runs a command in a node:22-alpine container on perf-net with the worktree mounted.
perf_node() {
  docker run --rm --network "$PERF_NET" -v "$PERF_WT":/app -w /app \
    -e AUTH_JWT_SECRET -e OTP_HMAC_KEY -e APP_DATABASE_URL -e ADMIN_DATABASE_URL -e REDIS_URL \
    -e PERF_BASE -e SANDBOX_BID_DELAY_MS \
    node:22-alpine "$@"
}
