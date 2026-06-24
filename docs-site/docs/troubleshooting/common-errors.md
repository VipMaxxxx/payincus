# 常见问题

## 后台域名和用户端域名混用

用户端和后台必须是两个独立域名：

- 用户端：`panel.example.com`
- 后台：`admin.example.com`

不要把两个入口写成同一个域名下的不同路径。

## `/api/health` 偶发 502

后端重启后，systemd 可能已报告服务启动，但 Node 进程还未监听端口。当前验证脚本已经加入 readiness retry。

## SSH 频繁断开

如果短时间大量 SSH 连接，服务器可能在握手阶段关闭连接。维护 OTA 时建议使用少量长连接，或用后台任务方式提交。

## 用户无法看到套餐

检查是否存在 active global-shared packages，以及是否有 online Incus hosts。

## 图片上传失败

检查 Lsky 配置。`verify:production-db` 会在 Lsky 未配置时给出 warning。
