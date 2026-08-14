#!/bin/sh
set -eu

if [ "${RUN_MIGRATIONS:-true}" = "true" ]; then
  echo "[entrypoint] running Prisma migrations..."
  pnpm --dir /app/server exec prisma migrate deploy
fi

if [ "${RUN_DATA_MIGRATIONS:-false}" = "true" ]; then
  echo "[entrypoint] running PayIncus data migrations..."
  pnpm --dir /app/server migrate:data
fi

echo "[entrypoint] starting PayIncus backend..."
exec "$@"
