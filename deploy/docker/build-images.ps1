# ============================================================================
# PayIncus Docker 镜像本地构建脚本
# 用法:
#   .\deploy\docker\build-images.ps1 -Version v1.2.12
#   .\deploy\docker\build-images.ps1 -Version v1.2.12 -Push -DockerhubUser myuser
# ============================================================================

param(
    [Parameter(Mandatory=$false)]
    [string]$Version = "latest",

    [Parameter(Mandatory=$false)]
    [string]$DockerhubUser = "aklibk",

    [Parameter(Mandatory=$false)]
    [switch]$Push = $false,

    [Parameter(Mandatory=$false)]
    [string]$Platforms = "linux/amd64,linux/arm64",

    [Parameter(Mandatory=$false)]
    [string]$GhcrOwner = "vipmaxxxx"
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  PayIncus Docker 镜像构建" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  版本: $Version"
Write-Host "  平台: $Platforms"
if ($DockerhubUser) { Write-Host "  Docker Hub 用户: $DockerhubUser" }
Write-Host "  GHCR Owner: $GhcrOwner"
Write-Host ""

# 检查 Docker 是否可用
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    Write-Host "错误: Docker 未安装或未运行" -ForegroundColor Red
    Write-Host "请安装 Docker Desktop: https://docs.docker.com/desktop/install/windows-install/" -ForegroundColor Yellow
    exit 1
}

# 检查 Docker 是否正在运行
$dockerInfo = docker info 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "错误: Docker 守护进程未运行，请启动 Docker Desktop" -ForegroundColor Red
    exit 1
}

Write-Host "Docker 版本:" -ForegroundColor Green
docker --version
Write-Host ""

# 设置 Buildx
Write-Host "[1/4] 设置 Docker Buildx..." -ForegroundColor Yellow
docker buildx create --name payincus-builder --use 2>$null
if ($LASTEXITCODE -ne 0) {
    docker buildx use payincus-builder 2>$null
}

# 登录（如果需要推送）
if ($Push) {
    if ($DockerhubUser) {
        Write-Host ""
        Write-Host "[2/4] 登录 Docker Hub..." -ForegroundColor Yellow
        docker login -u $DockerhubUser
        if ($LASTEXITCODE -ne 0) {
            Write-Host "Docker Hub 登录失败" -ForegroundColor Red
            exit 1
        }
    }

    Write-Host ""
    Write-Host "[3/4] 登录 GHCR..." -ForegroundColor Yellow
    echo $env:GITHUB_TOKEN | docker login ghcr.io -u $GhcrOwner --password-stdin 2>$null
    if ($LASTEXITCODE -ne 0) {
        Write-Host "GHCR 登录失败（需要设置 GITHUB_TOKEN 环境变量）" -ForegroundColor Yellow
        Write-Host "跳过 GHCR 推送" -ForegroundColor Yellow
    }
} else {
    Write-Host "[2/4] 跳过登录（未指定 -Push）" -ForegroundColor Gray
    Write-Host "[3/4] 跳过登录" -ForegroundColor Gray
}

# 构建镜像
$targets = @("backend", "frontend")
$buildArgs = @(
    "--build-arg", "VITE_API_BASE_URL=/api",
    "--build-arg", "VITE_CUSTOMER_BASE_URL=http://localhost:8080",
    "--build-arg", "VITE_ADMIN_BASE_URL=http://localhost:8081"
)

foreach ($target in $targets) {
    Write-Host ""
    Write-Host "[4/4] 构建 $target 镜像..." -ForegroundColor Yellow

    # 总是包含 Docker Hub 标签 + GHCR 标签
    $tags = @()
    if ($DockerhubUser) {
        $tags += "docker.io/${DockerhubUser}/payincus-${target}:${Version}"
        $tags += "docker.io/${DockerhubUser}/payincus-${target}:latest"
    }
    $tags += "ghcr.io/${GhcrOwner}/payincus-${target}:${Version}"
    $tags += "ghcr.io/${GhcrOwner}/payincus-${target}:latest"

    $tagArgs = @()
    foreach ($t in $tags) {
        $tagArgs += @("-t", $t)
    }

    $pushArg = if ($Push) { @("--push") } else { @("--load") }

    $cmdArgs = @(
        "buildx", "build",
        "-f", "Dockerfile",
        "--target", $target,
        "--platform", $Platforms
    ) + $tagArgs + $buildArgs + $pushArg + @(".")

    Write-Host "  执行: docker $($cmdArgs -join ' ')" -ForegroundColor Gray
    docker @cmdArgs

    if ($LASTEXITCODE -ne 0) {
        Write-Host "$target 镜像构建失败" -ForegroundColor Red
        exit 1
    }

    Write-Host "$target 镜像构建成功" -ForegroundColor Green
    foreach ($t in $tags) {
        Write-Host "  - $t"
    }
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  构建完成!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "镜像标签: $Version"
Write-Host ""
Write-Host "拉取命令:" -ForegroundColor Yellow
Write-Host "  docker pull docker.io/aklibk/payincus-backend:${Version}"
Write-Host "  docker pull docker.io/aklibk/payincus-frontend:${Version}"
Write-Host "  docker pull ghcr.io/${GhcrOwner}/payincus-backend:${Version}"
Write-Host "  docker pull ghcr.io/${GhcrOwner}/payincus-frontend:${Version}"
Write-Host ""
Write-Host "启动命令:" -ForegroundColor Yellow
Write-Host "  docker compose -f docker-compose.prod.yml up -d"
