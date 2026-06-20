# Local CI Test Script
# Runs the same checks as GitHub Actions CI

$ErrorActionPreference = "Stop"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Local CI Test" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Step 1: Install dependencies
Write-Host "[1/6] Installing dependencies..." -ForegroundColor Yellow
pnpm install --frozen-lockfile --ignore-scripts
if ($LASTEXITCODE -ne 0) {
    Write-Host "FAILED: pnpm install" -ForegroundColor Red
    exit 1
}
Write-Host "OK" -ForegroundColor Green
Write-Host ""

# Step 2: Generate Prisma Client
Write-Host "[2/6] Generating Prisma Client..." -ForegroundColor Yellow
$env:DATABASE_URL = "postgresql://user:pass@localhost:5432/db"
pnpm --filter server exec prisma generate
if ($LASTEXITCODE -ne 0) {
    Write-Host "FAILED: prisma generate" -ForegroundColor Red
    exit 1
}
Write-Host "OK" -ForegroundColor Green
Write-Host ""

# Step 3: Lint
Write-Host "[3/6] Running lint..." -ForegroundColor Yellow
pnpm lint
if ($LASTEXITCODE -ne 0) {
    Write-Host "FAILED: lint" -ForegroundColor Red
    exit 1
}
Write-Host "OK" -ForegroundColor Green
Write-Host ""

# Step 4: Type check (client)
Write-Host "[4/6] Type checking client..." -ForegroundColor Yellow
pnpm --filter client type-check
if ($LASTEXITCODE -ne 0) {
    Write-Host "FAILED: client type-check" -ForegroundColor Red
    exit 1
}
Write-Host "OK" -ForegroundColor Green
Write-Host ""

# Step 5: Type check (server)
Write-Host "[5/6] Type checking server..." -ForegroundColor Yellow
pnpm --filter server type-check
if ($LASTEXITCODE -ne 0) {
    Write-Host "FAILED: server type-check" -ForegroundColor Red
    exit 1
}
Write-Host "OK" -ForegroundColor Green
Write-Host ""

# Step 6: Build
Write-Host "[6/6] Building..." -ForegroundColor Yellow
pnpm build
if ($LASTEXITCODE -ne 0) {
    Write-Host "FAILED: build" -ForegroundColor Red
    exit 1
}
Write-Host "OK" -ForegroundColor Green
Write-Host ""

Write-Host "========================================" -ForegroundColor Green
Write-Host "  All CI checks passed!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
