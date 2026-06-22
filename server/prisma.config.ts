import { config as loadEnv } from "dotenv";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, env } from "prisma/config";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const candidateEnvFiles = [
  process.env.ENV_FILE ? resolve(process.env.ENV_FILE) : "",
  resolve(process.cwd(), ".env"),
  resolve(process.cwd(), "server/.env"),
  resolve(process.cwd(), "../.env"),
  resolve(__dirname, ".env"),
  resolve(__dirname, "../.env"),
];

for (const envPath of [...new Set(candidateEnvFiles.filter(Boolean))]) {
  if (existsSync(envPath)) {
    loadEnv({ path: envPath, override: false, quiet: true });
  }
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: env("DATABASE_URL"),
    provider: "postgresql",
  },
});
