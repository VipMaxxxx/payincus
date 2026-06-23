# 一键安装

生产安装推荐使用 `scripts/install-panel.sh`。脚本会安装运行依赖、初始化 `.env`、执行 Prisma migration、生成 systemd 服务、配置 Nginx，并从 GitHub Release 下载预构建产物。

```bash
curl -fsSL https://raw.githubusercontent.com/VipMaxxxx/payincus/main/scripts/install-panel.sh -o install-panel.sh
sudo bash install-panel.sh
```

升级：

```bash
sudo bash install-panel.sh --upgrade
```

卸载：

```bash
sudo bash install-panel.sh --uninstall
```

安装时建议使用：

- 用户端域名：`pay.payincus.com`
- 后台域名：`admin.payincus.com`

实际生产环境请替换为自己的正式域名。
