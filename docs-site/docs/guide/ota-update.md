# 后台 OTA

管理后台提供“版本更新”页面，用于查看当前版本、Git tag、commit、构建时间、部署时间、更新内容、最新版本、可更新版本、任务日志和回滚入口。

后台页面：

```text
https://admin.example.com/admin/system-update
```

## 更新模式

默认推荐：

```dotenv
SYSTEM_UPDATE_APPLY_MODE=auto
SYSTEM_UPDATE_RELEASE_REPOSITORY=VipMaxxxx/payincus
```

`auto` 会优先使用 GitHub Release OTA artifact。如果目标 tag 没有可用 artifact，则回退到 Git tag 构建模式。

页面会在打开时自动读取最新 release tag。当前已经是最新版本时，最新版本仍然显示，主按钮显示“已更新至最新版本”且不可重复启动更新。更新任务列表固定为每页最多 7 条，超过后使用分页查看历史任务，右侧日志面板显示当前选中任务的详细输出。

| 模式 | 行为 |
| --- | --- |
| `auto` | 优先 artifact，缺失时走 Git 构建 |
| `artifact` | 只允许校验过的 OTA artifact |
| `git` | 强制 checkout tag 并在服务器构建 |

## Artifact 更新流程

1. 读取 GitHub Release `ota-manifest.json`。
2. 匹配当前 Linux 架构的 tar.gz。
3. 清理旧 `.incudal-update-downloads` 下载缓存。
4. 执行磁盘空间预检。
5. 下载 artifact 到受控缓存目录。
6. 校验文件大小和 SHA256。
7. 解压到 staging。
8. 旧布局备份当前目录；原子布局创建新 release。
9. 执行 Prisma migration。
10. 重启后端并等待 `/api/health`。
11. 执行 split host、生产预检、响应头和日志暴露检查。
12. 成功后清理下载缓存，并按保留策略清理旧 release。

## 原子布局

推荐迁移到原子 OTA 布局：

```bash
bash scripts/migrate-ota-atomic-layout.sh
```

布局：

```text
/opt/incudal/current -> /opt/incudal/releases/<version-timestamp>
/opt/incudal/releases/v0.0.10-...
/opt/incudal/releases/v0.0.11-...
```

更新成功时，任务会把上一版 release 路径写入 `backupPath`。回滚时只切换 `current` 指针，重启后端，并重新执行 split host 验证。

成功更新后会自动清理旧 release。清理时会保护：

- `current` 当前指向的 release。
- 本次更新任务的 `backupPath`。
- 最近成功或已回滚任务的 `backupPath`。

未受保护的 release 默认保留 8 个，更多旧目录会被删除。

## 磁盘和保留策略

推荐生产环境变量：

```dotenv
SYSTEM_UPDATE_MIN_FREE_MB=4096
SYSTEM_UPDATE_RELEASES_KEEP=8
SYSTEM_UPDATE_BACKUP_TASKS_KEEP=3
```

| 变量 | 默认值 | 说明 |
| --- | ---: | --- |
| `SYSTEM_UPDATE_MIN_FREE_MB` | `4096` | 更新前最低可用磁盘空间，单位 MB。artifact 模式还会按包大小额外预留下载和解压空间。 |
| `SYSTEM_UPDATE_RELEASES_KEEP` | `8` | 原子布局下保留的非保护旧 release 数量。 |
| `SYSTEM_UPDATE_BACKUP_TASKS_KEEP` | `3` | 额外保护最近成功或已回滚更新任务的 `backupPath` 数量，便于回滚。 |

如果磁盘空间不足，更新会在下载或迁移前失败，并在任务日志中输出中文原因。常见处理方式：

- 清理 `/opt/incudal/.incudal-update-downloads`。
- 检查 `/opt/incudal/releases` 是否有不再需要的旧版本。
- 扩容系统盘后重试 OTA。

## 注意事项

- 后台管理员可以查看当前版本、最新 release tag 和 OTA 包状态。
- 只允许超级管理员启动更新和回滚。
- 更新 API 固定在 `/api/admin/system-update/*`。
- 用户端不包含更新入口和更新 API。
- 更新和回滚会保留 `.env`、`server/certs`、`agent-release`、`plugins`、`plugin-data`、`plugin-logs`、`plugin-staging`、`.npm` 和 `.cache`。
- SSH 维护建议使用少量长连接，避免短时间大量连接触发服务器连接率限制。
