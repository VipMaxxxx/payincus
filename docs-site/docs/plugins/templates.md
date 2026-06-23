# 插件模板

仓库内提供三个模板：

```text
plugin-templates/basic-admin-plugin
plugin-templates/user-sidebar-plugin
plugin-templates/admin-user-mixed-plugin
```

打包示例：

```bash
cd plugin-templates/admin-user-mixed-plugin
tar -czf coupon-plugin.tar.gz payincus.plugin.json README.md dist templates docs
```

然后在后台「插件中心」上传 `.tar.gz` 安装并启用。
